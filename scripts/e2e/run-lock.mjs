// Runs a command while holding the local E2E run lock, so runs from different
// checkouts (git worktrees, other clones) take turns. They all share the
// atlas-wealth-db container, its atlas_wealth_e2e database and ports 3000 and
// 3100: without the lock, a second run's DROP DATABASE ... WITH (FORCE) kills
// the first one mid-run.
//
// The lock is a Postgres session advisory lock in that container, held on one
// connection to the `postgres` database. The server releases it when that
// connection closes, however this process ends, so a killed run never leaves
// a stale lock behind.
//
//   E2E_LOCK_DATABASE_URL=postgres://… node scripts/e2e/run-lock.mjs <command> [args…]
//
// Waits up to E2E_LOCK_WAIT_SECONDS (default 1800) for the lock, then exits 75.
// Otherwise exits with the command's status.
import { spawn } from "node:child_process";
import { constants } from "node:os";
import path from "node:path";
import postgres from "postgres";

// Any pair works, as long as every checkout uses the same one. pg_locks shows
// them as classid and objid.
const LOCK_CLASS = 5432;
const LOCK_OBJECT = 3000;
const POLL_INTERVAL_MS = 2000;
const EXIT_LOCK_TIMEOUT = 75; // EX_TEMPFAIL: try again later

const databaseUrl = process.env.E2E_LOCK_DATABASE_URL?.trim();
const waitSeconds = Number(process.env.E2E_LOCK_WAIT_SECONDS ?? 1800);
const [command, ...commandArgs] = process.argv.slice(2);
if (!databaseUrl || !command || !Number.isFinite(waitSeconds) || waitSeconds < 0) {
    console.error("Usage: E2E_LOCK_DATABASE_URL=postgres://… node scripts/e2e/run-lock.mjs <command> [args…]");
    process.exit(2);
}

// Shown to a run that is waiting, so it can say which checkout it waits for.
// Postgres truncates application_name to 63 bytes.
const holderName = `e2e-local ${path.basename(process.cwd())} pid ${process.pid}`.slice(0, 63);

const sql = postgres(databaseUrl, {
    max: 1,
    // The lock lasts as long as this one connection, so never recycle it.
    idle_timeout: null,
    max_lifetime: null,
    connection: { application_name: holderName },
    onnotice: () => {},
});

async function currentHolder() {
    const rows = await sql`
        SELECT activity.application_name
        FROM pg_locks AS lock
        JOIN pg_stat_activity AS activity ON activity.pid = lock.pid
        WHERE lock.locktype = 'advisory' AND lock.granted
          AND lock.classid = ${LOCK_CLASS} AND lock.objid = ${LOCK_OBJECT} AND lock.objsubid = 2
    `;
    return rows[0]?.application_name || "another checkout";
}

async function acquireLock() {
    const deadline = Date.now() + waitSeconds * 1000;
    let announced = false;
    for (;;) {
        const [{ locked }] = await sql`SELECT pg_try_advisory_lock(${LOCK_CLASS}, ${LOCK_OBJECT}) AS locked`;
        if (locked) {
            return true;
        }
        if (Date.now() >= deadline) {
            console.error(`Gave up after ${waitSeconds}s: ${await currentHolder()} still holds the E2E lock.`);
            return false;
        }
        if (!announced) {
            console.error(`Waiting for another local E2E run to finish (${await currentHolder()})…`);
            announced = true;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, deadline - Date.now())));
    }
}

function runCommand() {
    return new Promise((resolve) => {
        const child = spawn(command, commandArgs, { stdio: "inherit" });
        // Ctrl-C reaches the whole process group; a signal sent to this process
        // alone must still reach the run.
        for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
            process.on(signal, () => child.kill(signal));
        }
        child.once("error", (error) => {
            console.error(`Could not start ${command}: ${error.message}`);
            resolve(127);
        });
        child.once("exit", (code, signal) => resolve(code ?? 128 + (constants.signals[signal] ?? 0)));
    });
}

let status;
try {
    status = (await acquireLock()) ? await runCommand() : EXIT_LOCK_TIMEOUT;
} catch (error) {
    console.error(`Could not take the E2E lock: ${error.message}`);
    status = 1;
} finally {
    await sql.end({ timeout: 5 });
}
process.exit(status);
