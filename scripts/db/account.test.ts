import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import { AccountDeletionBlockedError, deleteAccount } from '../../src/lib/account/delete';
import { buildAccountExport } from '../../src/lib/account/export';
import type { PlaidFetch } from '../../src/lib/plaid/link';

// Launch item i65: deleting an account and exporting its data, against a
// scratch database with every migration applied and a fake Plaid. Needs a
// local Postgres it may create databases in; CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();
const CONFIG = { credentials: { clientId: 'client', secret: 'secret' }, environment: 'sandbox' as const };
const NOW = new Date('2026-10-26T18:00:00.000Z');

describe('account deletion and export', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `account_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    /** A second session, for writes that land while a deletion runs. */
    let other: ReturnType<typeof postgres>;
    let database: Parameters<typeof deleteAccount>[1]['database'] & object;

    before(async () => {
        server = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
        await server.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server.unsafe(`CREATE DATABASE ${name}`);
        const scratch = new URL(DATABASE_URL!);
        scratch.pathname = `/${name}`;
        sql = postgres(scratch.toString(), { max: 1, onnotice: () => {} });
        other = postgres(scratch.toString(), { max: 1, onnotice: () => {} });
        await sql.unsafe(readFileSync('scripts/db/init-local.sql', 'utf8'));
        await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
        database = drizzle(sql, { schema });
    });

    after(async () => {
        await other?.end();
        await sql?.end();
        await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server?.end();
    });

    /** A user with one of everything Atlas keeps, and a Plaid connection. */
    async function seedUser(user: string) {
        await sql`INSERT INTO auth_users (id, name, email) VALUES (${user}, ${`Name ${user}`}, ${`${user}@example.test`})`;
        await sql`INSERT INTO auth_sessions (session_token, user_id, expires) VALUES (${`s-${user}`}, ${user}, '2099-01-01')`;
        await sql`INSERT INTO auth_verification_tokens (identifier, token, expires) VALUES (${`${user}@example.test`}, ${`t-${user}`}, '2099-01-01')`;
        const [p] = await sql<{ id: string }[]>`INSERT INTO portfolios (user_id, name, cash_balance) VALUES (${user}, 'Brokerage', 250) RETURNING id`;
        await sql`INSERT INTO holdings (portfolio_id, symbol, name, quantity, avg_cost, current_price) VALUES (${p.id}, 'AAPL', 'Apple', 10, 80, 100)`;
        await sql`INSERT INTO transactions (portfolio_id, symbol, type, quantity, price, timestamp, amount, notes) VALUES (${p.id}, 'AAPL', 'BUY', 10, 80, '2026-03-05 12:00', 800, 'starter')`;
        await sql`INSERT INTO portfolio_snapshots (portfolio_id, date, holdings_value, cash, total_value, cost_basis, positions, unpriced) VALUES (${p.id}, '2026-10-23', 1000, 250, 1250, 800, 1, '{}')`;
        await sql`INSERT INTO portfolio_snapshot_positions (portfolio_id, date, symbol, quantity, cost_basis, close, close_date, market_value) VALUES (${p.id}, '2026-10-23', 'AAPL', 10, 800, 100, '2026-10-23', 1000)`;
        await sql`INSERT INTO user_settings (user_id, version, settings) VALUES (${user}, 15, ${JSON.stringify({ demo: { showSampleData: false } })}::jsonb)`;
        await sql`INSERT INTO watchlist_items (user_id, id, ticker, company_name, reason, notes, added_at, write_session, write_seq) VALUES (${user}, 'w-1', 'MSFT', 'Microsoft', 'cloud', 'n', '2026-03-01', 'session-1', 1)`;
        await sql`INSERT INTO watchlist_items (user_id, id, ticker, company_name, reason, notes, added_at, dismissed, write_session, write_seq) VALUES (${user}, 'w-2', 'TSLA', '', '', '', '2026-03-01', true, 'session-1', 2)`;
        await sql`INSERT INTO journal_entries (user_id, id, date, type, ticker, decision, rationale, outcome, write_session, write_seq) VALUES (${user}, 'j-1', '2026-03-05', 'entry', 'AAPL', 'Bought', 'cheap', 'pending', 'session-1', 3)`;
        await sql`INSERT INTO theses (user_id, id, ticker, title, description, type, status, conviction, target_price, date_created, date_updated, write_session, write_seq) VALUES (${user}, 't-1', 'AAPL', 'Services', 'd', 'bull', 'active', 'HIGH', 250, '2026-03-01', '2026-03-01', 'session-1', 4)`;
        await sql`INSERT INTO thesis_catalysts (user_id, thesis_id, id, position, title, impact) VALUES (${user}, 't-1', 'c-1', 0, 'Earnings', 'high')`;
        await sql`INSERT INTO thesis_evidence (user_id, thesis_id, id, position, title, type, url) VALUES (${user}, 't-1', 'e-1', 0, 'Filing', 'report', 'https://example.test/10k')`;
        const [item] = await sql<{ id: string }[]>`
            INSERT INTO plaid_items (user_id, plaid_item_id, institution_id, institution_name, access_token_ciphertext, access_token_iv, access_token_auth_tag)
            VALUES (${user}, ${`item-${user}`}, 'ins_1', 'Fidelity', 'secret-cipher', 'i', 't') RETURNING id`;
        await sql`
            INSERT INTO plaid_accounts (user_id, plaid_item_record_id, plaid_account_id, name, mask, type, subtype, capabilities, verification_status, sync_status)
            VALUES (${user}, ${item.id}, ${`acc-${user}`}, 'Individual', '1234', 'investment', 'brokerage', '["holdings"]', 'automatically_verified', 'sync_ready')`;
        return p.id;
    }

    async function rowsOf(user: string) {
        const [counts] = await sql<Record<string, number>[]>`
            SELECT
                (SELECT count(*) FROM auth_users WHERE id = ${user})::int AS users,
                (SELECT count(*) FROM auth_sessions WHERE user_id = ${user})::int AS sessions,
                (SELECT count(*) FROM auth_verification_tokens WHERE identifier = ${`${user}@example.test`})::int AS tokens,
                (SELECT count(*) FROM portfolios WHERE user_id = ${user})::int AS portfolios,
                (SELECT count(*) FROM holdings h JOIN portfolios p ON p.id = h.portfolio_id WHERE p.user_id = ${user})::int AS holdings,
                (SELECT count(*) FROM portfolio_snapshot_positions s JOIN portfolios p ON p.id = s.portfolio_id WHERE p.user_id = ${user})::int AS snapshot_positions,
                (SELECT count(*) FROM user_settings WHERE user_id = ${user})::int AS settings,
                (SELECT count(*) FROM watchlist_items WHERE user_id = ${user})::int AS watchlist,
                (SELECT count(*) FROM journal_entries WHERE user_id = ${user})::int AS journal,
                (SELECT count(*) FROM theses WHERE user_id = ${user})::int AS theses,
                (SELECT count(*) FROM thesis_catalysts WHERE user_id = ${user})::int AS catalysts,
                (SELECT count(*) FROM thesis_evidence WHERE user_id = ${user})::int AS evidence,
                (SELECT count(*) FROM plaid_items WHERE user_id = ${user})::int AS plaid_items,
                (SELECT count(*) FROM plaid_accounts WHERE user_id = ${user})::int AS plaid_accounts`;
        return { ...counts };
    }

    const plaidThat = (status: number) => {
        const requests: string[] = [];
        const fetchImpl: PlaidFetch = async (url, init) => {
            requests.push(`${new URL(url).pathname} ${JSON.parse(String(init.body)).access_token}`);
            return { ok: status < 400, status, json: async () => (status < 400 ? { request_id: 'r' } : { error_type: 'API_ERROR', error_code: 'INTERNAL_SERVER_ERROR', error_message: 'down' }) };
        };
        return { fetchImpl, requests };
    };

    test('the export holds everything the user has, as they\'d recognize it, and nothing internal or secret', async () => {
        const portfolioId = await seedUser('u-export');
        await seedUser('u-other');
        const data = await buildAccountExport('u-export', database, NOW);

        assert.equal(data.format, 'atlas-wealth-export');
        assert.equal(data.exportedAt, NOW.toISOString());
        assert.deepEqual(data.profile, { name: 'Name u-export', email: 'u-export@example.test' });
        assert.deepEqual(data.settings?.settings, { demo: { showSampleData: false } });
        assert.equal(data.accounts.length, 1);
        const [account] = data.accounts;
        assert.deepEqual([account.id, account.name, account.source, account.cashBalance], [portfolioId, 'Brokerage', 'manual', 250]);
        assert.deepEqual(account.holdings.map((h) => [h.symbol, h.quantity, h.avgCost, h.lastPrice]), [['AAPL', 10, 80, 100]]);
        assert.deepEqual(account.transactions.map((t) => [t.date, t.type, t.symbol, t.quantity, t.price, t.amount, t.notes]), [
            ['2026-03-05T12:00:00.000Z', 'BUY', 'AAPL', 10, 80, 800, 'starter'],
        ]);
        // Each day's positions too: Returns is computed from them, and the
        // totals alone can't rebuild them.
        assert.deepEqual(account.valuationHistory, [{
            date: '2026-10-23', totalValue: 1250, holdingsValue: 1000, cash: 250, costBasis: 800,
            positions: [{ symbol: 'AAPL', quantity: 10, costBasis: 800, close: 100, closeDate: '2026-10-23', marketValue: 1000 }],
        }]);
        assert.deepEqual(data.linkedConnections.map((c) => [c.institutionName, c.accounts.map((a) => [a.name, a.mask, a.syncing])]), [['Fidelity', [['Individual', '1234', true]]]]);
        // A removed watchlist ticker is a marker, not the user's data.
        assert.deepEqual(data.watchlist.map((w) => w.ticker), ['MSFT']);
        assert.deepEqual(data.journal.map((j) => j.rationale), ['cheap']);
        assert.deepEqual(data.theses.map((t) => [t.title, (t.catalysts as unknown[]).length, (t.evidence as unknown[]).length]), [['Services', 1, 1]]);

        const text = JSON.stringify(data);
        for (const leak of ['userId', 'writeSession', 'writeSeq', 'dismissed', 'secret-cipher', 'item-u-export', 'acc-u-export', 'u-other']) {
            assert.ok(!text.includes(leak), leak);
        }
    });

    test('deleting ends the user\'s Plaid connections, then removes every row of theirs, and nobody else\'s', async () => {
        await seedUser('u-delete');
        await sql`INSERT INTO alpha_radar_tracked_filers (name, slug, cik) VALUES ('Shared filer', 'shared-filer', '0000000001')`;
        const before = await rowsOf('u-delete');
        assert.ok(Object.values(before).every((n) => n > 0), JSON.stringify(before));
        const others = await rowsOf('u-other');

        const plaid = plaidThat(200);
        assert.deepEqual(
            await deleteAccount('u-delete', { plaid: CONFIG, database, fetchImpl: plaid.fetchImpl, getAccessToken: async () => 'access-sandbox-1', now: NOW }),
            { accounts: 1, connections: 1 },
        );
        assert.deepEqual(plaid.requests, ['/item/remove access-sandbox-1']);
        assert.deepEqual(await rowsOf('u-delete'), Object.fromEntries(Object.keys(before).map((k) => [k, 0])));
        assert.deepEqual(await rowsOf('u-other'), others);
        assert.equal((await sql`SELECT 1 FROM alpha_radar_tracked_filers WHERE slug = 'shared-filer'`).length, 1);
    });

    test('regression: a connection Plaid can\'t be told about blocks the deletion, and nothing is deleted', async () => {
        await seedUser('u-blocked');
        const before = await rowsOf('u-blocked');
        await assert.rejects(
            deleteAccount('u-blocked', { plaid: CONFIG, database, fetchImpl: plaidThat(500).fetchImpl, getAccessToken: async () => 'access-sandbox-1', now: NOW }),
            (error: unknown) => error instanceof AccountDeletionBlockedError && error.institutions.join() === 'Fidelity',
        );
        assert.deepEqual(await rowsOf('u-blocked'), before);
        // Plaid not set up here, with a connection open: blocked too.
        await assert.rejects(deleteAccount('u-blocked', { plaid: null, database, now: NOW }), AccountDeletionBlockedError);
        assert.deepEqual(await rowsOf('u-blocked'), before);
    });

    test('regression: a connection linked while the others are being ended blocks the deletion, and nothing is deleted', async () => {
        await seedUser('u-late-link');
        const plaid = plaidThat(200);
        const fetchImpl: PlaidFetch = async (url, init) => {
            // The user links another institution in a second tab meanwhile.
            await other`
                INSERT INTO plaid_items (user_id, plaid_item_id, institution_id, institution_name, access_token_ciphertext, access_token_iv, access_token_auth_tag)
                VALUES ('u-late-link', 'item-late', 'ins_2', 'Schwab', 'late-cipher', 'i', 't')`;
            return plaid.fetchImpl(url, init);
        };
        await assert.rejects(
            deleteAccount('u-late-link', { plaid: CONFIG, database, fetchImpl, getAccessToken: async () => 'access-sandbox-1', now: NOW }),
            (error: unknown) => error instanceof AccountDeletionBlockedError && error.institutions.join() === 'Schwab',
        );
        const left = await rowsOf('u-late-link');
        assert.deepEqual([left.users, left.portfolios, left.plaid_items], [1, 1, 2]);
        // Trying again ends the new one too.
        assert.deepEqual(
            await deleteAccount('u-late-link', { plaid: CONFIG, database, fetchImpl: plaid.fetchImpl, getAccessToken: async () => 'access-sandbox-2', now: NOW }),
            { accounts: 1, connections: 1 },
        );
        assert.equal((await rowsOf('u-late-link')).users, 0);
    });

    test('regression: an account being added when the deletion starts is deleted with the rest, not a failed deletion', async () => {
        await seedUser('u-race');
        let inserted!: () => void;
        let release!: () => void;
        const insertedYet = new Promise<void>((resolve) => { inserted = resolve; });
        const held = new Promise<void>((resolve) => { release = resolve; });
        const adding = other.begin(async (transaction) => {
            const tx = transaction as unknown as typeof other;
            await tx`INSERT INTO portfolios (user_id, name) VALUES ('u-race', 'Added meanwhile')`;
            inserted();
            await held;
        });
        await insertedYet;
        const deletion = deleteAccount('u-race', { plaid: CONFIG, database, fetchImpl: plaidThat(200).fetchImpl, getAccessToken: async () => 'access-sandbox-1', now: NOW });
        try {
            // The deletion waits for the open transaction rather than
            // missing its row.
            const deadline = Date.now() + 10_000;
            while ((await server`SELECT 1 FROM pg_stat_activity WHERE datname = ${name} AND wait_event_type = 'Lock'`).length === 0) {
                assert.ok(Date.now() < deadline, 'the deletion never waited for the account being added');
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
        } finally {
            release();
            await adding;
        }
        assert.deepEqual(await deletion, { accounts: 2, connections: 1 });
        assert.equal((await rowsOf('u-race')).users, 0);
    });

    test('a user without linked connections is deleted without asking Plaid', async () => {
        await seedUser('u-plain');
        await sql`UPDATE plaid_items SET status = 'revoked', revoked_at = now() WHERE user_id = 'u-plain'`;
        const plaid = plaidThat(500);
        assert.deepEqual(await deleteAccount('u-plain', { plaid: null, database, fetchImpl: plaid.fetchImpl, now: NOW }), { accounts: 1, connections: 0 });
        assert.equal(plaid.requests.length, 0);
        assert.equal((await rowsOf('u-plain')).users, 0);
    });
});
