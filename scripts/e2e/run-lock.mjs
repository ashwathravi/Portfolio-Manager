// Runs a command while holding the local E2E run lock, so runs from different
// checkouts (git worktrees, other clones) take turns. They all share the
// atlas-wealth-db container, its atlas_wealth_e2e database and ports 3000 and
// 3100: without the lock, a second run's DROP DATABASE ... WITH (FORCE) kills
// the first one mid-run.
//
// The lock is a Postgres session advisory lock in that container, which the
// server releases when the connection holding it closes. A helper process
// (this script with --hold) holds that connection, and the command runs in a
// session of its own. The lock and the run end together:
//   - the helper releases the lock only once every process in the run's
//     session has exited;
//   - if this wrapper dies, even by SIGKILL, the helper stops the run
//     (SIGTERM) and keeps the lock until it is gone;
//   - if the helper or its connection dies, this wrapper stops the run.
//
//   E2E_LOCK_DATABASE_URL=postgres://… node scripts/e2e/run-lock.mjs <command> [args…]
//
// Waits up to E2E_LOCK_WAIT_SECONDS (default 1800) for the lock, then exits 75.
// Otherwise exits with the command's status, or 1 if the lock was lost.
import { fork, spawn } from "node:child_process";
import { constants } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// Any pair works, as long as every checkout uses the same one. pg_locks shows
// them as classid and objid.
const LOCK_CLASS = 5432;
const LOCK_OBJECT = 3000;
const LOCK_POLL_MS = 2000;
const RUN_POLL_MS = 250;
const EXIT_LOCK_TIMEOUT = 75; // EX_TEMPFAIL: try again later

const holding = process.argv[2] === "--hold";
const databaseUrl = process.env.E2E_LOCK_DATABASE_URL?.trim();
const waitSeconds = Number(process.env.E2E_LOCK_WAIT_SECONDS ?? 1800);
const [command, ...commandArgs] = process.argv.slice(2);
if (!databaseUrl || (!holding && !command) || !Number.isFinite(waitSeconds) || waitSeconds < 0) {
    console.error("Usage: E2E_LOCK_DATABASE_URL=postgres://… node scripts/e2e/run-lock.mjs <command> [args…]");
    process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** True while any process is left in the session (process group) `id`. */
function processGroupAlive(id) {
    try {
        process.kill(-id, 0);
        return true;
    } catch (error) {
        return error.code === "EPERM";
    }
}

function signalProcessGroup(id, signal) {
    try {
        process.kill(-id, signal);
    } catch {
        // Already gone.
    }
}

// The helper. Tells the wrapper {locked: true} once it holds the lock, learns
// the run's session id from {run: id}, and treats the IPC channel closing as
// the wrapper being gone.
async function holdLock() {
    let run;
    let wrapperGone = false;
    let locked = false;
    let releasing = false;
    process.on("message", (message) => {
        run = message.run;
    });
    process.on("disconnect", () => {
        wrapperGone = true;
    });

    // Shown to a run that is waiting, so it can say which checkout it waits
    // for. Postgres truncates application_name to 63 bytes.
    const holderName = `e2e-local ${path.basename(process.cwd())} pid ${process.ppid}`.slice(0, 63);
    const sql = postgres(databaseUrl, {
        max: 1,
        // The lock lasts as long as this one connection, so never recycle it.
        idle_timeout: null,
        max_lifetime: null,
        connection: { application_name: holderName },
        onnotice: () => {},
        onclose: () => {
            if (locked && !releasing) {
                console.error("Lost the connection holding the E2E lock.");
                process.exit(1);
            }
        },
    });

    // pg_locks covers the whole server, but advisory locks are per database.
    const currentHolder = async () => {
        const rows = await sql`
            SELECT activity.application_name
            FROM pg_locks AS lock
            JOIN pg_stat_activity AS activity ON activity.pid = lock.pid
            WHERE lock.locktype = 'advisory' AND lock.granted
              AND lock.database = (SELECT oid FROM pg_database WHERE datname = current_database())
              AND lock.classid = ${LOCK_CLASS} AND lock.objid = ${LOCK_OBJECT} AND lock.objsubid = 2
        `;
        return rows[0]?.application_name || "another checkout";
    };

    try {
        const deadline = Date.now() + waitSeconds * 1000;
        let announced = false;
        for (;;) {
            if (wrapperGone) {
                return;
            }
            [{ locked }] = await sql`SELECT pg_try_advisory_lock(${LOCK_CLASS}, ${LOCK_OBJECT}) AS locked`;
            if (locked) {
                break;
            }
            if (Date.now() >= deadline) {
                console.error(`Gave up after ${waitSeconds}s: ${await currentHolder()} still holds the E2E lock.`);
                process.exitCode = EXIT_LOCK_TIMEOUT;
                return;
            }
            if (!announced) {
                console.error(`Waiting for another local E2E run to finish (${await currentHolder()})…`);
                announced = true;
            }
            await sleep(Math.min(LOCK_POLL_MS, deadline - Date.now()));
        }

        if (process.connected) {
            process.send({ locked: true });
        }
        let stopping = false;
        while (run === undefined ? !wrapperGone : processGroupAlive(run)) {
            if (wrapperGone && !stopping) {
                signalProcessGroup(run, "SIGTERM");
                stopping = true;
            }
            await sleep(RUN_POLL_MS);
        }
    } catch (error) {
        console.error(`Could not take the E2E lock: ${error.message}`);
        process.exitCode = 1;
    } finally {
        releasing = true;
        await sql.end({ timeout: 5 });
    }
}

// The wrapper: starts the helper, runs the command once it holds the lock,
// and passes signals and the exit status through.
async function runWithLock() {
    // Detached: Ctrl-C must not reach the helper before the run has stopped.
    const helper = fork(fileURLToPath(import.meta.url), ["--hold"], { detached: true });
    helper.on("error", () => {}); // IPC to a helper that just died; its exit is handled below
    const helperExited = new Promise((resolve) => helper.once("exit", (code) => resolve(code ?? 1)));
    const locked = await Promise.race([
        new Promise((resolve) => helper.once("message", (message) => resolve(message.locked === true))),
        helperExited.then(() => false),
    ]);
    if (!locked) {
        return helperExited;
    }

    // A session of its own, so the helper can watch and stop the whole run.
    const child = spawn(command, commandArgs, { detached: true, stdio: ["ignore", "inherit", "inherit"] });
    let finished = false;
    let lockLost = false;
    const status = new Promise((resolve) => {
        child.once("error", (error) => {
            console.error(`Could not start ${command}: ${error.message}`);
            resolve(127);
        });
        child.once("exit", (code, signal) => resolve(code ?? 128 + (constants.signals[signal] ?? 0)));
    });
    if (child.pid !== undefined && helper.connected) {
        helper.send({ run: child.pid });
        // The run is outside the terminal's process group, so pass on what
        // Ctrl-C (or a kill aimed at this process) would have sent it.
        for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
            process.on(signal, () => signalProcessGroup(child.pid, signal));
        }
        helperExited.then(() => {
            if (!finished) {
                console.error("Lost the E2E lock; stopping this run.");
                lockLost = true;
                signalProcessGroup(child.pid, "SIGTERM");
            }
        });
    }

    const exitStatus = await status;
    finished = true;
    // The helper releases the lock once the run's processes are all gone.
    if (helper.connected) {
        helper.disconnect();
    }
    await helperExited;
    return lockLost ? 1 : exitStatus;
}

if (holding) {
    await holdLock();
    // The IPC channel would keep this process alive.
    process.exit();
} else {
    process.exit(await runWithLock());
}
