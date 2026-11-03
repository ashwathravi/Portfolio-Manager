import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import { replaceDirectory, searchTickers, type DirectoryEntry } from '../../src/lib/markets/symbol-directory';

// Launch item i35: ticker search over symbol_directory, against a scratch
// database with every migration applied. Needs a local Postgres it may
// create databases in; CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

const entry = (symbol: string, name: string, exchange: string | null, position: number): DirectoryEntry =>
    ({ symbol, name, exchange, cik: '0000000001', position });

// In SEC's order, largest companies first.
const DIRECTORY = [
    entry('AAPL', 'Apple Inc.', 'Nasdaq', 0),
    entry('MSFT', 'MICROSOFT CORP', 'Nasdaq', 2),
    entry('BRK.B', 'BERKSHIRE HATHAWAY INC', 'NYSE', 9),
    entry('MU', 'MICRON TECHNOLOGY INC', 'Nasdaq', 11),
    entry('BAC', 'BANK OF AMERICA CORP', 'NYSE', 29),
    entry('APLE', 'Apple Hospitality REIT, Inc.', 'NYSE', 1525),
    entry('APPF', 'AppFolio Inc', 'Nasdaq', 2000),
    entry('PCT', '100% Pure Co', 'Nasdaq', 3008),
    entry('HOLO', 'MicroCloud Hologram Inc.', 'Nasdaq', 5477),
    entry('APPLY', 'Apply Systems', 'OTC', 9000),
];

describe('ticker search', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `symbol_directory_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: Parameters<typeof searchTickers>[1]['database'] & object;

    before(async () => {
        server = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
        await server.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server.unsafe(`CREATE DATABASE ${name}`);
        const scratch = new URL(DATABASE_URL!);
        scratch.pathname = `/${name}`;
        sql = postgres(scratch.toString(), { max: 1, onnotice: () => {} });
        await sql.unsafe(readFileSync('scripts/db/init-local.sql', 'utf8'));
        await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
        database = drizzle(sql, { schema }) as typeof database;

        // User A holds VOO, which SEC's file doesn't list. User B holds ZEDX,
        // tracked in the price store with its reference data.
        for (const [user, symbol, holding] of [['user-a', 'VOO', 'Vanguard S&P 500 ETF'], ['user-b', 'ZEDX', 'Zed Example Fund']]) {
            await sql`INSERT INTO auth_users (id, name, email) VALUES (${user}, ${user}, ${`${user}@example.test`})`;
            const [p] = await sql<{ id: string }[]>`INSERT INTO portfolios (user_id, name) VALUES (${user}, 'Brokerage') RETURNING id`;
            await sql`INSERT INTO holdings (portfolio_id, symbol, name, quantity, avg_cost) VALUES (${p.id}, ${symbol}, ${holding}, 1, 1)`;
        }
        await sql`INSERT INTO securities (symbol, name, type, primary_exchange) VALUES
            ('SPY', 'SPDR S&P 500 ETF Trust', 'ETF', 'ARCX'),
            ('ZEDX', 'Zed Example Fund', 'ETF', 'ARCX')`;
    });

    after(async () => {
        await sql?.end();
        await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server?.end();
    });

    beforeEach(async () => {
        await sql`DELETE FROM symbol_directory`;
        await replaceDirectory(DIRECTORY, new Date('2026-11-02T22:31:00Z'), database);
    });

    const search = async (query: string, userId = 'user-a') =>
        (await searchTickers(query, { userId, database })).map((match) => [match.symbol, match.name, match.exchange, match.held]);

    test('finds companies by name, best first, and tickers by how they start, OTC last', async () => {
        assert.deepEqual(await search('apple'), [
            ['AAPL', 'Apple Inc.', 'Nasdaq', false],
            ['APLE', 'Apple Hospitality REIT, Inc.', 'NYSE', false],
        ]);
        assert.deepEqual((await search('app')).map(([symbol]) => symbol), ['APPF', 'APPLY', 'AAPL', 'APLE']);
        assert.deepEqual(await search('brk b'), [['BRK.B', 'BERKSHIRE HATHAWAY INC', 'NYSE', false]]);
        assert.deepEqual((await search('of amer')).map(([symbol]) => symbol), ['BAC']);
        // Ties go to the larger company: Microsoft before Micron, whatever the ticker's length.
        assert.deepEqual((await search('micro')).map(([symbol]) => symbol), ['MSFT', 'MU', 'HOLO']);
    });

    test('finds the benchmark ETFs and the user\'s own holdings, which SEC\'s file leaves out', async () => {
        assert.deepEqual(await search('spy'), [['SPY', 'SPDR S&P 500 ETF Trust', 'NYSE Arca', false]]);
        assert.deepEqual(await search('vanguard'), [['VOO', 'Vanguard S&P 500 ETF', null, true]]);
    });

    test('regression: a held company is found by its directory name, even outside the directory\'s best matches', async () => {
        // A CSV import without a description names the holding by its ticker.
        await sql`INSERT INTO auth_users (id, name, email) VALUES ('user-c', 'user-c', 'user-c@example.test')`;
        const [p] = await sql<{ id: string }[]>`INSERT INTO portfolios (user_id, name) VALUES ('user-c', 'Brokerage') RETURNING id`;
        await sql`INSERT INTO holdings (portfolio_id, symbol, name, quantity, avg_cost) VALUES (${p.id}, 'HOLO', 'HOLO', 1, 1)`;

        // The directory's best two for "micro" are MSFT and MU; HOLO, held, ties with them and goes first.
        const matches = await searchTickers('micro', { userId: 'user-c', limit: 2, database });
        assert.deepEqual(matches, [
            { symbol: 'HOLO', name: 'MicroCloud Hologram Inc.', exchange: 'Nasdaq', held: true },
            { symbol: 'MSFT', name: 'MICROSOFT CORP', exchange: 'Nasdaq', held: false },
        ]);
    });

    test('never shows another user\'s holdings, or what they brought into the price store', async () => {
        assert.deepEqual(await search('vanguard', 'user-b'), []);
        assert.deepEqual(await search('zed'), []);
        assert.deepEqual(await search('zedx'), []);
        assert.deepEqual(await search('zed', 'user-b'), [['ZEDX', 'Zed Example Fund', null, true]]);
    });

    test('a % or _ in the query matches only itself', async () => {
        assert.deepEqual((await search('100%')).map(([symbol]) => symbol), ['PCT']);
        assert.deepEqual(await search('%'), [['PCT', '100% Pure Co', 'Nasdaq', false]]);
        assert.deepEqual(await search('_'), []);
    });

    test('a refresh writes only what changed and removes what SEC no longer lists', async () => {
        const later = new Date('2026-11-03T22:31:00Z');
        const next = [
            ...DIRECTORY.filter((e) => e.symbol !== 'APPLY' && e.symbol !== 'BAC'),
            entry('BAC', 'Bank of America Corporation', 'NYSE', 29),
            entry('NEWCO', 'New Listing Co', null, 9500),
        ];

        assert.deepEqual(await replaceDirectory(next, later, database), { added: 1, removed: 1 });

        const rows = await sql<{ symbol: string; name: string; updated: string }[]>`
            SELECT symbol, name, updated_at::text AS updated FROM symbol_directory ORDER BY symbol`;
        assert.deepEqual(rows.map((row) => row.symbol), ['AAPL', 'APLE', 'APPF', 'BAC', 'BRK.B', 'HOLO', 'MSFT', 'MU', 'NEWCO', 'PCT']);
        const updated = Object.fromEntries(rows.map((row) => [row.symbol, row.updated]));
        assert.equal(updated.AAPL, '2026-11-02 22:31:00');
        assert.equal(updated.BAC, '2026-11-03 22:31:00');
        assert.equal(rows.find((row) => row.symbol === 'BAC')?.name, 'Bank of America Corporation');
    });

    test('the app role can read and write the directory, Supabase\'s client roles cannot', async () => {
        const grants = await sql`
            SELECT privilege_type FROM information_schema.role_table_grants
            WHERE table_name = 'symbol_directory' AND grantee = 'app_runtime' ORDER BY privilege_type`;
        assert.deepEqual(grants.map((row) => row.privilege_type), ['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
        const policies = await sql`SELECT policyname, permissive FROM pg_policies WHERE tablename = 'symbol_directory' ORDER BY policyname`;
        assert.deepEqual(policies.map((row) => [row.policyname, row.permissive]), [
            ['app_runtime_access', 'PERMISSIVE'],
            ['server_only_no_client_access', 'RESTRICTIVE'],
        ]);
    });
});
