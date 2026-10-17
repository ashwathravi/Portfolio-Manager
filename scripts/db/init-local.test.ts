import { describe, test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';

// Needs a local Postgres it may create databases in; CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

function run(command: string, args: string[], databaseUrl: string) {
    return spawnSync(command, args, {
        env: { ...process.env, DATABASE_MIGRATION_URL: databaseUrl, DATABASE_URL: databaseUrl },
        encoding: 'utf8',
    });
}

test('init-local.ts - leaves a database that is not local alone', () => {
    // Connecting would fail on this host, so exiting 0 shows it never tried.
    const result = run(process.execPath, ['--import', 'tsx', 'scripts/db/init-local.ts'], 'postgres://owner:secret@db.example.invalid:5432/production');
    assert.strictEqual(result.status, 0, result.stderr);
});

describe('npm run db:migrate', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    test('prepares and migrates a database that has never been set up', async () => {
        const name = `db_migrate_test_${process.pid}`;
        const fresh = new URL(DATABASE_URL!);
        fresh.pathname = `/${name}`;
        const server = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
        await server.unsafe(`CREATE DATABASE ${name}`);
        const database = postgres(fresh.toString(), { max: 1, onnotice: () => {} });
        try {
            const [before] = await database`SELECT count(*)::int AS count FROM pg_extension WHERE extname = 'pgcrypto'`;
            assert.strictEqual(before.count, 0);

            const result = run('npm', ['run', '--silent', 'db:migrate'], fresh.toString());
            assert.strictEqual(result.status, 0, result.stdout + result.stderr);

            const [after] = await database`SELECT count(*)::int AS count FROM pg_extension WHERE extname = 'pgcrypto'`;
            assert.strictEqual(after.count, 1);
            const [migrations] = await database`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
            assert.ok(migrations.count > 0);
        } finally {
            await database.end();
            await server.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
            await server.end();
        }
    });
});
