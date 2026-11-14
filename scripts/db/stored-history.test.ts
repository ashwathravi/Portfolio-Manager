import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import { getStoredHistory } from '../../src/lib/markets/price-store';

// x09: what a chart reads of a symbol's stored history, against a scratch
// database with every migration applied. Bars alone can't tell a backfilled
// history from the few days the daily files stored while the backfill waits,
// so the read says whether the symbol is tracked and since when its history
// is loaded. Needs a local Postgres it may create databases in; CI's e2e
// job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

describe('stored history for charts (x09)', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `stored_history_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: Parameters<typeof getStoredHistory>[3] & object;

    before(async () => {
        server = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
        await server.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server.unsafe(`CREATE DATABASE ${name}`);
        const scratch = new URL(DATABASE_URL!);
        scratch.pathname = `/${name}`;
        sql = postgres(scratch.toString(), { max: 2, onnotice: () => {} });
        await sql.unsafe(readFileSync('scripts/db/init-local.sql', 'utf8'));
        await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
        database = drizzle(sql, { schema }) as typeof database;

        // AAPL backfilled; SHOP tracked from a lookup, one daily file in, its
        // backfill pending; FXAIX backfilled with nothing (Massive doesn't
        // price mutual funds), marked loaded at the day the backfill covered.
        await sql`INSERT INTO securities (symbol, name, history_start_date) VALUES
            ('AAPL', 'Apple Inc.', '2024-11-13'),
            ('SHOP', 'Shopify Inc.', NULL),
            ('FXAIX', 'Fidelity 500 Index Fund', '2026-11-12')`;
        await sql`INSERT INTO price_bars (symbol, date, open, high, low, close, volume, source) VALUES
            ('AAPL', '2026-10-13', 1, 1, 1, 240, 1, 'massive'),
            ('AAPL', '2026-11-12', 1, 1, 1, 250, 1, 'massive'),
            ('AAPL', '2026-11-13', 1, 1, 1, 252, 1, 'massive'),
            ('SHOP', '2026-11-13', 1, 1, 1, 120, 1, 'massive')`;
    });

    after(async () => {
        await sql?.end();
        await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server?.end();
    });

    const read = async (symbol: string) => {
        const history = await getStoredHistory(symbol, '2026-10-14', '2026-11-13', database);
        return { ...history, bars: history.bars.map((bar) => [bar.date, bar.close]) };
    };

    test('a backfilled symbol: its start and its bars in the window, oldest first', async () => {
        assert.deepEqual(await read('AAPL'), {
            tracked: true,
            historyStart: '2024-11-13',
            bars: [['2026-11-12', 250], ['2026-11-13', 252]],
        });
    });

    test('a symbol waiting for its backfill: tracked, no start, only the daily files\' bars', async () => {
        assert.deepEqual(await read('SHOP'), { tracked: true, historyStart: null, bars: [['2026-11-13', 120]] });
    });

    test('a backfill that found nothing: loaded, with no bars', async () => {
        assert.deepEqual(await read('FXAIX'), { tracked: true, historyStart: '2026-11-12', bars: [] });
    });

    test('a symbol the store doesn\'t track', async () => {
        assert.deepEqual(await read('ZZZZ'), { tracked: false, historyStart: null, bars: [] });
    });
});
