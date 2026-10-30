import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import { buildJobHealthQuery, createJobHealthCheck, JOB_SCHEDULES } from '../../src/lib/health/job-health';
import { createJobRunStore } from '../../src/lib/jobs/runner';
import { BACKUP_JOB, recordBackupRun } from './backups';

// Launch item i71: /api/health/jobs reads the runs the nightly jobs and the
// backup workflow record, against a scratch database with every migration
// applied, on a session in another time zone (started_at holds UTC without
// one). Needs a local Postgres it may create databases in; CI's e2e job sets
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

    test('the check reads them into each job\'s status', async () => {
        const check = createJobHealthCheck({
            isConfigured: () => true,
            load: (jobs) => buildJobHealthQuery(jobs, database),
            now: () => new Date('2026-10-28T12:00:00Z').getTime(),
        });

        const report = await check();

        assert.equal(report.status, 'degraded');
        assert.deepEqual(
            Object.fromEntries(report.jobs.map((job) => [job.job, job.status])),
            Object.fromEntries(JOB_SCHEDULES.map(({ job }) => [job, ({ prices: 'failed', plaid: 'failed', backup: 'ok' } as Record<string, string>)[job] ?? 'late'])),
        );
    });
});
