import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import { buildJobHealthQuery, createJobHealthCheck, JOB_SCHEDULES, loadJobHealthData } from '../../src/lib/health/job-health';
import { createJobRunStore, runJob } from '../../src/lib/jobs/runner';
import { recordValuationSnapshots, type SnapshotStore } from '../../src/lib/portfolio/valuation-snapshots';
import { BACKUP_JOB, recordBackupRun } from './backups';

// Launch item i71: /api/health/jobs reads the runs the nightly jobs and the
// backup workflow record, the newest stored close and how far the snapshots
// got, against a scratch
// database with every migration applied, on a session in another time zone
// (started_at holds UTC without one; price_bars.date is an Eastern date). Needs a local Postgres it may create databases in; CI's e2e job sets
// this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

describe('job health', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `job_health_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: Parameters<typeof createJobRunStore>[0] & object;

    before(async () => {
        server = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
        await server.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server.unsafe(`CREATE DATABASE ${name}`);
        const scratch = new URL(DATABASE_URL!);
        scratch.pathname = `/${name}`;
        sql = postgres(scratch.toString(), { max: 1, onnotice: () => {}, connection: { TimeZone: 'America/New_York' } });
        await sql.unsafe(readFileSync('scripts/db/init-local.sql', 'utf8'));
        await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
        database = drizzle(sql, { schema });
    });

    after(async () => {
        await sql?.end();
        await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server?.end();
    });

    async function recordJob(job: string, startedAt: Date, status: 'succeeded' | 'failed' | 'running') {
        const store = createJobRunStore(database);
        const id = await store.start(job, startedAt);
        if (status !== 'running') {
            await store.finish(id, { status, finishedAt: new Date(startedAt.getTime() + 60_000), detail: {}, error: status === 'failed' ? 'boom' : null });
        }
    }

    test('each job\'s last success and latest run come back in UTC', async () => {
        await recordJob('prices', new Date('2026-10-26T22:31:00.250Z'), 'succeeded');
        await recordJob('prices', new Date('2026-10-27T22:30:00Z'), 'failed');
        await recordJob('plaid', new Date('2026-10-27T22:30:00Z'), 'running');
        await recordBackupRun(sql, {
            status: 'succeeded',
            startedAt: new Date('2026-10-28T06:50:00Z'),
            finishedAt: new Date('2026-10-28T06:58:00Z'),
            runUrl: 'https://github.com/example/actions/runs/1',
        });
        await recordBackupRun(sql, {
            status: 'failed',
            startedAt: new Date('2026-10-27T06:50:00Z'),
            finishedAt: new Date('2026-10-27T06:52:00Z'),
            runUrl: null,
        });

        const rows = await buildJobHealthQuery(['prices', 'plaid', 'snapshots', BACKUP_JOB], database);
        const byJob = Object.fromEntries(rows.map((row) => [row.job, row]));

        assert.deepEqual(Object.keys(byJob).sort(), ['backup', 'plaid', 'prices']);
        assert.deepEqual(byJob.prices, {
            job: 'prices',
            lastSucceededAt: new Date('2026-10-26T22:31:00.250Z'),
            latestStartedAt: new Date('2026-10-27T22:30:00Z'),
            latestStatus: 'failed',
        });
        assert.deepEqual(byJob.plaid, { job: 'plaid', lastSucceededAt: null, latestStartedAt: new Date('2026-10-27T22:30:00Z'), latestStatus: 'running' });
        assert.deepEqual(byJob.backup, {
            job: 'backup',
            lastSucceededAt: new Date('2026-10-28T06:50:00Z'),
            latestStartedAt: new Date('2026-10-28T06:50:00Z'),
            latestStatus: 'succeeded',
        });

        const [failedBackup] = await sql<{ finished: string; error: string; detail: unknown }[]>`
            SELECT to_char(finished_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS finished, error, detail
            FROM job_runs WHERE job = 'backup' AND status = 'failed'
        `;
        assert.deepEqual(failedBackup, { finished: '2026-10-27T06:52:00', error: 'The backup workflow failed.', detail: { runUrl: null } });
    });

    test('the check reads them into each job\'s status, and the closes as stale before any is stored', async () => {
        const check = createJobHealthCheck({
            isConfigured: () => true,
            load: (jobs) => loadJobHealthData(jobs, database),
            now: () => new Date('2026-10-28T12:00:00Z').getTime(),
        });

        const report = await check();

        assert.equal(report.status, 'degraded');
        assert.deepEqual(report.closes, { status: 'stale', latest: null, oldestAllowed: '2026-10-26' });
        assert.deepEqual(report.snapshots, { status: 'stale', latest: null, oldestAllowed: '2026-10-26' });
        assert.deepEqual(
            Object.fromEntries(report.jobs.map((job) => [job.job, job.status])),
            Object.fromEntries(JOB_SCHEDULES.map(({ job }) => [job, ({ prices: 'failed', plaid: 'failed', backup: 'ok' } as Record<string, string>)[job] ?? 'late'])),
        );
    });

    test('the newest close across every symbol is the one checked, as its Eastern date', async () => {
        await sql`INSERT INTO securities (symbol) VALUES ('SPY'), ('IBM')`;
        await sql`
            INSERT INTO price_bars (symbol, date, open, high, low, close, volume, source) VALUES
                ('SPY', '2026-10-23', 1, 1, 1, 1, 1, 'test'),
                ('IBM', '2026-10-26', 1, 1, 1, 1, 1, 'test')
        `;
        const checkAt = (iso: string) => createJobHealthCheck({
            isConfigured: () => true,
            load: (jobs) => loadJobHealthData(jobs, database),
            now: () => new Date(iso).getTime(),
        })();

        assert.deepEqual((await checkAt('2026-10-28T12:00:00Z')).closes, { status: 'ok', latest: '2026-10-26', oldestAllowed: '2026-10-26' });
        assert.deepEqual((await checkAt('2026-10-29T12:00:00Z')).closes, { status: 'stale', latest: '2026-10-26', oldestAllowed: '2026-10-27' });
    });

    test('regression: a snapshots run that skipped succeeds, yet leaves the snapshots stale', async () => {
        /** The snapshot job's reads, with no portfolio to value. */
        const snapshotStore = (latest: string, holdingSplits: unknown): SnapshotStore => ({
            latestCloseDate: async () => latest,
            latestHoldingSplits: async () => holdingSplits,
            portfolios: async () => [],
            closes: async () => new Map(),
            completeDays: async () => new Map(),
            write: async () => {},
        });
        const runs = createJobRunStore(database);
        const snapshots = (latest: string, holdingSplits: unknown, startedAt: string) => runJob(
            'snapshots',
            () => recordValuationSnapshots({ store: snapshotStore(latest, holdingSplits) }),
            { store: runs, now: () => new Date(startedAt) },
        );

        // Monday's run values everything at Monday's close.
        const monday = await snapshots('2026-10-26', { skipped: 'nothing held' }, '2026-10-26T22:35:00Z');
        assert.equal(monday.status, 'succeeded');
        // Tuesday's: the price run was rate-limited before checking held
        // positions against splits, so nothing is valued, and it succeeds.
        const tuesday = await snapshots('2026-10-27', { skipped: 'rate-limited' }, '2026-10-27T22:35:00Z');
        assert.equal(tuesday.status, 'succeeded');
        assert.deepEqual(tuesday.detail, { skipped: "the holdings split check didn't run: rate-limited" });
        // A failed run's detail never counts.
        const failed = await runs.start('snapshots', new Date('2026-10-27T23:00:00Z'));
        await runs.finish(failed, { status: 'failed', finishedAt: new Date('2026-10-27T23:01:00Z'), detail: { latest: '2026-10-27' }, error: 'boom' });

        assert.equal((await loadJobHealthData(JOB_SCHEDULES.map(({ job }) => job), database)).snapshotsThrough, '2026-10-26');
        const checkAt = (iso: string) => createJobHealthCheck({
            isConfigured: () => true,
            load: (jobs) => loadJobHealthData(jobs, database),
            now: () => new Date(iso).getTime(),
        })();

        // One session behind is allowed.
        const wednesday = await checkAt('2026-10-28T12:00:00Z');
        assert.deepEqual(wednesday.snapshots, { status: 'ok', latest: '2026-10-26', oldestAllowed: '2026-10-26' });

        // Wednesday's run skips too: the job is ok, the snapshots aren't.
        assert.equal((await snapshots('2026-10-28', { skipped: 'budget' }, '2026-10-28T22:35:00Z')).status, 'succeeded');
        const thursday = await checkAt('2026-10-29T12:00:00Z');
        assert.equal(thursday.jobs.find(({ job }) => job === 'snapshots')?.status, 'ok');
        assert.deepEqual(thursday.snapshots, { status: 'stale', latest: '2026-10-26', oldestAllowed: '2026-10-27' });
        assert.equal(thursday.status, 'degraded');
    });
});
