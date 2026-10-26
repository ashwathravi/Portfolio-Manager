import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import type { PlaidFetch } from '../../src/lib/plaid/link';
import { deletePortfolio } from '../../src/lib/portfolio/manage';
import { disconnectPlaidItem, handlePlaidWebhook, listPlaidConnections } from '../../src/lib/plaid/connections';
import { PlaidItemNotFoundError, selectPlaidAccounts, syncAllPlaidItems, syncPlaidItem } from '../../src/lib/plaid/sync';

// Launch item i44: Plaid's holdings and investment transactions synced into
// portfolios, against a scratch database with every migration applied and a
// fake Plaid. Needs a local Postgres it may create databases in; CI's e2e
// job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();
const CONFIG = { credentials: { clientId: 'client', secret: 'secret' }, environment: 'sandbox' as const };
const NOW = new Date('2026-10-25T22:30:00.000Z');

type Reply = { status?: number; json: unknown };
type Handler = (body: Record<string, unknown>) => Reply | Promise<Reply>;

/** A fake Plaid: one handler per endpoint, and the requests it was sent. */
function fakePlaid(handlers: Record<string, Handler>) {
    const requests: { endpoint: string; body: Record<string, unknown> }[] = [];
    const fetchImpl: PlaidFetch = async (url, init) => {
        const endpoint = new URL(url).pathname;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        requests.push({ endpoint, body });
        const handler = handlers[endpoint];
        if (!handler) throw new Error(`fake Plaid has no ${endpoint}`);
        const { status = 200, json } = await handler(body);
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

        // A pick sent again ("Sync now" sends the accounts connected in
        // Settings) changes only accounts still waiting: an excluded one
        // stays excluded, a picked one stays picked.
        assert.equal(await selectPlaidAccounts('u-pick', 'item-pick', ['acc_b'], database), 0);
        assert.deepEqual((await statuses('u-pick')).map((r) => [r.id, r.status]), [
            ['acc_a', 'sync_ready'], ['acc_b', 'excluded'], ['acc_c', 'excluded'],
        ]);
    });

    test('regression: an account linked before picks were kept is picked by "Sync now"', async () => {
        // The Codex finding on PR #162: migration 0022 puts such accounts back
        // to waiting, and a sync without a pick synced nothing.
        await linkedUser('u-old', 'item-old', [['acc_old', 'Individual', 'investment'], ['acc_other', 'Joint', 'investment']]);
        const plaid = fakePlaid({
            '/investments/holdings/get': holdingsOf('acc_old', [['sec_aapl', 2, 100, 150]]),
            '/investments/transactions/get': transactionsOf('acc_old', []),
        });
        assert.deepEqual((await syncPlaidItem('u-old', 'item-old', deps(plaid.fetchImpl))).accounts, []);
        assert.equal(await selectPlaidAccounts('u-old', 'item-old', ['acc_old'], database), 1);
        const synced = await syncPlaidItem('u-old', 'item-old', deps(plaid.fetchImpl));
        assert.deepEqual(synced.accounts.map((a) => [a.name, a.positions]), [['Fidelity Individual', 1]]);
        assert.deepEqual((await statuses('u-old')).map((r) => [r.id, r.status]), [['acc_old', 'sync_ready'], ['acc_other', 'excluded']]);
    });

    test('regression: a sync that finds nothing new doesn\'t look like a change to the snapshot job', async () => {
        // The Codex finding on PR #162: every sync moved updated_at, which
        // the snapshot job takes as the last change, so a linked account
        // synced each evening never got a snapshot.
        await linkedUser('u-snap', 'item-snap', [['acc_snap', 'Individual', 'investment']]);
        await selectPlaidAccounts('u-snap', 'item-snap', ['acc_snap'], database);
        const run = async (rows: [string, number, number, number | null][], cash: number, at: string) => {
            const plaid = fakePlaid({
                '/investments/holdings/get': holdingsOf('acc_snap', rows, cash),
                '/investments/transactions/get': transactionsOf('acc_snap', []),
            });
            assert.equal((await syncPlaidItem('u-snap', 'item-snap', deps(plaid.fetchImpl, new Date(at)))).status, 'synced');
            const [p] = await sql<{ at: string }[]>`SELECT updated_at::text AS at FROM portfolios WHERE user_id = 'u-snap'`;
            const h = await sql<{ symbol: string; at: string; price: number }[]>`
                SELECT symbol, h.updated_at::text AS at, current_price AS price FROM holdings h JOIN portfolios p ON p.id = h.portfolio_id WHERE p.user_id = 'u-snap' ORDER BY symbol`;
            return { portfolio: p.at, holdings: h.map((r) => [r.symbol, r.at, r.price]) };
        };
        const first = await run([['sec_aapl', 10, 100, 800], ['sec_vti', 1, 250, 200]], 50, '2026-10-20T22:30:00.000Z');
        assert.deepEqual(first, { portfolio: '2026-10-20 22:30:00', holdings: [['AAPL', '2026-10-20 22:30:00', 100], ['VTI', '2026-10-20 22:30:00', 250]] });
        // Same positions and cash, new prices: nothing moves but the prices.
        assert.deepEqual(await run([['sec_aapl', 10, 104, 800], ['sec_vti', 1, 251, 200]], 50, '2026-10-21T22:30:00.000Z'),
            { portfolio: '2026-10-20 22:30:00', holdings: [['AAPL', '2026-10-20 22:30:00', 104], ['VTI', '2026-10-20 22:30:00', 251]] });
        // A changed quantity moves that holding and the portfolio.
        assert.deepEqual(await run([['sec_aapl', 12, 104, 1000], ['sec_vti', 1, 251, 200]], 50, '2026-10-22T22:30:00.000Z'),
            { portfolio: '2026-10-22 22:30:00', holdings: [['AAPL', '2026-10-22 22:30:00', 104], ['VTI', '2026-10-20 22:30:00', 251]] });
        // A sold-out position leaves no holding to date it: the portfolio moves.
        assert.deepEqual(await run([['sec_aapl', 12, 104, 1000]], 50, '2026-10-23T22:30:00.000Z'),
            { portfolio: '2026-10-23 22:30:00', holdings: [['AAPL', '2026-10-22 22:30:00', 104]] });
        // So does the cash alone.
        assert.equal((await run([['sec_aapl', 12, 104, 1000]], 75, '2026-10-26T22:30:00.000Z')).portfolio, '2026-10-26 22:30:00');
    });

    test('regression: an account deleted while Plaid is answering stays deleted', async () => {
        // The Codex finding on PR #162: the sync wrote it back and set it to
        // sync again. Deleting and a sync's write share the account lock.
        await linkedUser('u-race', 'item-race', [['acc_race', 'Individual', 'investment']]);
        await selectPlaidAccounts('u-race', 'item-race', ['acc_race'], database);
        const holdings = holdingsOf('acc_race', [['sec_aapl', 1, 100, 90]]);
        await syncPlaidItem('u-race', 'item-race', deps(fakePlaid({ '/investments/holdings/get': holdings, '/investments/transactions/get': transactionsOf('acc_race', []) }).fetchImpl));
        const [portfolio] = await sql<{ id: string }[]>`SELECT id FROM portfolios WHERE user_id = 'u-race'`;

        const plaid = fakePlaid({
            '/investments/holdings/get': holdings,
            '/investments/transactions/get': async (body) => {
                // The user deletes the account while the sync waits on Plaid.
                assert.equal(await deletePortfolio('u-race', portfolio.id, database), true);
                return transactionsOf('acc_race', [BUY])(body);
            },
        });
        const result = await syncPlaidItem('u-race', 'item-race', deps(plaid.fetchImpl, new Date('2026-10-26T22:30:00.000Z')));
        assert.deepEqual([result.status, result.accounts], ['synced', []]);
        assert.equal((await sql`SELECT 1 FROM portfolios WHERE user_id = 'u-race'`).length, 0);
        assert.deepEqual((await statuses('u-race')).map((r) => r.status), ['excluded']);
    });

    test('regression: an older sync finishing after a newer one doesn\'t replace what it wrote', async () => {
        // The Codex finding on PR #162: the nightly job and "Sync now"
        // overlapping, the one that started first could write last.
        await linkedUser('u-overlap', 'item-overlap', [['acc_overlap', 'Individual', 'investment']]);
        await selectPlaidAccounts('u-overlap', 'item-overlap', ['acc_overlap'], database);
        const sync = (quantity: number, at: string) => syncPlaidItem('u-overlap', 'item-overlap', deps(fakePlaid({
            '/investments/holdings/get': holdingsOf('acc_overlap', [['sec_aapl', quantity, 100, quantity * 90]]),
            '/investments/transactions/get': transactionsOf('acc_overlap', []),
        }).fetchImpl, new Date(at)));
        // The newer sync (started 22:31) writes first; the older (22:30) after.
        assert.equal((await sync(7, '2026-10-27T22:31:00.000Z')).accounts.length, 1);
        assert.deepEqual((await sync(5, '2026-10-27T22:30:00.000Z')).accounts, []);
        const [held] = await sql<{ quantity: number }[]>`
            SELECT h.quantity::float AS quantity FROM holdings h JOIN portfolios p ON p.id = h.portfolio_id WHERE p.user_id = 'u-overlap'`;
        assert.equal(held.quantity, 7);
        const [account] = await sql<{ holdings: string; history: string }[]>`
            SELECT holdings_synced_at::text AS holdings, last_synced_at::text AS history FROM plaid_accounts WHERE plaid_account_id = 'acc_overlap'`;
        assert.deepEqual({ ...account }, { holdings: '2026-10-27 22:31:00', history: '2026-10-27 22:31:00' });
    });

    test('regression: a sync past its deadline stops, writing nothing', async () => {
        // The Codex finding on PR #162: the nightly budget wasn't enforced
        // inside a connection's sync.
        await linkedUser('u-slow', 'item-slow', [['acc_slow', 'Individual', 'investment']]);
        await selectPlaidAccounts('u-slow', 'item-slow', ['acc_slow'], database);
        let now = NOW.getTime();
        const plaid = fakePlaid({
            '/investments/holdings/get': (body) => {
                now += 45_000; // Plaid takes 45 s to answer
                return holdingsOf('acc_slow', [['sec_aapl', 1, 100, 90]])(body);
            },
            '/investments/transactions/get': transactionsOf('acc_slow', []),
        });
        const result = await syncPlaidItem('u-slow', 'item-slow', { ...deps(plaid.fetchImpl), deadline: NOW.getTime() + 30_000, clock: () => now });
        assert.equal(result.status, 'timed-out');
        assert.ok(!plaid.requests.some((r) => r.endpoint === '/investments/transactions/get'));
        assert.equal((await sql`SELECT 1 FROM portfolios WHERE user_id = 'u-slow'`).length, 0);
        // Tried, though it didn't finish: the nightly job takes others first next time.
        const [item] = await sql<{ tried: boolean; synced: string | null }[]>`
            SELECT last_sync_attempt_at = ${NOW.toISOString()}::timestamp AS tried, last_successful_sync_at::text AS synced FROM plaid_items WHERE plaid_item_id = 'item-slow'`;
        assert.deepEqual({ ...item }, { tried: true, synced: null });
    });

    test('regression: the nightly job takes the least recently tried connection first, not the least recently synced', async () => {
        // The Codex finding on PR #162: a connection that kept running out of
        // time never synced, so it stayed first and took every night's turn.
        await linkedUser('u-rot-a', 'item-rot-a', [['acc_rot_a', 'Individual', 'investment']]);
        await linkedUser('u-rot-b', 'item-rot-b', [['acc_rot_b', 'Individual', 'investment']]);
        await selectPlaidAccounts('u-rot-a', 'item-rot-a', ['acc_rot_a'], database);
        await selectPlaidAccounts('u-rot-b', 'item-rot-b', ['acc_rot_b'], database);
        // B never synced, but was tried last night; A synced a while ago.
        await sql`UPDATE plaid_items SET last_sync_attempt_at = '2026-10-24 22:30', last_successful_sync_at = NULL WHERE plaid_item_id = 'item-rot-b'`;
        await sql`UPDATE plaid_items SET last_sync_attempt_at = '2026-10-01 22:30', last_successful_sync_at = '2026-10-01 22:30' WHERE plaid_item_id = 'item-rot-a'`;
        const plaid = fakePlaid({
            '/investments/holdings/get': (body) => holdingsOf(((body.options as { account_ids: string[] }).account_ids)[0], [['sec_aapl', 1, 100, 90]])(body),
            '/investments/transactions/get': (body) => transactionsOf(((body.options as { account_ids: string[] }).account_ids)[0], [])(body),
        });
        await syncAllPlaidItems({ config: CONFIG, budgetMs: 60_000, database, fetchImpl: plaid.fetchImpl, getAccessToken: async () => 'access-sandbox-1', clock: () => NOW.getTime() });
        const order = plaid.requests.filter((r) => r.endpoint === '/investments/holdings/get').map((r) => (r.body.options as { account_ids: string[] }).account_ids[0]);
        assert.ok(order.indexOf('acc_rot_a') < order.indexOf('acc_rot_b'), order.join(','));
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
        await linkedUser('u-names', 'item-names', [['acc_n1', 'Individual', 'investment']]);
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
        // An account the connection gains later, picked then.
        await sql`
            INSERT INTO plaid_accounts (user_id, plaid_item_record_id, plaid_account_id, name, mask, type, subtype, capabilities, verification_status)
            SELECT 'u-names', id, 'acc_n2', 'Roth IRA', '9876', 'investment', 'roth', '["holdings"]', 'automatically_verified' FROM plaid_items WHERE plaid_item_id = 'item-names'`;
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
        // The connections of the tests above too; never one waiting for a
        // sign-in, nor a deleted account.
        assert.ok(synced.includes('acc_night') && synced.includes('acc_brokerage'));
        assert.ok(!synced.includes('acc_login') && !synced.includes('acc_race'));

        const [portfolio] = await sql<{ id: string }[]>`SELECT id FROM portfolios WHERE user_id = 'u-night'`;
        assert.equal(await deletePortfolio('u-night', portfolio.id, database), true);
        assert.deepEqual((await statuses('u-night')).map((r) => r.status), ['excluded']);
        plaid.requests.length = 0;
        await nightly(60_000);
        assert.ok(!plaid.requests.some((r) => (r.body.options as { account_ids: string[] }).account_ids.includes('acc_night')));
        assert.equal((await sql`SELECT 1 FROM portfolios WHERE user_id = 'u-night'`).length, 0);
    });

    // Launch items i45 and i46: connections as Settings lists them,
    // disconnecting, and what Plaid's webhooks change.

    const itemRow = (item: string) => sql<{ status: string; revoked: boolean; token: string }[]>`
        SELECT status, revoked_at IS NOT NULL AS revoked, access_token_ciphertext AS token FROM plaid_items WHERE plaid_item_id = ${item}`;

    test('Settings lists the user\'s connections from the database, each account with what it syncs into', async () => {
        const [connection] = await listPlaidConnections('u-sync', database);
        assert.equal(connection.itemId, 'item-sync');
        assert.equal(connection.institutionName, 'Fidelity');
        assert.equal(connection.status, 'active');
        assert.ok(connection.lastSuccessfulSyncAt);
        assert.deepEqual(connection.accounts.map((a) => [a.plaidAccountId, a.syncStatus, a.portfolio?.name ?? null]), [['acc_brokerage', 'sync_ready', 'My brokerage']]);
        // Picks and statuses as they are (the nightly test above synced acc_a).
        const picked = await listPlaidConnections('u-pick', database);
        assert.deepEqual(picked[0].accounts.map((a) => [a.plaidAccountId, a.type, a.syncStatus, a.portfolio?.name ?? null]), [
            ['acc_a', 'investment', 'sync_ready', 'Fidelity Brokerage'], ['acc_c', 'depository', 'excluded', null], ['acc_b', 'investment', 'excluded', null],
        ]);
        assert.deepEqual(await listPlaidConnections('u-nobody', database), []);
    });

    test('disconnecting ends it at Plaid, revokes it here with its token wiped, and keeps the accounts brought in', async () => {
        await linkedUser('u-disc', 'item-disc', [['acc_disc', 'Individual', 'investment']]);
        await selectPlaidAccounts('u-disc', 'item-disc', ['acc_disc'], database);
        await syncPlaidItem('u-disc', 'item-disc', deps(fakePlaid({
            '/investments/holdings/get': holdingsOf('acc_disc', [['sec_aapl', 1, 100, 90]]),
            '/investments/transactions/get': transactionsOf('acc_disc', []),
        }).fetchImpl));

        // Plaid can't be told: nothing changes, to try again.
        const down = fakePlaid({ '/item/remove': () => ({ status: 500, json: { error_type: 'API_ERROR', error_code: 'INTERNAL_SERVER_ERROR', error_message: 'down' } }) });
        await assert.rejects(disconnectPlaidItem('u-disc', 'item-disc', { config: CONFIG, database, fetchImpl: down.fetchImpl, getAccessToken: async () => 'access-sandbox-1' }));
        assert.deepEqual((await itemRow('item-disc')).map((r) => r.status), ['active']);

        await assert.rejects(disconnectPlaidItem('u-someone-else', 'item-disc', { config: CONFIG, database, getAccessToken: async () => 'x' }), PlaidItemNotFoundError);

        const plaid = fakePlaid({ '/item/remove': () => ({ json: { request_id: 'r' } }) });
        await disconnectPlaidItem('u-disc', 'item-disc', { config: CONFIG, database, fetchImpl: plaid.fetchImpl, getAccessToken: async () => 'access-sandbox-1', now: NOW });
        assert.deepEqual(plaid.requests.map((r) => [r.endpoint, r.body.access_token]), [['/item/remove', 'access-sandbox-1']]);
        assert.deepEqual((await itemRow('item-disc')).map((r) => ({ ...r })), [{ status: 'revoked', revoked: true, token: '' }]);
        assert.deepEqual((await statuses('u-disc')).map((r) => r.status), ['excluded']);
        assert.equal((await sql`SELECT 1 FROM portfolios WHERE user_id = 'u-disc'`).length, 1);
        assert.deepEqual(await listPlaidConnections('u-disc', database), []);
        await assert.rejects(disconnectPlaidItem('u-disc', 'item-disc', { config: CONFIG, database, getAccessToken: async () => 'x' }), PlaidItemNotFoundError);
    });

    test('disconnecting one Plaid has already let go of still revokes it here', async () => {
        await linkedUser('u-gone', 'item-gone', [['acc_gone', 'Individual', 'investment']]);
        const gone = fakePlaid({ '/item/remove': () => ({ status: 400, json: { error_type: 'ITEM_ERROR', error_code: 'ITEM_NOT_FOUND', error_message: 'gone' } }) });
        await disconnectPlaidItem('u-gone', 'item-gone', { config: CONFIG, database, fetchImpl: gone.fetchImpl, getAccessToken: async () => 'access-sandbox-1' });
        assert.deepEqual((await itemRow('item-gone')).map((r) => r.status), ['revoked']);
    });

    test('webhooks: new data syncs the connection; item events change its status', async () => {
        await linkedUser('u-hook', 'item-hook', [['acc_hook', 'Individual', 'investment'], ['acc_hook2', 'IRA', 'investment']]);
        await selectPlaidAccounts('u-hook', 'item-hook', ['acc_hook', 'acc_hook2'], database);
        const scheduled: string[] = [];
        const hook = (body: Record<string, unknown>) => handlePlaidWebhook({ item_id: 'item-hook', ...body }, {
            database, now: NOW, scheduleSync: (userId, itemId) => scheduled.push(`${userId}/${itemId}`),
        });
        const status = async () => (await itemRow('item-hook'))[0].status;

        assert.deepEqual(await hook({ webhook_type: 'HOLDINGS', webhook_code: 'DEFAULT_UPDATE' }), { action: 'sync', connections: 1 });
        assert.deepEqual(await hook({ webhook_type: 'INVESTMENTS_TRANSACTIONS', webhook_code: 'HISTORICAL_UPDATE' }), { action: 'sync', connections: 1 });
        assert.deepEqual(scheduled, ['u-hook/item-hook', 'u-hook/item-hook']);

        assert.equal((await hook({ webhook_type: 'ITEM', webhook_code: 'ERROR', error: { error_code: 'ITEM_LOGIN_REQUIRED' } })).action, 'login-required');
        assert.equal(await status(), 'login_required');
        // Waiting for a sign-in, new data doesn't sync it.
        assert.deepEqual(await hook({ webhook_type: 'HOLDINGS', webhook_code: 'DEFAULT_UPDATE' }), { action: 'ignored', connections: 0 });
        assert.equal(scheduled.length, 2);
        // Another error isn't a status change.
        assert.equal((await hook({ webhook_type: 'ITEM', webhook_code: 'ERROR', error: { error_code: 'INSTITUTION_DOWN' } })).action, 'ignored');

        assert.equal((await hook({ webhook_type: 'ITEM', webhook_code: 'LOGIN_REPAIRED' })).action, 'repaired');
        assert.equal(await status(), 'active');
        assert.equal((await hook({ webhook_type: 'ITEM', webhook_code: 'PENDING_EXPIRATION' })).action, 'expiring');
        assert.equal(await status(), 'pending_expiration');

        assert.equal((await hook({ webhook_type: 'ITEM', webhook_code: 'USER_ACCOUNT_REVOKED', account_id: 'acc_hook2' })).action, 'account-revoked');
        assert.deepEqual((await statuses('u-hook')).map((r) => [r.id, r.status]), [['acc_hook', 'sync_ready'], ['acc_hook2', 'excluded']]);

        assert.equal((await hook({ webhook_type: 'ITEM', webhook_code: 'USER_PERMISSION_REVOKED' })).action, 'revoked');
        assert.deepEqual((await itemRow('item-hook')).map((r) => ({ ...r })), [{ status: 'revoked', revoked: true, token: '' }]);
        // Revoked, nothing more is done for it.
        assert.deepEqual(await hook({ webhook_type: 'HOLDINGS', webhook_code: 'DEFAULT_UPDATE' }), { action: 'ignored', connections: 0 });
        assert.deepEqual(await handlePlaidWebhook({ webhook_type: 'HOLDINGS', webhook_code: 'DEFAULT_UPDATE', item_id: 'item-unknown' }, { database, scheduleSync: () => assert.fail('no sync') }), { action: 'ignored', connections: 0 });
    });

    test('a sync that goes through after Link\'s update mode marks the login repaired', async () => {
        await linkedUser('u-repair', 'item-repair', [['acc_repair', 'Individual', 'investment']]);
        await selectPlaidAccounts('u-repair', 'item-repair', ['acc_repair'], database);
        await sql`UPDATE plaid_items SET status = 'login_required' WHERE plaid_item_id = 'item-repair'`;
        const result = await syncPlaidItem('u-repair', 'item-repair', deps(fakePlaid({
            '/investments/holdings/get': holdingsOf('acc_repair', [['sec_aapl', 1, 100, 90]]),
            '/investments/transactions/get': transactionsOf('acc_repair', []),
        }).fetchImpl));
        assert.equal(result.status, 'synced');
        assert.equal((await itemRow('item-repair'))[0].status, 'active');
    });
});

