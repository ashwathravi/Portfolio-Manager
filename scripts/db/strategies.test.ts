import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import {
    createStrategy,
    deleteStrategy,
    loadUserStrategies,
    runStrategyBacktest,
    StrategyLimitError,
    updateStrategy,
} from '../../src/lib/strategies/store';
import { STRATEGY_LIMITS } from '../../src/lib/strategies/strategy';
import type { StrategyInput } from '../../src/lib/validators/strategy';

// Launch item i55: saved strategies and their backtests, against a scratch
// database with every migration applied. Needs a local Postgres it may
// create databases in; CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

const input = (overrides: Partial<StrategyInput['definition']> = {}, name = 'Trend'): StrategyInput => ({
    name,
    description: '',
    definition: {
        rules: [{ id: 'r1', field: 'Close', op: '>', value: 'SMA(3)' }],
        conjunctions: [],
        symbols: ['AAA'],
        guardrails: { maxPositionPct: 0.5, stopLossPct: 0.2, rebalanceDays: 1 },
        ...overrides,
    },
    adherenceRules: [{ id: 'a1', type: 'stop_loss_required', params: {}, severity: 'soft' }],
});

describe('saved strategies', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `strategies_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: NonNullable<Parameters<typeof createStrategy>[2]>;

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
        for (const user of ['user-a', 'user-b', 'user-full']) {
            await sql`INSERT INTO auth_users (id, name, email) VALUES (${user}, ${user}, ${`${user}@example.test`})`;
        }
        // AAA rises 1 a session for 10 sessions from 2026-06-01; SPY from 500 to 509.
        await sql`INSERT INTO securities (symbol, name) VALUES ('AAA', 'Triple A'), ('SPY', 'SPDR S&P 500 ETF Trust')`;
        await sql`
            INSERT INTO price_bars (symbol, date, open, high, low, close, volume, source)
            SELECT s.symbol, d.date, s.base + d.i, s.base + d.i, s.base + d.i, s.base + d.i, 1000, 'test'
            FROM (VALUES ('AAA', 100), ('SPY', 500)) AS s(symbol, base)
            CROSS JOIN (
                SELECT day::date AS date, (row_number() OVER (ORDER BY day))::int - 1 AS i
                FROM generate_series(date '2026-06-01', date '2026-06-12', interval '1 day') AS day
                WHERE extract(isodow FROM day) < 6
            ) AS d`;
    });

    after(async () => {
        await sql?.end();
        await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server?.end();
    });

    test('a strategy is saved for its user, with its discipline rules, and its tickers start being tracked', async () => {
        const created = await createStrategy('user-a', input({ symbols: ['AAA', 'NEWT'] }), database);
        assert.match(created.id, /^[0-9a-f-]{36}$/);
        assert.deepEqual([created.name, created.symbols, created.adherenceRules.length, created.backtest], ['Trend', ['AAA', 'NEWT'], 1, null]);
        assert.deepEqual((await loadUserStrategies('user-a', database)).map((s) => s.id), [created.id]);
        assert.deepEqual(await loadUserStrategies('user-b', database), []);
        const tracked = await sql`SELECT symbol FROM securities WHERE symbol = 'NEWT'`;
        assert.equal(tracked.length, 1);
        await deleteStrategy('user-a', created.id, database);
    });

    test('another user can\'t change, run or delete it', async () => {
        const created = await createStrategy('user-a', input(), database);
        assert.equal(await updateStrategy('user-b', created.id, input({}, 'Hijacked'), database), null);
        assert.equal(await runStrategyBacktest('user-b', created.id, { database }), null);
        assert.equal(await deleteStrategy('user-b', created.id, database), false);
        const [still] = await loadUserStrategies('user-a', database);
        assert.equal(still.name, 'Trend');
        assert.equal(await deleteStrategy('user-a', created.id, database), true);
        assert.deepEqual(await loadUserStrategies('user-a', database), []);
    });

    test('regression: a page\'s older save that lands after its newer one changes nothing', async () => {
        const created = await createStrategy('user-b', input(), database);
        const save = (name: string, order?: { session: string; seq: number }) =>
            updateStrategy('user-b', created.id, { ...input({}, name), order }, database);

        // Sent as the page closed, seq 2 overtakes seq 1, still on its way.
        assert.equal((await save('Newer', { session: 'page-aaaa1111', seq: 2 }))?.name, 'Newer');
        assert.equal((await save('Older', { session: 'page-aaaa1111', seq: 1 }))?.name, 'Newer');
        // Another page (another tab, or a reload) and a save without an order still apply.
        assert.equal((await save('Other tab', { session: 'page-bbbb2222', seq: 1 }))?.name, 'Other tab');
        assert.equal((await save('No order'))?.name, 'No order');
        const [row] = await sql`SELECT name, write_session, write_seq FROM strategies WHERE id = ${created.id}`;
        assert.deepEqual({ ...row }, { name: 'No order', write_session: null, write_seq: null });
        await deleteStrategy('user-b', created.id, database);
    });

    test(`a user keeps at most ${STRATEGY_LIMITS.perUser} strategies`, async () => {
        for (let i = 0; i < STRATEGY_LIMITS.perUser; i++) await createStrategy('user-full', input({}, `S${i}`), database);
        await assert.rejects(createStrategy('user-full', input(), database), StrategyLimitError);
    });

    test('a backtest runs over the stored bars, is kept with the strategy, and an edit keeps it', async () => {
        const created = await createStrategy('user-a', input(), database);
        const run = await runStrategyBacktest('user-a', created.id, { database, now: new Date('2026-06-15T12:00:00Z') });
        assert.ok(run?.outcome.ok);
        const { backtest } = run.strategy;
        // SMA(3) needs 3 sessions: the window is June 3 to June 12; SPY 502 → 509.
        assert.deepEqual([backtest?.from, backtest?.to, backtest?.ranAt], ['2026-06-03', '2026-06-12', '2026-06-15T12:00:00.000Z']);
        assert.deepEqual(backtest?.benchmark, { symbol: 'SPY', totalReturnPct: 1.39 });
        assert.ok((backtest?.stats.totalReturnPct ?? 0) > 0);

        const edited = await updateStrategy('user-a', created.id, input({ symbols: ['AAA', 'SPY'] }, 'Trend 2'), database);
        assert.deepEqual(edited?.backtest, backtest);
        assert.deepEqual(edited?.backtest?.definition.symbols, ['AAA']);
    });

    test('a run that can\'t start stores nothing', async () => {
        const created = await createStrategy('user-b', input({ symbols: ['NOPE'] }), database);
        const run = await runStrategyBacktest('user-b', created.id, { database, now: new Date('2026-06-15T12:00:00Z') });
        assert.ok(run && !run.outcome.ok);
        assert.equal(run.outcome.code, 'NO_HISTORY');
        const [row] = await sql`SELECT backtest FROM strategies WHERE id = ${created.id}`;
        assert.equal(row.backtest, null);
    });

    test('the app role can read and write strategies, Supabase\'s client roles cannot', async () => {
        const grants = await sql`
            SELECT privilege_type FROM information_schema.role_table_grants
            WHERE table_name = 'strategies' AND grantee = 'app_runtime' ORDER BY privilege_type`;
        assert.deepEqual(grants.map((row) => row.privilege_type), ['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
        const policies = await sql`SELECT policyname, permissive FROM pg_policies WHERE tablename = 'strategies' ORDER BY policyname`;
        assert.deepEqual(policies.map((row) => [row.policyname, row.permissive]), [
            ['app_runtime_access', 'PERMISSIVE'],
            ['server_only_no_client_access', 'RESTRICTIVE'],
        ]);
    });
});
