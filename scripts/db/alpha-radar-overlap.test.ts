import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import { applyAlphaRadarUserOverlap, loadAlphaRadarUserOverlap } from '../../src/lib/alpha-radar/user-overlap';
import type { AlphaRadarMemoChange } from '../../src/lib/alpha-radar/memo';

// Launch item i61: what Alpha Radar reads of a user to show where a filer's
// 13F changes meet them (their holdings, watchlist and active theses),
// against a scratch database with every migration applied. Needs a local
// Postgres it may create databases in; CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

const NONE = { portfolio: false, watchlist: false, thesis: false, reasons: [], matchedTickers: [], matchedCusips: [] };

describe('Alpha Radar overlap with a user', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `alpha_radar_overlap_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: NonNullable<Parameters<typeof loadAlphaRadarUserOverlap>[1]>;

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

        for (const user of ['user-a', 'user-b']) {
            await sql`INSERT INTO auth_users (id, name, email) VALUES (${user}, ${user}, ${`${user}@example.test`})`;
        }
        const [brokerage] = await sql`INSERT INTO portfolios (user_id, name) VALUES ('user-a', 'Brokerage') RETURNING id`;
        const [ira] = await sql`INSERT INTO portfolios (user_id, name) VALUES ('user-a', 'IRA') RETURNING id`;
        const [other] = await sql`INSERT INTO portfolios (user_id, name) VALUES ('user-b', 'Other') RETURNING id`;
        await sql`
            INSERT INTO holdings (portfolio_id, symbol, name, quantity, avg_cost) VALUES
                (${brokerage.id}, 'AAPL', 'Apple Inc', 10, 150),
                (${ira.id}, 'AAPL', 'APPLE INC COM', 5, 120),
                (${ira.id}, 'GOOGL', 'Alphabet Inc. Class A', 3, 100),
                (${brokerage.id}, 'MSFT', 'Microsoft Corp', 0, 300),
                (${other.id}, 'XUSR', 'Cross Tenant Sentinel', 1, 1)`;
        await sql`
            INSERT INTO watchlist_items (user_id, id, ticker, company_name, added_at, dismissed) VALUES
                ('user-a', 'w-1', 'CB', 'Chubb', '2026-11-01', false),
                ('user-a', 'w-coin', 'COIN', 'Coinbase Global, Inc.', '2026-11-01', false),
                ('user-a', 'w-2', 'PG', 'Procter & Gamble', '2026-11-01', true),
                ('user-b', 'w-3', 'KO', 'Coca-Cola', '2026-11-01', false)`;
        const thesis = (user: string, id: string, ticker: string, status: string, dismissed = false) => sql`
            INSERT INTO theses (user_id, id, ticker, company_name, title, type, status, conviction, target_price, date_created, date_updated, dismissed)
            VALUES (${user}, ${id}, ${ticker}, '', ${`${ticker} thesis`}, 'bull', ${status}, 'MEDIUM', 100, '2026-11-01', '2026-11-01', ${dismissed})`;
        await thesis('user-a', 't-1', 'TSLA', 'active');
        await thesis('user-a', 't-2', 'AMZN', 'archived');
        await thesis('user-a', 't-3', 'META', 'monitoring');
        await thesis('user-a', 't-4', 'NFLX', 'active', true);
        await thesis('user-a', 'seed-nvda', 'NVDA', 'active');
        await sql`
            INSERT INTO symbol_directory (symbol, name, exchange, cik, position) VALUES
                ('AAPL', 'Apple Inc.', 'Nasdaq', '0000320193', 0),
                ('CB', 'Chubb Ltd', 'NYSE', '0000896159', 300),
                ('TSLA', 'Tesla, Inc.', 'Nasdaq', '0001318605', 8)`;
    });

    after(async () => {
        await sql?.end();
        await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server?.end();
    });

    test('a user\'s positions in every account, watchlist and active theses, with each company\'s names', async () => {
        assert.deepEqual(await loadAlphaRadarUserOverlap('user-a', database), {
            portfolio: [
                { ticker: 'AAPL', names: ['APPLE INC COM', 'Apple Inc', 'Apple Inc.'] },
                { ticker: 'GOOGL', names: ['Alphabet Inc. Class A'] },
            ],
            watchlist: [{ ticker: 'CB', names: ['Chubb', 'Chubb Ltd'] }],
            thesis: [{ ticker: 'TSLA', names: ['Tesla, Inc.'] }],
        });
    });

    test('leaves out a closed position, a removed watchlist item, archived, monitoring and removed theses, and the examples', async () => {
        const overlap = await loadAlphaRadarUserOverlap('user-a', database);
        const tickers = [...overlap.portfolio, ...overlap.watchlist, ...overlap.thesis].map((security) => security.ticker);
        for (const ticker of ['MSFT', 'PG', 'COIN', 'AMZN', 'META', 'NFLX', 'NVDA']) {
            assert.equal(tickers.includes(ticker), false, ticker);
        }
    });

    test('one user\'s records never reach another\'s overlap', async () => {
        assert.deepEqual(await loadAlphaRadarUserOverlap('user-b', database), {
            portfolio: [{ ticker: 'XUSR', names: ['Cross Tenant Sentinel'] }],
            watchlist: [{ ticker: 'KO', names: ['Coca-Cola'] }],
            thesis: [],
        });
        assert.deepEqual(await loadAlphaRadarUserOverlap('nobody', database), { portfolio: [], watchlist: [], thesis: [] });
    });

    test('a 13F\'s changes, which name issuers and not tickers, meet the user through those names', async () => {
        const change = (issuerName: string, cusip: string): AlphaRadarMemoChange => ({
            trackedFilerId: '00000000-0000-4000-8000-0000000000b1', reportPeriod: '2026-Q3', changeType: 'increased',
            issuerName, cusip, materialityScore: 40, userRelevance: NONE, displayReason: '',
        });
        const changes = [change('APPLE INC', '037833100'), change('CHUBB LIMITED', 'H1467J104'), change('TESLA INC', '88160R101'), change('MICROSOFT CORP', '594918104')];

        const reasons = (overlap: Awaited<ReturnType<typeof loadAlphaRadarUserOverlap>>) =>
            applyAlphaRadarUserOverlap(changes, overlap).map((item) => [item.issuerName, item.userRelevance.reasons]);
        assert.deepEqual(reasons(await loadAlphaRadarUserOverlap('user-a', database)), [
            ['APPLE INC', ['Held in portfolio']],
            ['CHUBB LIMITED', ['On watchlist']],
            ['TESLA INC', ['Linked to active thesis']],
            ['MICROSOFT CORP', []],
        ]);
        assert.ok(reasons(await loadAlphaRadarUserOverlap('user-b', database)).every(([, list]) => list.length === 0));
    });
});
