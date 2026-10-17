import { after, describe, test } from 'node:test';
import assert from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';

// Needs a Postgres to take the lock in; CI's e2e job sets this. Advisory locks
// are per database and real runs lock in `postgres`, so locally any other
// database in the Docker container works without holding up a real run:
//   SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();
const SCRIPT = 'scripts/e2e/run-lock.mjs';

const workDirectory = mkdtempSync(path.join(tmpdir(), 'run-lock-test-'));
const started: number[] = [];

after(() => {
    for (const pid of started) {
        try {
            process.kill(-pid, 'SIGKILL');
        } catch {
            // Already gone.
        }
    }
    rmSync(workDirectory, { recursive: true, force: true });
});

/** Starts run-lock.mjs around a bash command that can append to $LOG. */
function startRun(command: string, log: string, env: Record<string, string> = {}) {
    const child = spawn(process.execPath, [SCRIPT, 'bash', '-c', command], {
        env: { ...process.env, E2E_LOCK_DATABASE_URL: DATABASE_URL, LOG: log, ...env },
        stdio: ['ignore', 'ignore', 'pipe'],
        // Its own process group, so cleanup can kill it. Its helper then stops
        // the command, which runs in a session of its own.
        detached: true,
    });
    started.push(child.pid!);
    let stderr = '';
    child.stderr!.on('data', (chunk) => {
        stderr += chunk;
    });
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    return { pid: child.pid!, exited, stderr: () => stderr };
}

/** The command that bash runs: logs `start`, and on SIGTERM logs `term`, takes a second to stop, logs `exited`. */
function slowToStop(name: string) {
    return `trap "echo ${name}-term >> \\"\\$LOG\\"; sleep 1; echo ${name}-exited >> \\"\\$LOG\\"; exit 0" TERM; `
        + `echo ${name}-start >> "$LOG"; sleep 30 & wait`;
}

function newLog(name: string) {
    const log = path.join(workDirectory, `${name}.log`);
    writeFileSync(log, '');
    return log;
}

function lines(log: string) {
    return readFileSync(log, 'utf8').split('\n').filter(Boolean);
}

async function waitFor(condition: () => boolean, what: string, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${what}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

describe('run-lock.mjs', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 60_000 }, () => {
    test('a second run waits for the first, says which run it waits for, then runs', async () => {
        const log = newLog('serial');
        const first = startRun('echo first-start >> "$LOG"; sleep 2; echo first-end >> "$LOG"', log);
        await waitFor(() => lines(log).includes('first-start'), 'the first run to start');

        const second = startRun('echo second-start >> "$LOG"', log);
        await waitFor(() => second.stderr().includes('Waiting for another local E2E run'), 'the second run to wait');
        assert.match(second.stderr(), new RegExp(`e2e-local \\S+ pid ${first.pid}\\b`));

        assert.deepStrictEqual(await Promise.all([first.exited, second.exited]), [0, 0]);
        assert.deepStrictEqual(lines(log), ['first-start', 'first-end', 'second-start']);
    });

    test("exits with the command's status", async () => {
        const run = startRun('exit 7', newLog('status'));
        assert.strictEqual(await run.exited, 7);
    });

    test('gives up after E2E_LOCK_WAIT_SECONDS without running the command', async () => {
        const log = newLog('timeout');
        const holder = startRun('echo holder-start >> "$LOG"; sleep 30', log);
        await waitFor(() => lines(log).includes('holder-start'), 'the holder to start');

        const waiter = startRun('echo waiter-ran >> "$LOG"', log, { E2E_LOCK_WAIT_SECONDS: '0' });
        assert.strictEqual(await waiter.exited, 75);
        assert.match(waiter.stderr(), new RegExp(`Gave up after 0s: e2e-local \\S+ pid ${holder.pid} still holds`));
        assert.deepStrictEqual(lines(log), ['holder-start']);

        process.kill(-holder.pid, 'SIGKILL');
        await holder.exited;
    });

    test('killing only the wrapper, even with SIGKILL, stops its run and holds the lock until the run is gone', async () => {
        const log = newLog('killed');
        const killed = startRun(slowToStop('killed'), log);
        await waitFor(() => lines(log).includes('killed-start'), 'the run to start');
        process.kill(killed.pid, 'SIGKILL');
        await killed.exited;

        const next = startRun('echo next-ran >> "$LOG"', log, { E2E_LOCK_WAIT_SECONDS: '10' });
        assert.strictEqual(await next.exited, 0);
        assert.deepStrictEqual(lines(log), ['killed-start', 'killed-term', 'killed-exited', 'next-ran']);
    });

    test('a run whose helper dies, releasing the lock, is stopped and exits 1', async () => {
        const log = newLog('helper');
        const run = startRun(slowToStop('run'), log);
        await waitFor(() => lines(log).includes('run-start'), 'the run to start');
        const helper = spawnSync('pgrep', ['-P', String(run.pid), '-f', '--', 'run-lock.mjs --hold'], { encoding: 'utf8' });
        assert.match(helper.stdout, /^\d+\n$/);
        process.kill(Number(helper.stdout), 'SIGKILL');

        assert.strictEqual(await run.exited, 1);
        assert.match(run.stderr(), /Lost the E2E lock; stopping this run/);
        assert.deepStrictEqual(lines(log), ['run-start', 'run-term', 'run-exited']);
    });

    test('names the holder in its own database, not a session holding the same key in another', async () => {
        // Advisory locks are per database, but pg_locks lists the whole server.
        const otherDatabase = new URL(DATABASE_URL!);
        otherDatabase.pathname = '/postgres';
        const other = postgres(otherDatabase.toString(), { max: 1, onnotice: () => {}, connection: { application_name: 'other-database' } });
        try {
            // Taken here, or already held there by a real run: either way it is held.
            await other`SELECT pg_try_advisory_lock(5432, 3000)`;

            const log = newLog('database');
            const holder = startRun('echo holder-start >> "$LOG"; sleep 30', log);
            await waitFor(() => lines(log).includes('holder-start'), 'the holder to start');
            for (let attempt = 0; attempt < 5; attempt += 1) {
                const waiter = startRun('true', log, { E2E_LOCK_WAIT_SECONDS: '0' });
                assert.strictEqual(await waiter.exited, 75);
                assert.match(waiter.stderr(), new RegExp(`Gave up after 0s: e2e-local \\S+ pid ${holder.pid} still holds`));
            }
            process.kill(-holder.pid, 'SIGKILL');
            await holder.exited;
        } finally {
            await other.end();
        }
    });

    test('SIGTERM sent to the wrapper alone reaches the command', async () => {
        const log = newLog('sigterm');
        // `sleep & wait` so bash runs the trap at once instead of after sleep.
        const run = startRun('trap "echo got-term >> \\"\\$LOG\\"; exit 0" TERM; echo started >> "$LOG"; sleep 30 & wait', log);
        await waitFor(() => lines(log).includes('started'), 'the command to start');

        process.kill(run.pid, 'SIGTERM');
        assert.strictEqual(await run.exited, 0);
        assert.deepStrictEqual(lines(log), ['started', 'got-term']);
    });
});
