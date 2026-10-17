// Runs a command while holding the local E2E run lock, so runs from different
// checkouts (git worktrees, other clones) take turns. They all share the
// atlas-wealth-db container, its atlas_wealth_e2e database and ports 3000 and
// 3100: without the lock, a second run's DROP DATABASE ... WITH (FORCE) kills
// the first one mid-run.
//
// The lock is two Postgres session advisory locks in that container, which the
// server releases when the connection holding one closes. The command runs in
// a session of its own, and two processes each hold one lock until every
// process in that session has exited:
//   - the turn lock, held by a helper process (this script with --hold);
//   - the running lock, held by this wrapper.
// A run starts only once it holds both, so if either process dies, the other
// keeps the next run out while this one stops. If the wrapper dies, even by
// SIGKILL, the helper stops the run (SIGTERM); if the helper or a connection
// dies, the wrapper does. The command starts behind a barrier
// (start-when-told.sh) that opens only once the helper is watching it.
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

// pg_advisory_lock(LOCK_CLASS, object). Any numbers work, as long as every
// checkout uses the same ones; pg_locks shows them as classid and objid.
const LOCK_CLASS = 5432;
const TURN_LOCK = 3000;
const RUNNING_LOCK = 3001;
const LOCK_POLL_MS = 2000;
const RUN_POLL_MS = 250;
const EXIT_LOCK_TIMEOUT = 75; // EX_TEMPFAIL: try again later
const START_BARRIER = path.join(path.dirname(fileURLToPath(import.meta.url)), "start-when-told.sh");

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

/** One connection for holding a lock: never recycled, and `onLost` runs if it closes before `end()`. */
function connect(onLost) {
    // Shown to a run that is waiting, so it can say which checkout it waits
    // for. Postgres truncates application_name to 63 bytes.
    const wrapperPid = holding ? process.ppid : process.pid;
    const name = `e2e-local ${path.basename(process.cwd())} pid ${wrapperPid}`.slice(0, 63);
    let ending = false;
    const sql = postgres(databaseUrl, {
        max: 1,
        idle_timeout: null,
        max_lifetime: null,
        connection: { application_name: name },
        onnotice: () => {},
        onclose: () => {
            if (!ending) {
                onLost();
            }
        },
    });
    const end = async () => {
        ending = true;
        await sql.end({ timeout: 5 });
    };
    return { sql, end };
}

async function tryLock(sql, lock) {
    const [{ locked }] = await sql`SELECT pg_try_advisory_lock(${LOCK_CLASS}, ${lock}) AS locked`;
    return locked;
}

// pg_locks covers the whole server, but advisory locks are per database.
async function holderOf(sql, lock) {
    const rows = await sql`
        SELECT activity.application_name
        FROM pg_locks AS lock
        JOIN pg_stat_activity AS activity ON activity.pid = lock.pid
        WHERE lock.locktype = 'advisory' AND lock.granted
          AND lock.database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND lock.classid = ${LOCK_CLASS} AND lock.objid = ${lock} AND lock.objsubid = 2
    `;
    return rows[0]?.application_name || "another checkout";
}

/** Polls for `lock` until it is taken (true), the deadline passes or `abandoned()` (false). */
async function waitForLock(sql, lock, deadline, waiting, abandoned) {
    let announced = false;
    for (;;) {
        if (abandoned()) {
            return false;
        }
        if (await tryLock(sql, lock)) {
            return true;
        }
        if (Date.now() >= deadline) {
            console.error(`Gave up after ${waitSeconds}s: ${await holderOf(sql, lock)} still holds the E2E lock.`);
            process.exitCode = EXIT_LOCK_TIMEOUT;
            return false;
        }
        if (!announced) {
            console.error(`${waiting} (${await holderOf(sql, lock)})…`);
            announced = true;
        }
        await sleep(Math.min(LOCK_POLL_MS, deadline - Date.now()));
    }
}

// The helper. Takes the turn lock, waits for the running lock to be free (a
// run whose helper died keeps it until that run has stopped), frees it again
// for the wrapper, and tells the wrapper {locked: true}. Learns the run's
// session id from {run: id} and answers {watching: id}, and treats the IPC
// channel closing as the wrapper being gone.
async function holdLock() {
    let run;
    let wrapperGone = false;
    let holdingTurn = false;
    process.on("message", (message) => {
        if (message.run !== undefined && process.connected) {
            run = message.run;
            process.send({ watching: run });
        }
    });
    process.on("disconnect", () => {
        wrapperGone = true;
    });
    const { sql, end } = connect(() => {
        if (holdingTurn) {
            console.error("Lost the connection holding the E2E lock.");
            process.exit(1);
        }
    });

    try {
        const deadline = Date.now() + waitSeconds * 1000;
        const abandoned = () => wrapperGone;
        holdingTurn = await waitForLock(sql, TURN_LOCK, deadline, "Waiting for another local E2E run to finish", abandoned);
        if (!holdingTurn
            || !(await waitForLock(sql, RUNNING_LOCK, deadline, "Waiting for the previous E2E run to stop", abandoned))) {
            return;
        }
        // Safe to let go: nobody else can take it without the turn lock first.
        await sql`SELECT pg_advisory_unlock(${LOCK_CLASS}, ${RUNNING_LOCK})`;

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
        await end();
    }
}

// The wrapper: starts the helper, takes the running lock once the helper has
// the turn, runs the command, and passes signals and the exit status through.
async function runWithLock() {
    // Detached: Ctrl-C must not reach the helper before the run has stopped.
    let helper;
    try {
        helper = fork(fileURLToPath(import.meta.url), ["--hold"], { detached: true });
    } catch (error) {
        console.error(`Could not start the E2E lock helper: ${error.message}`);
        return 1;
    }
    const helperExited = new Promise((resolve) => {
        helper.once("exit", (code) => resolve(code ?? 1));
        // A helper that never started may emit no "exit". Later errors are
        // IPC to a helper that just died; its exit is handled.
        helper.on("error", (error) => {
            if (helper.pid === undefined) {
                console.error(`Could not start the E2E lock helper: ${error.message}`);
                resolve(1);
            }
        });
    });
    const helperLocked = await Promise.race([
        new Promise((resolve) => helper.once("message", (message) => resolve(message.locked === true))),
        helperExited.then(() => false),
    ]);
    if (!helperLocked) {
        return helperExited;
    }

    let child;
    let finished = false;
    let lockLost = false;
    const loseLock = () => {
        if (!finished && !lockLost) {
            console.error("Lost the E2E lock; stopping this run.");
            lockLost = true;
            if (child?.pid !== undefined) {
                signalProcessGroup(child.pid, "SIGTERM");
            }
        }
    };
    const releaseHelper = async () => {
        if (helper.connected) {
            helper.disconnect();
        }
        await helperExited;
    };

    // Held until the run's processes have all exited, so a run whose helper
    // dies still keeps the next one out until it has stopped.
    const running = connect(loseLock);
    try {
        if (!(await tryLock(running.sql, RUNNING_LOCK))) {
            throw new Error("another run took it first");
        }
        if (lockLost) {
            throw new Error("its connection closed");
        }
    } catch (error) {
        console.error(`Could not take the E2E lock: ${error.message}`);
        finished = true;
        await releaseHelper();
        await running.end();
        return 1;
    }

    // A session of its own, so the helper can watch and stop the whole run.
    // The command waits behind the barrier until the helper is watching that
    // session; if this wrapper dies first, the barrier's stdin closes and the
    // command never runs.
    child = spawn("/bin/sh", [START_BARRIER, command, ...commandArgs], {
        detached: true,
        stdio: ["pipe", "inherit", "inherit"],
    });
    child.stdin.on("error", () => {}); // EPIPE if the barrier is already gone
    const status = new Promise((resolve) => {
        child.once("error", (error) => {
            console.error(`Could not start ${command}: ${error.message}`);
            resolve(127);
        });
        child.once("exit", (code, signal) => resolve(code ?? 128 + (constants.signals[signal] ?? 0)));
    });
    if (child.pid !== undefined && helper.connected) {
        helper.on("message", (message) => {
            if (message.watching === child.pid && !lockLost) {
                child.stdin.end("go\n");
            }
        });
        helper.send({ run: child.pid });
        // The run is outside the terminal's process group, so pass on what
        // Ctrl-C (or a kill aimed at this process) would have sent it.
        for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
            process.on(signal, () => signalProcessGroup(child.pid, signal));
        }
    }
    helperExited.then(loseLock);

    const exitStatus = await status;
    if (lockLost && child.pid !== undefined) {
        while (processGroupAlive(child.pid)) {
            await sleep(RUN_POLL_MS);
        }
    }
    finished = true;
    // The helper releases the turn once the run's processes are all gone.
    await releaseHelper();
    await running.end();
    return lockLost ? 1 : exitStatus;
}

if (holding) {
    await holdLock();
    // The IPC channel would keep this process alive.
    process.exit();
} else {
    process.exit(await runWithLock());
}
