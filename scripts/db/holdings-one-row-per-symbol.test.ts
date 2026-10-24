import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';

// Migration 0019 (launch item i41) merges holdings that repeat a symbol in
// an account before adding the unique (portfolio, symbol) index, so it can
// run on data written before the index existed. Needs a local Postgres it
// may create databases in; CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

const MIGRATION = readFileSync('drizzle/0019_holdings_one_row_per_symbol.sql', 'utf8').split('--> statement-breakpoint');

describe('migration 0019: one holdings row per symbol', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 60_000 }, () => {
    test('merges repeated symbols, then refuses new repeats', async () => {
        const name = `holdings_merge_test_${process.pid}`;
        const scratch = new URL(DATABASE_URL!);
        scratch.pathname = `/${name}`;
        const server = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
        await server.unsafe(`CREATE DATABASE ${name}`);
        const sql = postgres(scratch.toString(), { max: 1, onnotice: () => {} });
        try {
            // The columns the migration touches, as in migration 0000.
            await sql.unsafe(`CREATE TABLE holdings (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(), portfolio_id uuid NOT NULL, symbol text NOT NULL,
                name text NOT NULL DEFAULT '', quantity numeric NOT NULL, avg_cost numeric NOT NULL,
                current_price double precision, market_value double precision, allocation double precision,
                created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now())`);
            const a = '11111111-1111-4111-8111-111111111111';
            const b = '22222222-2222-4222-8222-222222222222';
            await sql`INSERT INTO holdings (portfolio_id, symbol, quantity, avg_cost, market_value, created_at) VALUES
                (${a}, 'AAPL', 10, 100, 1500, '2026-01-01'),
                (${a}, 'aapl ', 30, 200, 6000, '2026-02-01'),
                (${a}, 'MSFT', 5, 300, 1600, '2026-01-01'),
                (${b}, 'AAPL', 1, 150, 160, '2026-03-01'),
                (${a}, 'ZERO', 0, 10, 0, '2026-01-01'),
                (${a}, 'zero', 0, 20, 0, '2026-02-01')`;

            for (const statement of MIGRATION) await sql.unsafe(statement);

            const rows = await sql<{ account: string; symbol: string; quantity: number; avg_cost: number; market_value: number | null; created: string }[]>`
                SELECT left(portfolio_id::text, 2) AS account, symbol, quantity::float AS quantity, avg_cost::float AS avg_cost,
                       market_value, created_at::date::text AS created
                FROM holdings ORDER BY portfolio_id, symbol`;
            assert.deepEqual(rows.map((r) => ({ ...r })), [
                // 10 at 100 and 30 at 200: 40 at 175, on the older row, its stale value cleared.
                { account: '11', symbol: 'AAPL', quantity: 40, avg_cost: 175, market_value: null, created: '2026-01-01' },
                { account: '11', symbol: 'MSFT', quantity: 5, avg_cost: 300, market_value: 1600, created: '2026-01-01' },
                // Nothing held: the older row's cost stands.
                { account: '11', symbol: 'ZERO', quantity: 0, avg_cost: 10, market_value: null, created: '2026-01-01' },
                // Another account's AAPL is its own.
                { account: '22', symbol: 'AAPL', quantity: 1, avg_cost: 150, market_value: 160, created: '2026-03-01' },
            ]);

            await assert.rejects(
                sql`INSERT INTO holdings (portfolio_id, symbol, quantity, avg_cost) VALUES (${a}, 'AAPL', 1, 1)`,
                (error: { code?: string }) => error.code === '23505',
            );
        } finally {
            await sql.end();
            await server.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
            await server.end();
        }
    });
});
