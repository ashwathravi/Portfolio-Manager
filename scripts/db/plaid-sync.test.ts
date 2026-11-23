import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import { listOptionContractsToMark } from '../../src/lib/markets/option-marks';
import type { PlaidFetch } from '../../src/lib/plaid/link';
import { importHoldings } from '../../src/lib/portfolio/importHoldings';
import { deletePortfolio } from '../../src/lib/portfolio/manage';
import { updateManualHolding } from '../../src/lib/portfolio/manual-holdings';
import {
    addOptionPosition,
    deleteOptionPosition,
    DuplicateOptionPositionError,
    loadOptionPositions,
    SyncedOptionPositionError,
    updateOptionPosition,
} from '../../src/lib/portfolio/option-positions-store';
import { optionPositionSchema, type OptionPositionInput } from '../../src/lib/validators/option-position';
import { createSnapshotStore, readManualHistory } from '../../src/lib/portfolio/valuation-snapshots';
import { MAX_PLAID_CONNECTIONS_PER_USER, PlaidTokenUnavailableError, disconnectPlaidItem, handlePlaidWebhook, listPlaidConnections } from '../../src/lib/plaid/connections';
import { createDrizzlePlaidTokenRegistryStore, resetPlaidTokenVaultForTests, setPlaidTokenRegistryStoreForTests, storePlaidConnection } from '../../src/lib/plaid/server-token-vault';
import { PlaidItemNotFoundError, connectedAccountFingerprints, refreshPlaidItem, selectPlaidAccounts, syncAllPlaidItems, syncPlaidItem, writeAccountSync } from '../../src/lib/plaid/sync';

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
    // An option with its contract's details (launch item i63), and a warrant without any.
    {
        security_id: 'sec_acme_c150', ticker_symbol: 'ACME270115C00150000', name: 'ACME Jan 15 2027 150 Call', type: 'derivative',
        option_contract: { contract_type: 'call', expiration_date: '2027-01-15', strike_price: 150, underlying_security_ticker: 'ACME' },
    },
    { security_id: 'sec_acme_w', ticker_symbol: 'ACMEW', name: 'ACME Warrants', type: 'derivative' },
];

const holdingsOf = (account: string, rows: [string, number, number, number | null][], cash = 0, securities: readonly object[] = SECURITIES): Handler => () => ({
    json: {
        holdings: [
            ...rows.map(([security, quantity, price, cost]) => ({
                account_id: account, security_id: security, quantity, institution_price: price,
                institution_value: quantity * price, cost_basis: cost, iso_currency_code: 'USD',
            })),
            ...(cash ? [{ account_id: account, security_id: 'sec_cash', quantity: cash, institution_price: 1, institution_value: cash, cost_basis: cash, iso_currency_code: 'USD' }] : []),
        ],
        securities,
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
    let scratchUrl: string;

    before(async () => {
        server = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
        await server.unsafe(`DROP DATABASE IF EXISTS ${name}`);
        await server.unsafe(`CREATE DATABASE ${name}`);
        const scratch = new URL(DATABASE_URL!);
        scratch.pathname = `/${name}`;
        scratchUrl = scratch.toString();
        sql = postgres(scratchUrl, { max: 1, onnotice: () => {} });
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

    test('a fund with no ticker: kept per account, its new value alone is a price, and an edit takes over only its own account\'s', async () => {
        await linkedUser('u-fund', 'item-fund', [['acc_fx', 'Brokerage', 'investment'], ['acc_fy', 'IRA', 'investment']]);
        await selectPlaidAccounts('u-fund', 'item-fund', ['acc_fx', 'acc_fy'], database);
        const FUND = { security_id: 'sec_fund', ticker_symbol: null, name: 'Stable Value Fund', type: 'mutual fund', cusip: '123456789' };
        const plaidWith = (price: number) => fakePlaid({
            '/investments/holdings/get': (body) => ({
                json: {
                    holdings: (body.options as { account_ids: string[] }).account_ids.flatMap((account) => [
                        { account_id: account, security_id: 'sec_aapl', quantity: 1, institution_price: 100, institution_value: 100, cost_basis: 90, iso_currency_code: 'USD' },
                        { account_id: account, security_id: 'sec_fund', quantity: 10, institution_price: price, institution_value: 10 * price, cost_basis: 100, iso_currency_code: 'USD' },
                    ]),
                    securities: [...SECURITIES, FUND],
                },
            }),
            '/investments/transactions/get': transactionsOf('acc_fx', []),
        });
        const fund = () => sql<{ account: string; source: string; value: number; external: string }[]>`
            SELECT p.external_account_id AS account, m.source, m.value::float AS value, m.external_id AS external
            FROM manual_holdings m JOIN portfolios p ON p.id = m.portfolio_id WHERE m.user_id = 'u-fund' ORDER BY p.external_account_id`;
        const lastChange = async () => (await sql<{ at: string }[]>`SELECT max(updated_at)::text AS at FROM portfolios WHERE user_id = 'u-fund'`)[0].at;

        await syncPlaidItem('u-fund', 'item-fund', deps(plaidWith(11).fetchImpl));
        const first = await fund();
        assert.deepEqual(first.map((r) => [r.account, r.source, r.value]), [['acc_fx', 'plaid', 110], ['acc_fy', 'plaid', 110]]);
        assert.notEqual(first[0].external, first[1].external);

        // The next day's sync: only the fund's value moved. The value is
        // new, but the accounts' last change stays, so the nightly valuation
        // still records the session.
        const changedAt = await lastChange();
        await syncPlaidItem('u-fund', 'item-fund', deps(plaidWith(12).fetchImpl, new Date('2026-10-26T22:30:00.000Z')));
        assert.deepEqual((await fund()).map((r) => r.value), [120, 120]);
        assert.equal(await lastChange(), changedAt);

        // The user values the first account's fund by hand. The IRA's, the
        // same security, still syncs, and the edited one isn't added back.
        const [{ id, portfolio }] = await sql<{ id: string; portfolio: string }[]>`
            SELECT m.id, m.portfolio_id AS portfolio FROM manual_holdings m JOIN portfolios p ON p.id = m.portfolio_id
            WHERE p.external_account_id = 'acc_fx'`;
        assert.ok(await updateManualHolding('u-fund', id, portfolio, { name: 'Stable Value Fund', identifier: null, quantity: 10, value: 150, costBasis: 100, valueAsOf: '2026-10-27' }, { database }));
        await syncPlaidItem('u-fund', 'item-fund', deps(plaidWith(13).fetchImpl, new Date('2026-10-27T22:30:00.000Z')));
        assert.deepEqual((await fund()).map((r) => [r.account, r.source, r.value]), [['acc_fx', 'manual', 150], ['acc_fy', 'plaid', 130]]);

        // Each value is kept as of its day, so a missed night's valuation
        // reads that night's value (Codex on PR #216). Plaid gave no day for
        // these: the first sync's, on a Sunday, is Friday's session's.
        const history = await sql<{ account: string; date: string; value: number }[]>`
            SELECT p.external_account_id AS account, v.date::text AS date, v.value::float AS value
            FROM manual_holding_values v JOIN manual_holdings m ON m.id = v.manual_holding_id JOIN portfolios p ON p.id = m.portfolio_id
            WHERE m.user_id = 'u-fund' ORDER BY 1, 2`;
        assert.deepEqual(history.map((r) => [r.account, r.date, r.value]), [
            ['acc_fx', '2026-10-23', 110], ['acc_fx', '2026-10-26', 120], ['acc_fx', '2026-10-27', 150],
            ['acc_fy', '2026-10-23', 110], ['acc_fy', '2026-10-26', 120], ['acc_fy', '2026-10-27', 130],
        ]);
        // The nightly valuation reads them back: from a day on, with the one standing on it.
        const values = await readManualHistory([id], '2026-10-26', database);
        assert.deepEqual(values.get(id)?.map((r) => [r.date, r.value, r.quantity]), [['2026-10-23', 110, 10], ['2026-10-26', 120, 10], ['2026-10-27', 150, 10]]);
        const later = await readManualHistory([id], '2026-10-27', database);
        assert.deepEqual(later.get(id)?.map((r) => r.date), ['2026-10-26', '2026-10-27']);
        // ... in the same transaction as the portfolios' state (Codex on PR #217).
        const states = await createSnapshotStore(database, { now: () => new Date('2026-10-28T12:00:00Z') }).portfolios();
        const held = states.flatMap((state) => state.manual ?? []).find((m) => m.id === id);
        assert.deepEqual(held?.history?.map((r) => [r.date, r.value]), [['2026-10-23', 110], ['2026-10-26', 120], ['2026-10-27', 150]]);

        // The user's value stands from its day on: one dated earlier drops the later ones.
        assert.ok(await updateManualHolding('u-fund', id, portfolio, { name: 'Stable Value Fund', identifier: null, quantity: 10, value: 140, costBasis: 100, valueAsOf: '2026-10-26' }, { database }));
        const edited = await sql<{ date: string; value: number }[]>`SELECT date::text AS date, value::float AS value FROM manual_holding_values WHERE manual_holding_id = ${id} ORDER BY date`;
        assert.deepEqual(edited.map((r) => [r.date, r.value]), [['2026-10-23', 110], ['2026-10-26', 140]]);
    });

    /** A user with one linked account picked to sync, and a sync of it as of `at` that reports a share and, unless `fundPrice` is null, a fund with no ticker. */
    async function fundAccount(user: string) {
        await linkedUser(user, `item-${user}`, [[`acc-${user}`, 'Brokerage', 'investment']]);
        await selectPlaidAccounts(user, `item-${user}`, [`acc-${user}`], database);
        const FUND = { security_id: 'sec_fund', ticker_symbol: null, name: 'Stable Value Fund', type: 'mutual fund', cusip: '123456789' };
        const sync = (fundPrice: number | null, at: Date, reported: Record<string, unknown> = {}) => syncPlaidItem(user, `item-${user}`, deps(fakePlaid({
            '/investments/holdings/get': () => ({
                json: {
                    holdings: [
                        { account_id: `acc-${user}`, security_id: 'sec_aapl', quantity: 1, institution_price: 100, institution_value: 100, cost_basis: 90, iso_currency_code: 'USD' },
                        ...(fundPrice == null ? [] : [{
                            account_id: `acc-${user}`, security_id: 'sec_fund', quantity: 10, institution_price: fundPrice, institution_value: 10 * fundPrice,
                            cost_basis: 100, iso_currency_code: 'USD', ...reported,
                        }]),
                    ],
                    securities: [...SECURITIES, FUND],
                },
            }),
            '/investments/transactions/get': transactionsOf(`acc-${user}`, []),
        }).fetchImpl, at));
        const held = () => sql<{ name: string; source: string; value: number; asOf: string; external: string | null; account: string | null }[]>`
            SELECT m.name, m.source, m.value::float AS value, m.value_as_of::text AS "asOf", m.external_id AS external, p.external_account_id AS account
            FROM manual_holdings m JOIN portfolios p ON p.id = m.portfolio_id WHERE m.user_id = ${user} ORDER BY m.name`;
        const history = async (name: string) => (await sql<{ date: string; value: number }[]>`
            SELECT v.date::text AS date, v.value::float AS value FROM manual_holding_values v JOIN manual_holdings m ON m.id = v.manual_holding_id
            WHERE m.user_id = ${user} AND m.name = ${name} ORDER BY v.date`).map((r) => [r.date, r.value]);
        return { sync, held, history };
    }

    test('regression: a fund\'s value Plaid doesn\'t date is the last session\'s, so an evening sync doesn\'t date it the next day', async () => {
        const { sync, held, history } = await fundAccount('u-fund-evening');
        // "Sync now" at 8:30 pm in New York on Monday, Nov 23: already the
        // 24th in UTC, a day the nightly valuation hadn't reached.
        await sync(11, new Date('2026-11-24T01:30:00.000Z'));
        assert.deepEqual((await held()).map((r) => [r.name, r.value, r.asOf]), [['Stable Value Fund', 110, '2026-11-23']]);
        assert.deepEqual(await history('Stable Value Fund'), [['2026-11-23', 110]]);
        // The next morning, before Tuesday's session ends, a new value is still Monday's.
        await sync(12, new Date('2026-11-24T15:00:00.000Z'));
        assert.deepEqual((await held()).map((r) => [r.value, r.asOf]), [[120, '2026-11-23']]);
        assert.deepEqual(await history('Stable Value Fund'), [['2026-11-23', 120]]);
    });

    test('a fund\'s value Plaid dates is kept as of the institution\'s day', async () => {
        const { sync, held, history } = await fundAccount('u-fund-dated');
        // Synced on a Sunday; the plan priced the fund on Thursday.
        await sync(11, NOW, { institution_price_as_of: '2026-10-22' });
        assert.deepEqual((await held()).map((r) => [r.name, r.value, r.asOf]), [['Stable Value Fund', 110, '2026-10-22']]);
        assert.deepEqual(await history('Stable Value Fund'), [['2026-10-22', 110]]);
        // A day Atlas can't read is no day: the last session's stands in.
        await sync(12, new Date('2026-10-26T22:30:00.000Z'), { institution_price_as_of: 'not a date' });
        assert.deepEqual(await history('Stable Value Fund'), [['2026-10-22', 110], ['2026-10-26', 120]]);
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
            transactionsAdded: 3, transactionsUpdated: 0, transactionsSkipped: {}, transactionsPending: false,
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
            // Shares moved in from another broker: a record, with no cash and no price.
            { external_id: 'plaid:txn_xfer', type: 'TRANSFER_IN', symbol: 'VTI', quantity: 3, price: null, amount: 0, fees: null, source: 'plaid' },
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
        assert.deepEqual((await activity()).map((r) => [r.external_id, r.price]), [['plaid:txn_buy', 80.5], ['plaid:txn_div', null], ['plaid:txn_sell', 110], ['plaid:txn_xfer', null]]);
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

    // Launch item i63: a linked account's option contracts, synced into its option positions.

    const ACME_CALL = 'O:ACME270115C00150000';
    const AAPL_LOT: [string, number, number, number] = ['sec_aapl', 1, 100, 90];
    /** Three contracts as Plaid usually reports them: 300 shares' worth at $4.20 a share, $1,050 paid. */
    const ACME_LOT: [string, number, number, number] = ['sec_acme_c150', 300, 4.2, 1050];
    const acmeCall = (fields: Partial<Record<keyof OptionPositionInput, unknown>> = {}): OptionPositionInput => optionPositionSchema.parse({
        underlying: 'ACME', contractType: 'call', strike: 150, expiry: '2027-01-15', quantity: 3, premium: 3.5, ...fields,
    });
    const optionRows = (user: string) => sql<{
        id: string; contract: string; underlying: string; type: string; strike: number; expiry: string; quantity: number; premium: number;
        multiplier: number; price: number | null; priceDate: string | null; source: string; thesis: string | null; exitRule: string;
        userMark: number | null; userMarkDate: string | null;
    }[]>`
        SELECT id, contract, underlying, contract_type AS type, strike::float AS strike, expiry::text AS expiry, quantity::float AS quantity,
            premium::float AS premium, multiplier, institution_price::float AS price, institution_price_date::text AS "priceDate", source,
            thesis_id AS thesis, exit_rule AS "exitRule", user_mark::float AS "userMark", user_mark_date::text AS "userMarkDate"
        FROM option_positions WHERE user_id = ${user} ORDER BY contract`;
    /** A user with one linked account picked to sync, and a sync of it as of `at`. */
    async function linkedAccount(user: string) {
        await linkedUser(user, `item-${user}`, [[`acc-${user}`, 'Individual', 'investment']]);
        await selectPlaidAccounts(user, `item-${user}`, [`acc-${user}`], database);
        const sync = (rows: [string, number, number, number | null][], at: Date, { securities = SECURITIES as readonly object[], activity = [] as Record<string, unknown>[] } = {}) =>
            syncPlaidItem(user, `item-${user}`, deps(fakePlaid({
                '/investments/holdings/get': holdingsOf(`acc-${user}`, rows, 0, securities),
                '/investments/transactions/get': transactionsOf(`acc-${user}`, activity),
            }).fetchImpl, at));
        return { sync, portfolio: async () => (await sql<{ id: string }[]>`SELECT id FROM portfolios WHERE user_id = ${user} AND source = 'plaid'`)[0].id };
    }

    test('a linked account\'s option contracts become its option positions, and every sync keeps the user\'s plan for them', async () => {
        const { sync, portfolio } = await linkedAccount('u-opt');
        const BUY_CALL = { investment_transaction_id: 'txn_call', security_id: 'sec_acme_c150', date: '2026-10-20', name: 'BUY ACME CALL', quantity: 3, price: 3.5, amount: 1050.65, type: 'buy', subtype: 'buy' };
        const first = await sync([AAPL_LOT, ACME_LOT], NOW, { activity: [BUY_CALL] });
        assert.deepEqual(first.accounts.map((a) => [a.positions, a.options, a.holdingsSkipped, a.transactionsAdded, a.transactionsSkipped]), [[1, 1, 0, 0, { option: 1 }]]);
        const [synced] = await optionRows('u-opt');
        assert.deepEqual({ ...synced, id: undefined }, {
            id: undefined, contract: ACME_CALL, underlying: 'ACME', type: 'call', strike: 150, expiry: '2027-01-15', quantity: 3, premium: 3.5, multiplier: 100,
            // Plaid gave no day for its price: the last session that ended by
            // the sync, Friday's on this Sunday.
            price: 4.2, priceDate: '2026-10-23', source: 'plaid', thesis: null, exitRule: '', userMark: null, userMarkDate: null,
        });
        // The option trade isn't recorded: the position comes from the holdings.
        assert.equal((await sql`SELECT 1 FROM transactions t JOIN portfolios p ON p.id = t.portfolio_id WHERE p.user_id = 'u-opt'`).length, 0);
        // The nightly price job asks Massive for its close.
        assert.ok((await listOptionContractsToMark(10, '2026-10-26', database)).includes(ACME_CALL));
        const account = await portfolio();
        const lastChange = async () => (await sql<{ at: string }[]>`SELECT updated_at::text AS at FROM portfolios WHERE id = ${account}`)[0].at;
        const changedAt = await lastChange();

        // While the account syncs, the contract, contracts, premium and
        // account are the institution's; the plan is the user's. An edit
        // waits for the account lock, as a sync's write takes it.
        const { waited, result } = await waitsForAccountLock('u-opt', () => updateOptionPosition('u-opt', synced.id, account,
            acmeCall({ quantity: 9, premium: 1, exitRule: 'Roll at 90 days.', userMark: 5, userMarkDate: '2026-10-26' }), { database }));
        assert.deepEqual([waited, result], [true, true]);
        assert.deepEqual((await optionRows('u-opt')).map((r) => [r.quantity, r.premium, r.exitRule, r.userMark, r.userMarkDate, r.source]), [
            [3, 3.5, 'Roll at 90 days.', 5, '2026-10-26', 'plaid'],
        ]);
        await assert.rejects(deleteOptionPosition('u-opt', synced.id, database), (e: unknown) => e instanceof SyncedOptionPositionError && e.action === 'delete');
        const [{ id: roth }] = await sql<{ id: string }[]>`INSERT INTO portfolios (user_id, name) VALUES ('u-opt', 'Roth IRA') RETURNING id`;
        await assert.rejects(updateOptionPosition('u-opt', synced.id, roth, acmeCall(), { database }), (e: unknown) => e instanceof SyncedOptionPositionError && e.action === 'move');
        await assert.rejects(addOptionPosition('u-opt', account, acmeCall(), database), DuplicateOptionPositionError);
        // Nor does a positions CSV change it: it's left as the sync has it.
        const imported = await importHoldings('u-opt', {
            portfolioId: account, rows: [], options: [{ underlying: 'ACME', contractType: 'call', strike: 150, expiry: '2027-01-15', quantity: 7, premium: 4 }],
        }, {}, database);
        assert.deepEqual(imported.options, { insert: 0, update: 0, unchanged: 1 });
        assert.equal((await optionRows('u-opt'))[0].quantity, 3);

        // The next day: 500 at $5.00, $1,800 paid. Five contracts at $3.60,
        // at that day's price; the rule and the user's price stay.
        const second = await sync([AAPL_LOT, ['sec_acme_c150', 500, 5, 1800]], new Date('2026-10-26T22:30:00.000Z'));
        assert.equal(second.accounts[0].options, 1);
        assert.deepEqual((await optionRows('u-opt')).map((r) => [r.id, r.quantity, r.premium, r.price, r.priceDate, r.exitRule, r.userMark, r.userMarkDate]), [
            [synced.id, 5, 3.6, 5, '2026-10-26', 'Roll at 90 days.', 5, '2026-10-26'],
        ]);
        // Options aren't in the account's value yet: the snapshot job's last change stays.
        assert.equal(await lastChange(), changedAt);

        // Reported without details Atlas can read: left as it was, and counted.
        const unclear = SECURITIES.map((security) => (security.security_id === 'sec_acme_c150' ? { ...security, option_contract: null } : security));
        const third = await sync([AAPL_LOT, ['sec_acme_c150', 600, 6, 2000]], new Date('2026-10-27T22:30:00.000Z'), { securities: unclear });
        assert.deepEqual([third.accounts[0].options, third.accounts[0].holdingsSkippedBy], [0, { option: 1 }]);
        assert.deepEqual((await optionRows('u-opt')).map((r) => [r.quantity, r.premium, r.price]), [[5, 3.6, 5]]);

        // No longer held: the position goes with it.
        await sync([AAPL_LOT], new Date('2026-10-28T22:30:00.000Z'));
        assert.equal((await optionRows('u-opt')).length, 0);
        assert.equal(await lastChange(), changedAt);
    });

    test('a contract added by hand becomes the synced one when the institution reports it, keeping its plan; one it doesn\'t report stays', async () => {
        const { sync, portfolio } = await linkedAccount('u-adopt');
        await sync([AAPL_LOT], NOW);
        const account = await portfolio();
        await addOptionPosition('u-adopt', account, acmeCall({ quantity: 2, premium: 3, thesisId: 't-1', exitRule: 'Exit at half' }), database);
        await addOptionPosition('u-adopt', account, acmeCall({ contractType: 'put', quantity: -1, premium: 2 }), database);

        await sync([AAPL_LOT, ACME_LOT], new Date('2026-10-26T22:30:00.000Z'));
        assert.deepEqual((await optionRows('u-adopt')).map((r) => [r.contract, r.source, r.quantity, r.premium, r.thesis, r.exitRule]), [
            [ACME_CALL, 'plaid', 3, 3.5, 't-1', 'Exit at half'],
            ['O:ACME270115P00150000', 'manual', -1, 2, null, ''],
        ]);
        // The call is sold: only the synced one goes.
        await sync([AAPL_LOT], new Date('2026-10-27T22:30:00.000Z'));
        assert.deepEqual((await optionRows('u-adopt')).map((r) => [r.contract, r.source]), [['O:ACME270115P00150000', 'manual']]);
    });

    test('once the account no longer syncs, the contracts it brought in are the user\'s to change or delete', async () => {
        const { sync, portfolio } = await linkedAccount('u-unlinked');
        await sync([AAPL_LOT, ACME_LOT], NOW);
        const [synced] = await optionRows('u-unlinked');
        // Disconnected, or the pick undone: the account is excluded.
        await sql`UPDATE plaid_accounts SET sync_status = 'excluded' WHERE user_id = 'u-unlinked'`;
        assert.equal(await updateOptionPosition('u-unlinked', synced.id, await portfolio(), acmeCall({ quantity: 4 }), { database }), true);
        // The same contract: its last price from the institution still marks it.
        assert.deepEqual((await optionRows('u-unlinked')).map((r) => [r.quantity, r.source, r.price, r.priceDate]), [[4, 'manual', 4.2, '2026-10-23']]);
        assert.equal(await deleteOptionPosition('u-unlinked', synced.id, database), true);
        assert.equal((await optionRows('u-unlinked')).length, 0);
    });

    test('regression: a price Plaid doesn\'t date is the last session\'s, so an evening sync doesn\'t outrank the user\'s price from that day', async () => {
        const { sync, portfolio } = await linkedAccount('u-evening');
        const marks = async () => (await loadOptionPositions('u-evening', { database })).map((p) => p.mark);
        // "Sync now" at 8:30 pm in New York on Monday, Nov 23: already the
        // 24th in UTC, which dated the price a day the user hadn't reached.
        await sync([AAPL_LOT, ACME_LOT], new Date('2026-11-24T01:30:00.000Z'));
        const [synced] = await optionRows('u-evening');
        assert.deepEqual([synced.price, synced.priceDate], [4.2, '2026-11-23']);
        // The price the user types that evening is dated that day, and wins the tie.
        assert.ok(await updateOptionPosition('u-evening', synced.id, await portfolio(), acmeCall({ userMark: 5, userMarkDate: '2026-11-23' }), { database }));
        assert.deepEqual(await marks(), [{ source: 'user', price: 5, date: '2026-11-23' }]);
        // The next morning, before Tuesday's session ends, the price is still Monday's.
        await sync([AAPL_LOT, ACME_LOT], new Date('2026-11-24T15:00:00.000Z'));
        assert.deepEqual(await marks(), [{ source: 'user', price: 5, date: '2026-11-23' }]);
        // After Tuesday's close, the institution's price is the newer one.
        await sync([AAPL_LOT, ['sec_acme_c150', 300, 4.5, 1050]], new Date('2026-11-24T22:30:00.000Z'));
        assert.deepEqual(await marks(), [{ source: 'institution', price: 4.5, date: '2026-11-24' }]);
    });

    test('a sync written without options leaves the account\'s option positions alone; a report of none removes the synced ones', async () => {
        const { sync, portfolio } = await linkedAccount('u-nooptions');
        await sync([AAPL_LOT, ACME_LOT], NOW);
        await addOptionPosition('u-nooptions', await portfolio(), acmeCall({ contractType: 'put', quantity: 1, premium: 2 }), database);
        const [{ recordId }] = await sql<{ recordId: string }[]>`SELECT id AS "recordId" FROM plaid_accounts WHERE user_id = 'u-nooptions'`;
        const write = (holdings: Parameters<typeof writeAccountSync>[0]['holdings'], now: Date) => writeAccountSync({
            userId: 'u-nooptions', plaidAccountRecordId: recordId, plaidAccountId: 'acc-u-nooptions', name: 'Individual', mask: '1234',
            description: '', holdings, transactions: null, now,
        }, database);
        const positions = [{ symbol: 'AAPL', name: 'Apple Inc.', quantity: 1, avgCost: 90, price: 100 }];
        const contracts = async () => (await optionRows('u-nooptions')).map((r) => [r.contract, r.source]);

        // Holdings with no word on options aren't a report of none.
        const without = await write({ positions, cashUsd: 0 }, new Date('2026-10-26T22:30:00.000Z'));
        assert.equal(without?.options, 0);
        assert.deepEqual(await contracts(), [[ACME_CALL, 'plaid'], ['O:ACME270115P00150000', 'manual']]);
        // No contracts reported, and none kept: the synced one goes, the user's stays.
        const none = await write({ positions, cashUsd: 0, options: [] }, new Date('2026-10-27T22:30:00.000Z'));
        assert.equal(none?.options, 0);
        assert.deepEqual(await contracts(), [['O:ACME270115P00150000', 'manual']]);
    });

    test('a warrant is counted as an option without clear details; a fund with no ticker is valued by the institution', async () => {
        const { sync } = await linkedAccount('u-warrant');
        const fund = { security_id: 'sec_fund_w', ticker_symbol: null, name: 'Target 2055 Trust', type: 'mutual fund', cusip: '987654321' };
        const result = await sync([AAPL_LOT, ['sec_acme_w', 10, 1.5, 12], ['sec_fund_w', 10, 11, 100]], NOW, { securities: [...SECURITIES, fund] });
        assert.deepEqual(result.accounts.map((a) => [a.positions, a.options, a.valued, a.holdingsSkipped, a.holdingsSkippedBy]), [[1, 0, 1, 1, { option: 1 }]]);
        assert.equal((await optionRows('u-warrant')).length, 0);

        // Valued by hand, the fund is the user's: the next sync neither writes
        // it nor counts it as valued by the institution.
        const [{ id, portfolio }] = await sql<{ id: string; portfolio: string }[]>`
            SELECT id, portfolio_id AS portfolio FROM manual_holdings WHERE user_id = 'u-warrant'`;
        assert.ok(await updateManualHolding('u-warrant', id, portfolio, { name: 'Target 2055 Trust', identifier: null, quantity: 10, value: 125, costBasis: 100, valueAsOf: '2026-10-26' }, { database }));
        const later = await sync([AAPL_LOT, ['sec_fund_w', 10, 12, 100]], new Date('2026-10-26T22:30:00.000Z'), { securities: [...SECURITIES, fund] });
        assert.deepEqual(later.accounts.map((a) => [a.positions, a.valued]), [[1, 0]]);
        assert.deepEqual((await sql<{ source: string; value: number }[]>`
            SELECT source, value::float AS value FROM manual_holdings WHERE user_id = 'u-warrant'`).map((r) => [r.source, r.value]), [['manual', 125]]);
    });

    test('the nightly job counts the option positions it brought in', async () => {
        await linkedAccount('u-optnight');
        const plaid = fakePlaid({
            '/investments/holdings/get': (body) => {
                const account = (body.options as { account_ids: string[] }).account_ids[0];
                return holdingsOf(account, account === 'acc-u-optnight' ? [ACME_LOT] : [AAPL_LOT])(body);
            },
            '/investments/transactions/get': (body) => transactionsOf(((body.options as { account_ids: string[] }).account_ids)[0], [])(body),
        });
        const counts = await syncAllPlaidItems({ config: CONFIG, budgetMs: 60_000, database, fetchImpl: plaid.fetchImpl, getAccessToken: async () => 'access-sandbox-1', clock: () => NOW.getTime() });
        assert.equal(counts.options, 1);
        assert.deepEqual((await optionRows('u-optnight')).map((r) => [r.contract, r.quantity]), [[ACME_CALL, 3]]);
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

    test('the table refuses an account filed under another user\'s connection, whatever the code checks (i69)', async () => {
        await linkedUser('u-fk-owner', 'item-fk-owner', []);
        await sql`INSERT INTO auth_users (id, email) VALUES ('u-fk-intruder', 'u-fk-intruder@example.test')`;
        const [item] = await sql<{ id: string }[]>`SELECT id FROM plaid_items WHERE plaid_item_id = 'item-fk-owner'`;
        await assert.rejects(sql`
            INSERT INTO plaid_accounts (user_id, plaid_item_record_id, plaid_account_id, name, mask, type, subtype, capabilities, verification_status)
            VALUES ('u-fk-intruder', ${item.id}, 'acc-fk', 'Brokerage', '1234', 'investment', 'brokerage', '["holdings"]', 'automatically_verified')`,
        /plaid_accounts_item_owner_fk/);
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

    test('regression: a connection whose token can\'t be read isn\'t disconnected here, so its access at Plaid can still be ended', async () => {
        // The Codex finding on PR #163: the token was wiped though Plaid was never told.
        await linkedUser('u-notoken', 'item-notoken', [['acc_notoken', 'Individual', 'investment']]);
        const plaid = fakePlaid({});
        await assert.rejects(
            disconnectPlaidItem('u-notoken', 'item-notoken', { config: CONFIG, database, fetchImpl: plaid.fetchImpl, getAccessToken: async () => undefined }),
            PlaidTokenUnavailableError,
        );
        assert.equal(plaid.requests.length, 0);
        assert.deepEqual((await itemRow('item-notoken')).map((r) => ({ ...r })), [{ status: 'active', revoked: false, token: 'c' }]);
    });

    test('regression: the same account linked again through another connection isn\'t synced twice', async () => {
        // The Codex finding on PR #163: relinking a brokerage gives its accounts
        // new IDs; picked again, they synced into a second portfolio.
        await linkedUser('u-dup', 'item-dup-1', [['acc_dup_1', 'Individual', 'investment']]);
        await selectPlaidAccounts('u-dup', 'item-dup-1', ['acc_dup_1'], database);
        const [first] = await sql<{ id: string }[]>`SELECT id FROM plaid_items WHERE plaid_item_id = 'item-dup-1'`;
        const [second] = await sql<{ id: string }[]>`
            INSERT INTO plaid_items (user_id, plaid_item_id, institution_id, institution_name, access_token_ciphertext, access_token_iv, access_token_auth_tag)
            VALUES ('u-dup', 'item-dup-2', 'ins_1', 'Fidelity', 'c', 'i', 't') RETURNING id`;
        assert.ok(first && second);
        await sql`
            INSERT INTO plaid_accounts (user_id, plaid_item_record_id, plaid_account_id, name, mask, type, subtype, capabilities, verification_status, institution_id)
            VALUES ('u-dup', ${second.id}, 'acc_dup_2', 'INDIVIDUAL ', '1234', 'investment', 'brokerage', '["holdings"]', 'automatically_verified', null),
                   ('u-dup', ${second.id}, 'acc_new_2', 'Joint', '4321', 'investment', 'brokerage', '["holdings"]', 'automatically_verified', null)`;
        // Matched by institution, name, last four and subtype, not by ID. (The
        // first connection's rows have no institution_id: named by institution.)
        await sql`UPDATE plaid_accounts SET institution_name = 'Fidelity' WHERE user_id = 'u-dup'`;
        const elsewhere = await connectedAccountFingerprints('u-dup', { exceptItemId: 'item-dup-2', statuses: ['sync_ready'] }, database);
        assert.equal(elsewhere.size, 1);
        assert.equal(await selectPlaidAccounts('u-dup', 'item-dup-2', ['acc_dup_2', 'acc_new_2'], database), 1);
        assert.deepEqual((await statuses('u-dup')).map((r) => [r.id, r.status]), [['acc_dup_1', 'sync_ready'], ['acc_dup_2', 'excluded'], ['acc_new_2', 'sync_ready']]);
    });

    test('regression: after Link\'s update mode, the connection is read from Plaid again: login, consent, and the accounts it may read', async () => {
        // The Codex findings on PR #163: a connection with nothing picked stayed
        // "sign in again"; "access ends soon" stayed after consent was renewed;
        // an account the user stopped sharing failed every later sync.
        await linkedUser('u-fixed', 'item-fixed', [['acc_fixed', 'Individual', 'investment'], ['acc_dropped', 'Joint', 'investment'], ['acc_waiting', 'IRA', 'investment']]);
        await selectPlaidAccounts('u-fixed', 'item-fixed', ['acc_fixed', 'acc_dropped'], database);
        await sql`UPDATE plaid_accounts SET sync_status = 'awaiting_selection' WHERE plaid_account_id = 'acc_waiting'`;
        await sql`UPDATE plaid_items SET status = 'login_required' WHERE plaid_item_id = 'item-fixed'`;
        const refresh = (item: Record<string, unknown>, accountIds = ['acc_fixed', 'acc_waiting']) => {
            const plaid = fakePlaid({
                '/item/get': () => ({ json: { item: { item_id: 'item-fixed', ...item } } }),
                '/accounts/get': () => ({ json: { accounts: accountIds.map((account_id) => ({ account_id })) } }),
            });
            return refreshPlaidItem('u-fixed', 'item-fixed', deps(plaid.fetchImpl));
        };

        // Still wanting a sign-in: it stays so, nothing else changes.
        assert.deepEqual(await refresh({ error: { error_code: 'ITEM_LOGIN_REQUIRED' } }), { status: 'login_required', accountsRemoved: 0, accountsAdded: 0 });
        assert.equal((await itemRow('item-fixed'))[0].status, 'login_required');

        // Signed in again, one account no longer shared: it stops syncing.
        assert.deepEqual(await refresh({ error: null, consent_expiration_time: null }), { status: 'active', accountsRemoved: 1, accountsAdded: 0 });
        assert.equal((await itemRow('item-fixed'))[0].status, 'active');
        assert.deepEqual((await statuses('u-fixed')).map((r) => [r.id, r.status]), [['acc_dropped', 'excluded'], ['acc_fixed', 'sync_ready'], ['acc_waiting', 'awaiting_selection']]);

        // Consent: renewed for months is fine; days left is still ending soon.
        await sql`UPDATE plaid_items SET status = 'pending_expiration' WHERE plaid_item_id = 'item-fixed'`;
        assert.equal((await refresh({ error: null, consent_expiration_time: '2027-10-25T00:00:00Z' })).status, 'active');
        assert.equal((await itemRow('item-fixed'))[0].status, 'active');
        assert.equal((await refresh({ error: null, consent_expiration_time: '2026-10-28T00:00:00Z' })).status, 'pending_expiration');
        assert.equal((await itemRow('item-fixed'))[0].status, 'pending_expiration');

        await assert.rejects(refreshPlaidItem('u-someone-else', 'item-fixed', deps(fakePlaid({}).fetchImpl)), PlaidItemNotFoundError);
    });

    test('regression: an account whose access is restored on reconnect comes back under its new ID, into the same account in Atlas', async () => {
        // The Codex finding on PR #163: Plaid gives restored access a new
        // account_id; the old one stopped syncing and the new one was never stored.
        await linkedUser('u-restore', 'item-restore', [['acc_old_id', 'Individual', 'investment']]);
        await selectPlaidAccounts('u-restore', 'item-restore', ['acc_old_id'], database);
        await syncPlaidItem('u-restore', 'item-restore', deps(fakePlaid({
            '/investments/holdings/get': holdingsOf('acc_old_id', [['sec_aapl', 1, 100, 90]]),
            '/investments/transactions/get': transactionsOf('acc_old_id', []),
        }).fetchImpl));
        // As the exchange stores it: the connection's institution.
        await sql`UPDATE plaid_accounts SET institution_id = 'ins_1', institution_name = 'Fidelity' WHERE user_id = 'u-restore'`;
        const [portfolio] = await sql<{ id: string }[]>`SELECT id FROM portfolios WHERE user_id = 'u-restore'`;

        const plaidAccount = (account_id: string, name: string, mask: string) => ({
            account_id, name, mask, type: 'investment', subtype: 'brokerage', balances: { current: 100, iso_currency_code: 'USD' },
        });
        const reconnect = fakePlaid({
            '/item/get': () => ({ json: { item: { item_id: 'item-restore', error: null, consent_expiration_time: null } } }),
            '/accounts/get': () => ({ json: { accounts: [plaidAccount('acc_new_id', 'Individual', '1234'), plaidAccount('acc_added', 'Joint', '9999')] } }),
        });
        assert.deepEqual(await refreshPlaidItem('u-restore', 'item-restore', deps(reconnect.fetchImpl)), { status: 'active', accountsRemoved: 1, accountsAdded: 2 });
        // The restored account keeps its pick and history; a new one waits to be picked.
        const rows = await sql<{ id: string; status: string; synced: boolean }[]>`
            SELECT plaid_account_id AS id, sync_status AS status, holdings_synced_at IS NOT NULL AS synced FROM plaid_accounts WHERE user_id = 'u-restore' ORDER BY plaid_account_id`;
        assert.deepEqual(rows.map((r) => [r.id, r.status, r.synced]), [['acc_added', 'awaiting_selection', false], ['acc_new_id', 'sync_ready', true], ['acc_old_id', 'excluded', true]]);
        const [moved] = await sql<{ external: string }[]>`SELECT external_account_id AS external FROM portfolios WHERE id = ${portfolio.id}`;
        assert.equal(moved.external, 'acc_new_id');

        // The next sync writes into the same account in Atlas, not a new one.
        const synced = await syncPlaidItem('u-restore', 'item-restore', deps(fakePlaid({
            '/investments/holdings/get': holdingsOf('acc_new_id', [['sec_aapl', 2, 100, 180]]),
            '/investments/transactions/get': transactionsOf('acc_new_id', []),
        }).fetchImpl, new Date('2026-10-26T22:30:00.000Z')));
        assert.deepEqual(synced.accounts.map((a) => [a.portfolioId, a.created]), [[portfolio.id, false]]);
        assert.equal((await sql`SELECT 1 FROM portfolios WHERE user_id = 'u-restore'`).length, 1);
    });

    /**
     * Runs `run` while another connection holds the user's account lock, and
     * says whether it waited for it. The lock is let go even when `run` or an
     * assertion fails, so a failing test can't hang the run.
     */
    async function waitsForAccountLock<T>(userId: string, run: () => Promise<T>): Promise<{ waited: boolean; result: T }> {
        const scratch = new URL(DATABASE_URL!);
        scratch.pathname = `/${name}`;
        const other = postgres(scratch.toString(), { max: 1, onnotice: () => {} });
        let release = () => {};
        const released = new Promise<void>((resolve) => { release = resolve; });
        let holder: Promise<unknown> = Promise.resolve();
        try {
            let locked!: () => void;
            const holding = new Promise<void>((resolve) => { locked = resolve; });
            holder = other.begin(async (transaction) => {
                // postgres.js types a transaction without its tagged-template call.
                const tx = transaction as unknown as typeof other;
                await tx`SELECT pg_advisory_xact_lock(hashtext(${`atlas:accounts:${userId}`}))`;
                locked();
                await released;
            });
            await holding;
            let finished = false;
            const running = run().then((result) => { finished = true; return result; });
            await new Promise((resolve) => setTimeout(resolve, 300));
            const waited = !finished;
            release();
            await holder;
            return { waited, result: await running };
        } finally {
            release();
            await holder.catch(() => {});
            await other.end();
        }
    }

    test('regression: reconnect reconciliation waits for the user\'s account lock, as a sync\'s write and deleting an account do', async () => {
        // The Codex finding on PR #163: without it, a sync in flight could
        // write an account under the ID being moved, making a second one.
        await linkedUser('u-lock', 'item-lock', [['acc_lock', 'Individual', 'investment']]);
        const { waited, result } = await waitsForAccountLock('u-lock', () => refreshPlaidItem('u-lock', 'item-lock', deps(fakePlaid({
            '/item/get': () => ({ json: { item: { item_id: 'item-lock', error: null, consent_expiration_time: null } } }),
            '/accounts/get': () => ({ json: { accounts: [{ account_id: 'acc_lock' }] } }),
        }).fetchImpl)));
        assert.equal(waited, true);
        assert.equal(result.status, 'active');
    });

    test('regression: a pick waits for the user\'s account lock, so two picks of the same account through two connections can\'t both go through', async () => {
        // The Codex finding on PR #163: two tabs picking the same account
        // through different connections could each see it synced nowhere.
        await linkedUser('u-picklock', 'item-picklock', [['acc_picklock', 'Individual', 'investment']]);
        const { waited, result } = await waitsForAccountLock('u-picklock', () => selectPlaidAccounts('u-picklock', 'item-picklock', ['acc_picklock'], database));
        assert.equal(waited, true);
        assert.equal(result, 1);
    });

    test('regression (i77): two links finishing at once past the most connections save only one', async () => {
        // The Codex finding on PR #194: a count before saving let both through.
        const user = 'u-cap';
        await sql`INSERT INTO auth_users (id, email) VALUES (${user}, ${`${user}@example.test`})`;
        for (let i = 1; i < MAX_PLAID_CONNECTIONS_PER_USER; i += 1) {
            await sql`
                INSERT INTO plaid_items (user_id, plaid_item_id, institution_id, institution_name, access_token_ciphertext, access_token_iv, access_token_auth_tag)
                VALUES (${user}, ${`item-cap-${i}`}, 'ins_1', 'Fidelity', 'c', 'i', 't')`;
        }
        // A disconnected one doesn't count.
        await sql`
            INSERT INTO plaid_items (user_id, plaid_item_id, institution_id, institution_name, access_token_ciphertext, access_token_iv, access_token_auth_tag, status, revoked_at)
            VALUES (${user}, 'item-cap-gone', 'ins_1', 'Fidelity', '', '', '', 'revoked', now())`;
        const active = async () => Number((await sql<{ n: string }[]>`
            SELECT count(*) AS n FROM plaid_items WHERE user_id = ${user} AND status <> 'revoked' AND revoked_at IS NULL`)[0].n);

        // Two connections, so the two saves really run at once.
        const pool = postgres(scratchUrl, { max: 2, onnotice: () => {} });
        const env = { storage: process.env.PLAID_TOKEN_STORAGE, key: process.env.PLAID_TOKEN_ENCRYPTION_KEY };
        process.env.PLAID_TOKEN_STORAGE = 'postgres';
        process.env.PLAID_TOKEN_ENCRYPTION_KEY = 'test-only-registry-key';
        setPlaidTokenRegistryStoreForTests({ ...createDrizzlePlaidTokenRegistryStore(drizzle(pool, { schema })), configured: () => true });
        try {
            const link = (item: string) => storePlaidConnection({
                userId: user,
                exchange: { itemId: item, accessToken: `access-${item}`, requestId: 'r', institution: { id: 'ins_2', name: 'Schwab' }, accounts: [] },
                maxConnections: MAX_PLAID_CONNECTIONS_PER_USER,
                now: NOW,
            });
            const results = await Promise.all([link('item-new-a'), link('item-new-b')]);
            assert.deepEqual(results.map((r) => r.stored).sort(), [false, true]);
            assert.deepEqual(results.map((r) => r.limitReached === true).sort(), [false, true]);
            assert.equal(await active(), MAX_PLAID_CONNECTIONS_PER_USER);

            // The one saved, linked again, is saved again: it isn't a new connection.
            const saved = results[0].stored ? 'item-new-a' : 'item-new-b';
            assert.equal((await link(saved)).stored, true);
            assert.equal(await active(), MAX_PLAID_CONNECTIONS_PER_USER);
        } finally {
            setPlaidTokenRegistryStoreForTests(null);
            resetPlaidTokenVaultForTests();
            for (const [key, value] of [['PLAID_TOKEN_STORAGE', env.storage], ['PLAID_TOKEN_ENCRYPTION_KEY', env.key]] as const) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
            await pool.end();
        }
    });
});
