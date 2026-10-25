import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import type { PlaidFetch } from '../../src/lib/plaid/link';
import { deletePortfolio } from '../../src/lib/portfolio/manage';
import { PlaidItemNotFoundError, selectPlaidAccounts, syncAllPlaidItems, syncPlaidItem } from '../../src/lib/plaid/sync';

// Launch item i44: Plaid's holdings and investment transactions synced into
// portfolios, against a scratch database with every migration applied and a
// fake Plaid. Needs a local Postgres it may create databases in; CI's e2e
// job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();
const CONFIG = { credentials: { clientId: 'client', secret: 'secret' }, environment: 'sandbox' as const };
const NOW = new Date('2026-10-25T22:30:00.000Z');

type Handler = (body: Record<string, unknown>) => { status?: number; json: unknown };

/** A fake Plaid: one handler per endpoint, and the requests it was sent. */
function fakePlaid(handlers: Record<string, Handler>) {
    const requests: { endpoint: string; body: Record<string, unknown> }[] = [];
    const fetchImpl: PlaidFetch = async (url, init) => {
        const endpoint = new URL(url).pathname;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ endpoint, body });
        const handler = handlers[endpoint];
        if (!handler) throw new Error(`fake Plaid has no ${endpoint}`);
        const { status = 200, json } = handler(body);
        return { ok: status < 400, status, json: async () => json };
    };
    return { fetchImpl, requests };
}

const plaidError = (code: string): Handler => () => ({ status: 400, json: { error_type: 'ITEM_ERROR', error_code: code, error_message: code.toLowerCase() } });

const SECURITIES = [
    { security_id: 'sec_aapl', ticker_symbol: 'AAPL', name: 'Apple Inc.', type: 'equity' },
    { security_id: 'sec_vti', ticker_symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', type: 'etf' },
    { security_id: 'sec_msft', ticker_symbol: 'MSFT', name: 'Microsoft Corp.', type: 'equity' },
    { security_id: 'sec_cash', ticker_symbol: 'CUR:USD', name: 'U S Dollar', type: 'cash', is_cash_equivalent: true },
];

const holdingsOf = (account: string, rows: [string, number, number, number | null][], cash = 0): Handler => () => ({
    json: {
        holdings: [
            ...rows.map(([security, quantity, price, cost]) => ({
                account_id: account, security_id: security, quantity, institution_price: price,
                institution_value: quantity * price, cost_basis: cost, iso_currency_code: 'USD',
            })),
            ...(cash ? [{ account_id: account, security_id: 'sec_cash', quantity: cash, institution_price: 1, institution_value: cash, cost_basis: cash, iso_currency_code: 'USD' }] : []),
        ],
        securities: SECURITIES,
    },
});

const transactionsOf = (account: string, rows: Record<string, unknown>[]): Handler => () => ({
    json: {
        investment_transactions: rows.map((row) => ({ account_id: account, iso_currency_code: 'USD', fees: null, ...row })),
        securities: SECURITIES,
        total_investment_transactions: rows.length,
    },
});

const BUY = { investment_transaction_id: 'txn_buy', security_id: 'sec_aapl', date: '2026-03-05', name: 'BUY APPLE', quantity: 10, price: 80, amount: 800.05, fees: 0.05, type: 'buy', subtype: 'buy' };
const DIVIDEND = { investment_transaction_id: 'txn_div', security_id: 'sec_msft', date: '2026-03-10', name: 'DIVIDEND MSFT', quantity: 0, price: 0, amount: -7.5, type: 'cash', subtype: 'qualified dividend' };
const TRANSFER = { investment_transaction_id: 'txn_xfer', security_id: 'sec_vti', date: '2026-03-12', name: 'ACATS IN', quantity: 3, price: 0, amount: 0, type: 'transfer', subtype: 'transfer' };

describe('Plaid sync into portfolios', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `plaid_sync_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: Parameters<typeof syncPlaidItem>[2]['database'] & object;

    before(async () => {
        server = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
        await server.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server.unsafe(`CREATE DATABASE ${name}`);
        const scratch = new URL(DATABASE_URL!);
        scratch.pathname = `/${name}`;
        sql = postgres(scratch.toString(), { max: 1, onnotice: () => {} });
        await sql.unsafe(readFileSync('scripts/db/init-local.sql', 'utf8'));
        await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
        database = drizzle(sql, { schema });
    });

    after(async () => {
        await sql?.end();
        await server?.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server?.end();
    });

    /** A user with one Plaid item and its accounts, as Link leaves them. */
    async function linkedUser(user: string, item: string, accounts: [id: string, accountName: string, type: string][]) {
        await sql`INSERT INTO auth_users (id, email) VALUES (${user}, ${`${user}@example.test`})`;
        const [row] = await sql<{ id: string }[]>`
            INSERT INTO plaid_items (user_id, plaid_item_id, institution_id, institution_name, access_token_ciphertext, access_token_iv, access_token_auth_tag)
            VALUES (${user}, ${item}, 'ins_1', 'Fidelity', 'c', 'i', 't') RETURNING id`;
        for (const [id, accountName, type] of accounts) {
            await sql`
                INSERT INTO plaid_accounts (user_id, plaid_item_record_id, plaid_account_id, name, mask, type, subtype, capabilities, verification_status)
                VALUES (${user}, ${row.id}, ${id}, ${accountName}, '1234', ${type}, 'brokerage', '["holdings"]', 'automatically_verified')`;
        }
    }

    const statuses = (user: string) => sql<{ id: string; status: string }[]>`
        SELECT plaid_account_id AS id, sync_status AS status FROM plaid_accounts WHERE user_id = ${user} ORDER BY plaid_account_id`;
    const deps = (fetchImpl: PlaidFetch, now = NOW) => ({ config: CONFIG, database, fetchImpl, getAccessToken: async () => 'access-sandbox-1', now });

    test('Link\'s accounts wait for the pick; the pick decides which sync', async () => {
        await linkedUser('u-pick', 'item-pick', [['acc_a', 'Brokerage', 'investment'], ['acc_b', 'IRA', 'investment'], ['acc_c', 'Checking', 'depository']]);
        assert.deepEqual((await statuses('u-pick')).map((r) => r.status), ['awaiting_selection', 'awaiting_selection', 'awaiting_selection']);

        // A checking account picked too isn't an investment account to sync.
        assert.equal(await selectPlaidAccounts('u-pick', 'item-pick', ['acc_a', 'acc_c'], database), 1);
        assert.deepEqual((await statuses('u-pick')).map((r) => [r.id, r.status]), [
            ['acc_a', 'sync_ready'], ['acc_b', 'excluded'], ['acc_c', 'awaiting_selection'],
        ]);
        await assert.rejects(selectPlaidAccounts('u-someone-else', 'item-pick', ['acc_a'], database), PlaidItemNotFoundError);
    });

    test('a sync makes the portfolio, replaces its holdings and cash, and upserts its transactions', async () => {
        await linkedUser('u-sync', 'item-sync', [['acc_brokerage', 'Individual', 'investment']]);
        await selectPlaidAccounts('u-sync', 'item-sync', ['acc_brokerage'], database);

        const first = fakePlaid({
            '/investments/holdings/get': holdingsOf('acc_brokerage', [['sec_aapl', 10, 100, 800]], 250),
            '/investments/transactions/get': transactionsOf('acc_brokerage', [BUY, DIVIDEND, TRANSFER]),
        });
        const result = await syncPlaidItem('u-sync', 'item-sync', deps(first.fetchImpl));
        assert.equal(result.status, 'synced');
        assert.deepEqual(result.accounts.map(({ name, created, positions, cashUsd, transactionsAdded, transactionsUpdated, transactionsSkipped, transactionsPending }) =>
            ({ name, created, positions, cashUsd, transactionsAdded, transactionsUpdated, transactionsSkipped, transactionsPending })), [{
            name: 'Fidelity Individual', created: true, positions: 1, cashUsd: 250,
            transactionsAdded: 2, transactionsUpdated: 0, transactionsSkipped: { 'not-recorded': 1 }, transactionsPending: false,
        }]);
        // The first sync asks for two years.
        assert.equal(first.requests.find((r) => r.endpoint === '/investments/transactions/get')?.body.start_date, '2024-10-25');

        const [portfolio] = await sql<{ id: string; name: string; description: string; cash: number; source: string; external: string }[]>`
            SELECT id, name, description, cash_balance AS cash, source, external_account_id AS external FROM portfolios WHERE user_id = 'u-sync'`;
        assert.deepEqual({ ...portfolio, id: undefined }, {
            id: undefined, name: 'Fidelity Individual', description: 'Fidelity ••1234 · linked through Plaid', cash: 250, source: 'plaid', external: 'acc_brokerage',
        });
        const held = () => sql`SELECT symbol, quantity::float AS quantity, avg_cost::float AS avg, current_price AS price, market_value FROM holdings WHERE portfolio_id = ${portfolio.id} ORDER BY symbol`;
        assert.deepEqual((await held()).map((r) => ({ ...r })), [{ symbol: 'AAPL', quantity: 10, avg: 80, price: 100, market_value: null }]);
        const activity = () => sql`SELECT external_id, type, symbol, quantity::float AS quantity, price::float AS price, amount, fees::float AS fees, source FROM transactions WHERE portfolio_id = ${portfolio.id} ORDER BY external_id`;
        assert.deepEqual((await activity()).map((r) => ({ ...r })), [
            { external_id: 'plaid:txn_buy', type: 'BUY', symbol: 'AAPL', quantity: 10, price: 80, amount: 800.05, fees: 0.05, source: 'plaid' },
            { external_id: 'plaid:txn_div', type: 'DIVIDEND', symbol: 'MSFT', quantity: null, price: null, amount: 7.5, fees: null, source: 'plaid' },
        ]);
        const [account] = await sql<{ synced: boolean; status: string }[]>`
            SELECT last_synced_at = ${NOW.toISOString()}::timestamp AS synced, sync_status AS status FROM plaid_accounts WHERE plaid_account_id = 'acc_brokerage'`;
        assert.deepEqual([account.synced, account.status], [true, 'sync_ready']);

        // The user renames it and adds a position by hand; then the account changes.
        await sql`UPDATE portfolios SET name = 'My brokerage' WHERE id = ${portfolio.id}`;
        await sql`INSERT INTO holdings (portfolio_id, symbol, name, quantity, avg_cost) VALUES (${portfolio.id}, 'ZZZ', 'Hand added', 1, 1)`;
        const later = new Date('2026-10-26T22:30:00.000Z');
        const second = fakePlaid({
            '/investments/holdings/get': holdingsOf('acc_brokerage', [['sec_aapl', 12, 110, 1000], ['sec_vti', 3, 250, null]], 75),
            '/investments/transactions/get': transactionsOf('acc_brokerage', [
                { ...BUY, price: 80.5 },
                DIVIDEND,
                { investment_transaction_id: 'txn_sell', security_id: 'sec_aapl', date: '2026-10-20', name: 'SELL APPLE', quantity: -2, price: 110, amount: -220, type: 'sell', subtype: 'sell' },
            ]),
        });
        const again = await syncPlaidItem('u-sync', 'item-sync', deps(second.fetchImpl, later));
        assert.equal(again.status, 'synced');
        assert.deepEqual([again.accounts[0].created, again.accounts[0].transactionsAdded, again.accounts[0].transactionsUpdated, again.accounts[0].costUnknown], [false, 1, 2, 1]);
        // From a month before the last sync, for late postings.
        assert.equal(second.requests.find((r) => r.endpoint === '/investments/transactions/get')?.body.start_date, '2026-09-25');

        const [renamed] = await sql<{ name: string; cash: number }[]>`SELECT name, cash_balance AS cash FROM portfolios WHERE id = ${portfolio.id}`;
        assert.deepEqual({ ...renamed }, { name: 'My brokerage', cash: 75 });
        // Holdings are what the institution reports now: the hand-added one is gone.
        assert.deepEqual((await held()).map((r) => [r.symbol, r.quantity, r.avg, r.price]), [['AAPL', 12, 83.333333, 110], ['VTI', 3, 250, 250]]);
        assert.deepEqual((await activity()).map((r) => [r.external_id, r.price]), [['plaid:txn_buy', 80.5], ['plaid:txn_div', null], ['plaid:txn_sell', 110]]);
    });

    test('history that isn\'t ready yet: positions now, two years of transactions next time', async () => {
        await linkedUser('u-ready', 'item-ready', [['acc_new', 'Individual', 'investment']]);
        await selectPlaidAccounts('u-ready', 'item-ready', ['acc_new'], database);
        const plaid = fakePlaid({
            '/investments/holdings/get': holdingsOf('acc_new', [['sec_aapl', 1, 100, 90]]),
            '/investments/transactions/get': plaidError('PRODUCT_NOT_READY'),
        });
        const result = await syncPlaidItem('u-ready', 'item-ready', deps(plaid.fetchImpl));
        assert.equal(result.status, 'synced');
        assert.deepEqual([result.accounts[0].positions, result.accounts[0].transactionsPending], [1, true]);
        const [account] = await sql<{ synced: string | null }[]>`SELECT last_synced_at AS synced FROM plaid_accounts WHERE plaid_account_id = 'acc_new'`;
        assert.equal(account.synced, null);
    });

    test('a connection the institution wants signed in again stops syncing until it is', async () => {
        await linkedUser('u-login', 'item-login', [['acc_login', 'Individual', 'investment']]);
        await selectPlaidAccounts('u-login', 'item-login', ['acc_login'], database);
        const plaid = fakePlaid({ '/investments/holdings/get': plaidError('ITEM_LOGIN_REQUIRED') });
        assert.equal((await syncPlaidItem('u-login', 'item-login', deps(plaid.fetchImpl))).status, 'login-required');
        const [item] = await sql<{ status: string }[]>`SELECT status FROM plaid_items WHERE plaid_item_id = 'item-login'`;
        assert.equal(item.status, 'login_required');
        assert.equal((await sql`SELECT 1 FROM portfolios WHERE user_id = 'u-login'`).length, 0);
    });

    test('one user can\'t sync another\'s connection', async () => {
        const plaid = fakePlaid({});
        await assert.rejects(syncPlaidItem('u-someone-else', 'item-sync', deps(plaid.fetchImpl)), PlaidItemNotFoundError);
        assert.equal(plaid.requests.length, 0);
    });

    test('regression: a new linked account keeps names unique and the account limit, as manual ones do', async () => {
        await linkedUser('u-names', 'item-names', [['acc_n1', 'Individual', 'investment'], ['acc_n2', 'Roth IRA', 'investment']]);
        await selectPlaidAccounts('u-names', 'item-names', ['acc_n1'], database);
        // The user already has an account by that name, typed by hand.
        await sql`INSERT INTO portfolios (user_id, name) VALUES ('u-names', 'fidelity individual')`;
        const plaid = fakePlaid({
            '/investments/holdings/get': (body) => holdingsOf(((body.options as { account_ids: string[] }).account_ids)[0], [['sec_aapl', 1, 100, 90]])(body),
            '/investments/transactions/get': transactionsOf('acc_n1', []),
        });
        const named = await syncPlaidItem('u-names', 'item-names', deps(plaid.fetchImpl));
        assert.equal(named.status, 'synced');
        assert.deepEqual(named.accounts.map((a) => a.name), ['Fidelity Individual ••1234']);

        // At the limit, a newly picked account isn't added; the linked one still syncs.
        await sql`INSERT INTO portfolios (user_id, name) SELECT 'u-names', 'Filler ' || n FROM generate_series(1, 48) AS n`;
        await selectPlaidAccounts('u-names', 'item-names', ['acc_n1', 'acc_n2'], database);
        const full = await syncPlaidItem('u-names', 'item-names', deps(plaid.fetchImpl));
        assert.equal(full.status, 'synced');
        assert.ok(full.status === 'synced' && full.overLimit.length === 1 && full.overLimit[0] === 'Fidelity Roth IRA');
        assert.deepEqual(full.accounts.map((a) => [a.name, a.created]), [['Fidelity Individual ••1234', false]]);
        assert.equal((await sql`SELECT 1 FROM portfolios WHERE user_id = 'u-names'`).length, 50);
    });

    test('regression: a deleted linked account stays deleted, and the nightly job keeps to its budget', async () => {
        await linkedUser('u-night', 'item-night', [['acc_night', 'Individual', 'investment']]);
        await selectPlaidAccounts('u-night', 'item-night', ['acc_night'], database);
        const plaid = fakePlaid({
            '/investments/holdings/get': (body) => holdingsOf(((body.options as { account_ids: string[] }).account_ids)[0], [['sec_aapl', 1, 100, 90]])(body),
            '/investments/transactions/get': (body) => transactionsOf(((body.options as { account_ids: string[] }).account_ids)[0], [])(body),
        });
        const nightly = (budgetMs: number) => syncAllPlaidItems({ config: CONFIG, budgetMs, database, fetchImpl: plaid.fetchImpl, getAccessToken: async () => 'access-sandbox-1', clock: () => NOW.getTime() });

        // No budget: nothing synced, everything left for tomorrow.
        const none = await nightly(0);
        assert.equal(none.synced, 0);
        assert.equal(none.remaining, none.items);

        // Every active connection with an account to sync; not the one waiting for a sign-in.
        const all = await nightly(60_000);
        assert.deepEqual([all.synced, all.loginRequired, all.remaining], [all.items, 0, 0]);
        const synced = plaid.requests.filter((r) => r.endpoint === '/investments/holdings/get').map((r) => (r.body.options as { account_ids: string[] }).account_ids[0]).sort();
        assert.deepEqual(synced, ['acc_a', 'acc_brokerage', 'acc_n1', 'acc_new', 'acc_night']);

        const [portfolio] = await sql<{ id: string }[]>`SELECT id FROM portfolios WHERE user_id = 'u-night'`;
        assert.equal(await deletePortfolio('u-night', portfolio.id, database), true);
        assert.deepEqual((await statuses('u-night')).map((r) => r.status), ['excluded']);
        plaid.requests.length = 0;
        await nightly(60_000);
        assert.ok(!plaid.requests.some((r) => (r.body.options as { account_ids: string[] }).account_ids.includes('acc_night')));
        assert.equal((await sql`SELECT 1 FROM portfolios WHERE user_id = 'u-night'`).length, 0);
    });
});
