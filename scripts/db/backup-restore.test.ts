import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import type { BackupManifest } from './backups';

// Launch item i68: the nightly backup and its restore check, end to end
// through both CLIs, against scratch databases. Needs a local Postgres it may
// create databases in and the PostgreSQL client (pg_dump and pg_restore, at
// least the server's version: brew install libpq, or PG_BIN_DIR); CI's e2e
// job has both.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

describe('backup and restore', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 180_000 }, () => {
    const prefix = `backup_test_${process.pid}`;
    const created: string[] = [];
    let server: ReturnType<typeof postgres>;
    let source: ReturnType<typeof postgres>;
    let work: string;
    let backup: string;
    let rows: number;

    const urlOf = (name: string) => {
        const url = new URL(DATABASE_URL!);
        url.pathname = `/${name}`;
        return url.toString();
    };

    async function createDatabase(suffix: string): Promise<string> {
        const name = `${prefix}_${suffix}`;
        await server.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server.unsafe(`CREATE DATABASE ${name}`);
        created.push(name);
        return urlOf(name);
    }

    function run(script: 'backup' | 'restore', env: Record<string, string>, args: string[]) {
        return spawnSync(process.execPath, ['--import', 'tsx', `scripts/db/${script}.ts`, ...args], {
            env: { ...process.env, ...env },
            encoding: 'utf8',
        });
    }

    async function tablesIn(url: string): Promise<number> {
        const sql = postgres(url, { max: 1, onnotice: () => {} });
        try {
            const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'`;
            return count;
        } finally {
            await sql.end();
        }
    }

    function copyBackup(edit: (dir: string) => void): string {
        const dir = mkdtempSync(join(work, 'copy-'));
        cpSync(backup, dir, { recursive: true });
        edit(dir);
        return dir;
    }

    function editManifest(dir: string, change: (manifest: BackupManifest) => void) {
        const path = join(dir, 'manifest.json');
        const manifest = JSON.parse(readFileSync(path, 'utf8')) as BackupManifest;
        change(manifest);
        writeFileSync(path, JSON.stringify(manifest));
    }

    before(async () => {
        server = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
        const sourceUrl = await createDatabase('source');
        source = postgres(sourceUrl, { max: 1, onnotice: () => {} });
        await source.unsafe(readFileSync('scripts/db/init-local.sql', 'utf8'));
        await migrate(drizzle(source), { migrationsFolder: 'drizzle' });

        // Rows down a chain of foreign keys: user → portfolio → holdings and
        // transactions, so the restore has to load them in order.
        await source`INSERT INTO auth_users (id, name, email) VALUES ('backup-user', 'Backup User', 'backup@example.test')`;
        const [portfolio] = await source<{ id: string }[]>`
            INSERT INTO portfolios (user_id, name, cash_balance) VALUES ('backup-user', 'Brokerage', 1250.5) RETURNING id
        `;
        await source`
            INSERT INTO holdings (portfolio_id, symbol, name, quantity, avg_cost)
            VALUES (${portfolio.id}, 'IBM', 'IBM', 10, 150.25), (${portfolio.id}, 'MSFT', 'Microsoft', 3.5, 410)
        `;
        await source`
            INSERT INTO transactions (portfolio_id, symbol, type, quantity, price, timestamp)
            VALUES (${portfolio.id}, 'IBM', 'BUY', 10, 150.25, '2026-10-01T14:30:00Z')
        `;

        work = mkdtempSync(join(tmpdir(), 'backup-test-'));
        backup = join(work, 'backup');
        const result = run('backup', { BACKUP_SOURCE_URL: sourceUrl, GITHUB_SHA: 'test-commit' }, ['--out', backup]);
        assert.equal(result.status, 0, result.stderr);
        // Every row in the source, migrations' own included.
        rows = 0;
        for (const { name } of await source<{ name: string }[]>`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`) {
            const [{ count }] = await source<{ count: number }[]>`SELECT count(*)::int AS count FROM public.${source(name)}`;
            rows += count;
        }
        assert.match(result.stdout, new RegExp(`✅ Backed up \\d+ tables, ${rows} rows, \\d+ migrations`));
    });

    after(async () => {
        await source?.end();
        for (const name of created) {
            await server?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        }
        await server?.end();
        if (work) rmSync(work, { recursive: true, force: true });
    });

    test('records every table\'s rows and the migrations applied', () => {
        const manifest = JSON.parse(readFileSync(join(backup, 'manifest.json'), 'utf8')) as BackupManifest;
        const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: { when: number }[] };
        assert.equal(manifest.commit, 'test-commit');
        assert.deepEqual(manifest.migrations.map((m) => m.createdAt), journal.entries.map((e) => e.when));
        assert.equal(manifest.tables.auth_users, 1);
        assert.equal(manifest.tables.portfolios, 1);
        assert.equal(manifest.tables.holdings, 2);
        assert.equal(manifest.tables.transactions, 1);
        assert.equal(manifest.tables.order_plans, 0);
    });

    test('restores into an empty database with every row, and says so', async () => {
        const target = await createDatabase('restored');
        const result = run('restore', { RESTORE_DATABASE_URL: target }, ['--from', backup]);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, new RegExp(`✅ Restored the backup from .*: \\d+ tables, ${rows} rows, \\d+ migrations\\. Every table matches\\.`));

        const restored = postgres(target, { max: 1, onnotice: () => {} });
        try {
            const query = (sql: ReturnType<typeof postgres>) => sql`
                SELECT p.name, p.cash_balance, h.symbol, h.quantity, h.avg_cost
                FROM portfolios p JOIN holdings h ON h.portfolio_id = p.id ORDER BY h.symbol
            `;
            assert.deepEqual([...(await query(restored))], [...(await query(source))]);
            // The schema came from the migrations, with the app's grants.
            const [{ granted }] = await restored<{ granted: boolean }[]>`
                SELECT has_table_privilege('app_runtime', 'public.holdings', 'SELECT, INSERT, UPDATE, DELETE') AS granted
            `;
            assert.equal(granted, true);
        } finally {
            await restored.end();
        }
    });

    test('refuses a database that already has tables, leaving it alone', async () => {
        const result = run('restore', { RESTORE_DATABASE_URL: urlOf(`${prefix}_source`) }, ['--from', backup]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /The target database isn't empty/);
        const [{ count }] = await source<{ count: number }[]>`SELECT count(*)::int AS count FROM holdings`;
        assert.equal(count, 2);
    });

    test('refuses a damaged dump before touching the target', async () => {
        const damaged = copyBackup((dir) => appendFileSync(join(dir, 'data.dump'), 'x'));
        const target = await createDatabase('damaged');
        const result = run('restore', { RESTORE_DATABASE_URL: target }, ['--from', damaged]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /data\.dump doesn't match the hash in the manifest/);
        assert.equal(await tablesIn(target), 0);
    });

    test('refuses a backup with migrations this checkout doesn\'t have', async () => {
        const newer = copyBackup((dir) => editManifest(dir, (m) => {
            m.migrations.push({ hash: 'f'.repeat(64), createdAt: Number.MAX_SAFE_INTEGER });
        }));
        const target = await createDatabase('newer');
        const result = run('restore', { RESTORE_DATABASE_URL: target }, ['--from', newer]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /this checkout only has \d+\. Check out test-commit/);
        assert.equal(await tablesIn(target), 0);
    });

    test('fails, naming the table, when a count doesn\'t match the backup', async () => {
        const wrong = copyBackup((dir) => editManifest(dir, (m) => {
            m.tables.holdings = 3;
        }));
        const target = await createDatabase('mismatch');
        const result = run('restore', { RESTORE_DATABASE_URL: target }, ['--from', wrong]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Table holdings: 3 rows in the backup, 2 restored\./);
    });

    test('refuses to back up into a directory that already holds something', () => {
        const result = run('backup', { BACKUP_SOURCE_URL: urlOf(`${prefix}_source`) }, ['--out', backup]);
        assert.equal(result.status, 2);
        assert.match(result.stderr, /isn't empty; a backup goes into a new directory/);
    });
});
