import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import { claimIntradayQuotes, INTRADAY_REFRESH_MS, readIntradayRows, saveIntradayResults } from '../../src/lib/markets/intraday-quotes';

// Launch item i33: delayed quotes shared in intraday_quotes, against a
// scratch database with every migration applied. Needs a local Postgres it
// may create databases in; CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

// Monday 2 November 2026, 10:42 AM EST; the session closes at 21:00 UTC.
const NOW = new Date('2026-11-02T15:42:00Z');
const session = { closeAt: new Date('2026-11-02T21:00:00Z') };
const quote = (price: number) => ({ price, previousClose: price - 1, quotedAt: new Date('2026-11-02T15:41:58Z') });

describe('intraday quotes', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `intraday_quotes_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let pool: ReturnType<typeof postgres>;
    let database: Parameters<typeof claimIntradayQuotes>[2] & object;
    let other: Parameters<typeof claimIntradayQuotes>[2] & object;

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
        // A second connection pool: another server instance.
        pool = postgres(scratch.toString(), { max: 4, onnotice: () => {} });
        other = drizzle(pool, { schema }) as typeof other;
    });

    after(async () => {
        await pool?.end();
        await sql?.end();
        await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server?.end();
    });

    beforeEach(async () => {
        await sql`DELETE FROM intraday_quotes`;
        await sql`DELETE FROM securities`;
        await sql`INSERT INTO securities (symbol) VALUES ('AAPL'), ('MSFT'), ('NVDA'), ('IBM'), ('XYZ')`;
    });

    const options = (limit: number, now = NOW) => ({ now, session, budget: { limit, windowMs: 61_000 }, source: 'finnhub' });

    test('only tracked securities get a row', async () => {
        const { rows, claimed } = await claimIntradayQuotes(['AAPL', 'UNTRACKED'], options(50), database);

        assert.deepEqual(rows.map((row) => row.symbol), ['AAPL']);
        assert.deepEqual(claimed, ['AAPL']);
        assert.deepEqual((await sql`SELECT symbol FROM intraday_quotes`).map((row) => row.symbol), ['AAPL']);
    });

    test('two instances claiming at once share one budget and never take the same symbol', async () => {
        const symbols = ['AAPL', 'MSFT', 'NVDA', 'IBM', 'XYZ'];
        const [a, b] = await Promise.all([
            claimIntradayQuotes(symbols, options(3), database),
            claimIntradayQuotes(symbols, options(3), other),
        ]);

        assert.equal(a.claimed.length + b.claimed.length, 3);
        assert.equal(new Set([...a.claimed, ...b.claimed]).size, 3);
        // The budget is spent for this minute: nobody else gets a call.
        assert.deepEqual((await claimIntradayQuotes(symbols, options(3), database)).claimed, []);
    });

    test('a saved quote is read back, and is not fetched again within the minute', async () => {
        const { claimed } = await claimIntradayQuotes(['AAPL', 'XYZ'], options(50), database);
        await saveIntradayResults(
            [{ symbol: 'AAPL', quote: quote(231.5) }, { symbol: 'XYZ', quote: null }],
            { claimedAt: NOW, fetchedAt: new Date(NOW.getTime() + 400), source: 'finnhub' },
            database,
        );

        assert.deepEqual(claimed.sort(), ['AAPL', 'XYZ']);
        const rows = await readIntradayRows(['AAPL', 'XYZ'], database);
        const aapl = rows.find((row) => row.symbol === 'AAPL');
        assert.deepEqual(
            aapl && [aapl.price, aapl.previousClose, aapl.quotedAt?.toISOString(), aapl.claimedAt?.toISOString()],
            [231.5, 230.5, '2026-11-02T15:41:58.000Z', NOW.toISOString()],
        );
        assert.equal(rows.find((row) => row.symbol === 'XYZ')?.price, null);

        const later = new Date(NOW.getTime() + 30_000);
        assert.deepEqual((await claimIntradayQuotes(['AAPL', 'XYZ'], options(50, later), database)).claimed, []);
    });

    test('regression: a slow fetch that lands after a newer claim doesn\'t overwrite its quote', async () => {
        await claimIntradayQuotes(['AAPL'], options(50), database);
        const next = new Date(NOW.getTime() + INTRADAY_REFRESH_MS);
        await claimIntradayQuotes(['AAPL'], options(50, next), database);
        await saveIntradayResults([{ symbol: 'AAPL', quote: quote(240) }], { claimedAt: next, fetchedAt: next, source: 'finnhub' }, database);

        // The first instance's fetch, from the older claim, comes back last.
        await saveIntradayResults([{ symbol: 'AAPL', quote: quote(231.5) }], { claimedAt: NOW, fetchedAt: next, source: 'finnhub' }, database);

        const [row] = await readIntradayRows(['AAPL'], database);
        assert.equal(row.price, 240);
    });

    test('a security that stops being tracked takes its quote with it', async () => {
        await claimIntradayQuotes(['IBM'], options(50), database);
        await sql`DELETE FROM securities WHERE symbol = 'IBM'`;

        assert.equal((await sql`SELECT count(*)::int AS count FROM intraday_quotes`)[0].count, 0);
    });

    test('the app role can read and write the table, Supabase\'s client roles cannot', async () => {
        const grants = await sql`
            SELECT grantee, privilege_type FROM information_schema.role_table_grants
            WHERE table_name = 'intraday_quotes' AND grantee = 'app_runtime' ORDER BY privilege_type`;
        assert.deepEqual(grants.map((row) => row.privilege_type), ['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
        const policies = await sql`SELECT policyname, permissive, roles FROM pg_policies WHERE tablename = 'intraday_quotes' ORDER BY policyname`;
        assert.deepEqual(policies.map((row) => [row.policyname, row.permissive]), [
            ['app_runtime_access', 'PERMISSIVE'],
            ['server_only_no_client_access', 'RESTRICTIVE'],
        ]);
    });
});
