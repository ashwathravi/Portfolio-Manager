import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import { parseHoldingsCsv } from '../../src/lib/portfolio/csvImport';
import { ImportAccessError, importHoldings, LinkedAccountImportError } from '../../src/lib/portfolio/importHoldings';
import { addManualHolding, loadManualHoldings, updateManualHolding } from '../../src/lib/portfolio/manual-holdings';
import { manualSymbol } from '../../src/lib/portfolio/manual-symbol';
import { createSnapshotStore } from '../../src/lib/portfolio/valuation-snapshots';
import { buildPolicyPortfolio } from '../../src/lib/risk-policy/portfolio';
import { riskPolicyInput } from '../../src/lib/risk-policy/user-policy';
import { SETTINGS_VERSION } from '../../src/lib/settings/document';
import { storedRiskPolicy } from '../../src/lib/settings/risk-policy';
import { defaultPersistedSettings } from '../../src/lib/stores/settingsStore';
import { manualHoldingSchema } from '../../src/lib/validators/manual-holding';
import { portfolioImportSchema } from '../../src/lib/validators/portfolio-import';

// A positions file's rows with no ticker, brought in valued by hand
// (manual_holdings, source 'csv'), against a scratch database with every
// migration applied. Needs a local Postgres it may create databases in;
// CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

/** A positions export: a share with a ticker, and holdings with none. */
const file = (...lines: string[]) => ['Symbol,Description,Quantity,Cost Basis,Market Value', ...lines].join('\n');
const APPLE = 'AAPL,Apple Inc.,10,1500.00,1900.00';
/** A 401(k) trust known only by its name. */
const trust = (value: string, units = '120.5', cost = '10000') => `--,Target 2055 Trust,${units},${cost},${value}`;
/** A fund known by its CUSIP (made up, with a valid check digit). */
const stable = (value: string) => `99ZZ12341,Stable Value Fund,100,9000,${value}`;

describe('positions files with holdings valued by hand', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `holdings_import_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: Parameters<typeof importHoldings>[3] & object;

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

    async function seedUser(user: string, account = 'Workplace 401k'): Promise<string> {
        await sql`INSERT INTO auth_users (id, name, email) VALUES (${user}, ${user}, ${`${user}@example.test`}) ON CONFLICT DO NOTHING`;
        const [p] = await sql<{ id: string }[]>`INSERT INTO portfolios (user_id, name) VALUES (${user}, ${account}) RETURNING id`;
        return p.id;
    }

    /** The file read as the dialog reads it, and sent through the import route's validator. */
    function importFile(user: string, portfolioId: string, csv: string, valuesAsOf: string) {
        const parsed = parseHoldingsCsv(csv);
        assert.deepEqual(parsed.issues, []);
        const body = portfolioImportSchema.parse({ portfolioId, rows: parsed.rows, options: parsed.options, manual: parsed.manual, valuesAsOf });
        return importHoldings(user, body, {}, database);
    }

    const handValued = async (user: string) => (await sql<{
        id: string; portfolio: string; name: string; identifier: string | null; quantity: number | null; value: number;
        cost: number | null; asOf: string; source: string; external: string | null;
    }[]>`
        SELECT id, portfolio_id AS portfolio, name, identifier, quantity::float AS quantity, value::float AS value, cost_basis::float AS cost,
            value_as_of::text AS "asOf", source, external_id AS external
        FROM manual_holdings WHERE user_id = ${user} ORDER BY name, value`).map((r) => ({ ...r }));
    const history = async (id: string) => (await sql<{ date: string; value: number; quantity: number | null }[]>`
        SELECT date::text AS date, value::float AS value, quantity::float AS quantity FROM manual_holding_values WHERE manual_holding_id = ${id} ORDER BY date`)
        .map((r) => [r.date, r.value, r.quantity]);
    const positions = async (portfolioId: string) => (await sql<{ symbol: string; quantity: number; avg: number }[]>`
        SELECT symbol, quantity::float AS quantity, avg_cost::float AS avg FROM holdings WHERE portfolio_id = ${portfolioId} ORDER BY symbol`)
        .map((r) => [r.symbol, r.quantity, r.avg]);
    const lastChange = async (portfolioId: string) => (await sql<{ at: string }[]>`SELECT updated_at::text AS at FROM portfolios WHERE id = ${portfolioId}`)[0].at;

    test('a fund with no ticker comes in valued by hand beside the file\'s positions, as of the file\'s day', async () => {
        const account = await seedUser('u-first');
        const result = await importFile('u-first', account, file(APPLE, trust('12345.67')), '2026-11-02');
        assert.deepEqual([result.insert, result.manual], [1, { insert: 1, update: 0, unchanged: 0, replacedPositions: 0 }]);
        assert.deepEqual(await positions(account), [['AAPL', 10, 150]]);
        const [fund] = await handValued('u-first');
        assert.deepEqual({ ...fund, id: undefined }, {
            id: undefined, portfolio: account, name: 'Target 2055 Trust', identifier: null, quantity: 120.5, value: 12345.67, cost: 10000,
            asOf: '2026-11-02', source: 'csv', external: 'csv:name:target 2055 trust',
        });
        assert.deepEqual(await history(fund.id), [['2026-11-02', 12345.67, 120.5]]);
    });

    test('importing the same file again updates the same holding and keeps each day\'s value', async () => {
        const account = await seedUser('u-again');
        await importFile('u-again', account, file(APPLE, trust('12345.67')), '2026-11-02');
        const [{ id }] = await handValued('u-again');
        const changedAt = await lastChange(account);

        const next = await importFile('u-again', account, file(APPLE, trust('12500.00')), '2026-11-03');
        assert.deepEqual([next.unchanged, next.manual], [1, { insert: 0, update: 1, unchanged: 0, replacedPositions: 0 }]);
        const [fund] = await handValued('u-again');
        assert.deepEqual([fund.id, fund.value, fund.asOf], [id, 12500, '2026-11-03']);
        assert.deepEqual(await history(id), [['2026-11-02', 12345.67, 120.5], ['2026-11-03', 12500, 120.5]]);
        // A new value alone is a price: the account's last change stays, so
        // that night's valuation still records the session.
        assert.equal(await lastChange(account), changedAt);

        // The same values on a later day: nothing changes but that day's value is kept.
        const same = await importFile('u-again', account, file(APPLE, trust('12500.00')), '2026-11-04');
        assert.deepEqual(same.manual, { insert: 0, update: 0, unchanged: 1, replacedPositions: 0 });
        assert.equal((await handValued('u-again')).length, 1);
        assert.deepEqual((await history(id)).map((r) => r[0]), ['2026-11-02', '2026-11-03', '2026-11-04']);

        // New units are a change to the account.
        await importFile('u-again', account, file(APPLE, trust('13000.00', '125')), '2026-11-05');
        assert.notEqual(await lastChange(account), changedAt);
    });

    test('an older file keeps the newer value and adds only its own day to the history', async () => {
        const account = await seedUser('u-older');
        await importFile('u-older', account, file(trust('12500.00')), '2026-11-03');
        const older = await importFile('u-older', account, file(trust('11000.00', '110', '9000')), '2026-10-30');
        assert.deepEqual(older.manual, { insert: 0, update: 0, unchanged: 1, replacedPositions: 0 });
        const [fund] = await handValued('u-older');
        assert.deepEqual([fund.value, fund.quantity, fund.cost, fund.asOf], [12500, 120.5, 10000, '2026-11-03']);
        assert.deepEqual(await history(fund.id), [['2026-10-30', 11000, 110], ['2026-11-03', 12500, 120.5]]);
    });

    test('a holding the user added by hand, with that name or that identifier, is the one updated, and is from the CSV afterwards', async () => {
        const account = await seedUser('u-hand');
        const added = (fields: Record<string, unknown>) => addManualHolding('u-hand', account, manualHoldingSchema.parse({ valueAsOf: '2026-10-01', ...fields }), { database });
        const byName = await added({ name: 'Target 2055 Trust', value: 12000 });
        const byCode = await added({ name: 'Plan stable value', identifier: '99zz 12341', value: 9500 });

        const result = await importFile('u-hand', account, file(trust('12345.67'), stable('10000.00')), '2026-11-02');
        assert.deepEqual(result.manual, { insert: 0, update: 2, unchanged: 0, replacedPositions: 0 });
        const saved = await loadManualHoldings('u-hand', database);
        assert.deepEqual(saved.map((h) => [h.id, h.name, h.identifier, h.value, h.valueAsOf, h.source, h.importKey]), [
            // Each keeps its id, its name, and the identifier it had.
            [byCode, 'Plan stable value', '99zz 12341', 10000, '2026-11-02', 'csv', 'csv:id:99ZZ12341'],
            [byName, 'Target 2055 Trust', null, 12345.67, '2026-11-02', 'csv', 'csv:name:target 2055 trust'],
        ]);
        assert.deepEqual((await history(byName)).map((r) => r[0]), ['2026-10-01', '2026-11-02']);
    });

    test('a holding a linked account keys is never matched; a linked account that still syncs refuses the rows and nothing is written, positions included', async () => {
        const ira = await seedUser('u-linked', 'IRA');
        // The account Plaid syncs, picked: what makes the account in Atlas one that syncs.
        const [item] = await sql<{ id: string }[]>`
            INSERT INTO plaid_items (user_id, plaid_item_id, institution_id, institution_name, access_token_ciphertext, access_token_iv, access_token_auth_tag)
            VALUES ('u-linked', 'item-link', 'ins_1', 'Example Brokerage', 'c', 'i', 't') RETURNING id`;
        await sql`
            INSERT INTO plaid_accounts (user_id, plaid_item_record_id, plaid_account_id, name, mask, type, subtype, capabilities, verification_status, sync_status)
            VALUES ('u-linked', ${item.id}, 'acc-link', 'Individual', '1234', 'investment', 'brokerage', '["holdings"]', 'automatically_verified', 'sync_ready')`;
        const [{ id: linked }] = await sql<{ id: string }[]>`
            INSERT INTO portfolios (user_id, name, source, external_account_id) VALUES ('u-linked', 'Brokerage Link', 'plaid', 'acc-link') RETURNING id`;
        // The fund the linked account syncs, and one the user moved from it to the IRA and valued there.
        const [synced] = await sql<{ id: string }[]>`
            INSERT INTO manual_holdings (user_id, portfolio_id, name, value, value_as_of, source, external_id)
            VALUES ('u-linked', ${linked}, 'Target 2055 Trust', 11000, '2026-10-30', 'plaid', ${`${linked}:sec_fund`}) RETURNING id`;
        await sql`INSERT INTO manual_holding_values (manual_holding_id, date, value) VALUES (${synced.id}, '2026-10-30', 11000)`;
        await sql`INSERT INTO manual_holdings (user_id, portfolio_id, name, value, value_as_of, source, external_id)
                  VALUES ('u-linked', ${ira}, 'Target 2055 Trust', 9000, '2026-10-30', 'manual', ${`${linked}:sec_other`})`;

        const imported = await importFile('u-linked', ira, file(trust('12345.67')), '2026-11-02');
        assert.deepEqual(imported.manual, { insert: 1, update: 0, unchanged: 0, replacedPositions: 0 });
        assert.deepEqual((await handValued('u-linked')).map((h) => [h.portfolio === linked ? 'link' : 'ira', h.value, h.source]), [
            ['ira', 9000, 'manual'], ['link', 11000, 'plaid'], ['ira', 12345.67, 'csv'],
        ]);

        const before = await handValued('u-linked');
        await assert.rejects(importFile('u-linked', linked, file(APPLE, trust('12500.00')), '2026-11-03'),
            (e: unknown) => e instanceof LinkedAccountImportError && e.message === 'Brokerage Link is linked to your bank, so its holdings without a ticker come from there. Import this file into another account.');
        assert.deepEqual(await handValued('u-linked'), before);
        assert.deepEqual(await positions(linked), []);
        // The file's positions alone still go in.
        const tickersOnly = await importFile('u-linked', linked, file(APPLE), '2026-11-03');
        assert.deepEqual([tickersOnly.insert, tickersOnly.manual.insert], [1, 0]);
        assert.deepEqual(await positions(linked), [['AAPL', 10, 150]]);
    });

    test('regression: once a linked account no longer syncs, a file updates the holding its last sync brought in', async () => {
        const ira = await seedUser('u-unlinked', 'IRA');
        const [item] = await sql<{ id: string }[]>`
            INSERT INTO plaid_items (user_id, plaid_item_id, institution_id, institution_name, access_token_ciphertext, access_token_iv, access_token_auth_tag)
            VALUES ('u-unlinked', 'item-unlinked', 'ins_1', 'Example Brokerage', 'c', 'i', 't') RETURNING id`;
        // Disconnected: Plaid's account isn't synced any more, as a revoked
        // connection or an account the institution stopped returning leaves
        // it, and the account in Atlas is still the linked one.
        await sql`
            INSERT INTO plaid_accounts (user_id, plaid_item_record_id, plaid_account_id, name, mask, type, subtype, capabilities, verification_status, sync_status)
            VALUES ('u-unlinked', ${item.id}, 'acc-unlinked', 'Individual', '1234', 'investment', 'brokerage', '["holdings"]', 'automatically_verified', 'excluded')`;
        const [{ id: linked }] = await sql<{ id: string }[]>`
            INSERT INTO portfolios (user_id, name, source, external_account_id) VALUES ('u-unlinked', 'Brokerage Link', 'plaid', 'acc-unlinked') RETURNING id`;
        const [synced] = await sql<{ id: string }[]>`
            INSERT INTO manual_holdings (user_id, portfolio_id, name, value, value_as_of, source, external_id)
            VALUES ('u-unlinked', ${linked}, 'Target 2055 Trust', 11000, '2026-10-30', 'plaid', ${`${linked}:sec_fund`}) RETURNING id`;
        await sql`INSERT INTO manual_holding_values (manual_holding_id, date, value) VALUES (${synced.id}, '2026-10-30', 11000)`;
        // Moved to the IRA from a linked account: still keyed by that account, so never the file's to update.
        await sql`INSERT INTO manual_holdings (user_id, portfolio_id, name, value, value_as_of, source, external_id)
                  VALUES ('u-unlinked', ${ira}, 'Target 2055 Trust', 9000, '2026-10-30', 'manual', ${`${linked}:sec_other`})`;

        const result = await importFile('u-unlinked', linked, file(APPLE, trust('12500.00')), '2026-11-03');
        assert.deepEqual([result.insert, result.manual], [1, { insert: 0, update: 1, unchanged: 0, replacedPositions: 0 }]);
        assert.deepEqual(await positions(linked), [['AAPL', 10, 150]]);
        const [fund] = (await handValued('u-unlinked')).filter((h) => h.portfolio === linked);
        // The same holding, the file's from now on, with the sync's day and the file's.
        assert.deepEqual(fund, {
            id: synced.id, portfolio: linked, name: 'Target 2055 Trust', identifier: null, quantity: 120.5, value: 12500, cost: 10000,
            asOf: '2026-11-03', source: 'csv', external: 'csv:name:target 2055 trust',
        });
        assert.deepEqual(await history(synced.id), [['2026-10-30', 11000, null], ['2026-11-03', 12500, 120.5]]);
        assert.deepEqual((await handValued('u-unlinked')).filter((h) => h.portfolio === ira).map((h) => [h.value, h.source, h.external]), [
            [9000, 'manual', `${linked}:sec_other`],
        ]);
        // The next file finds it by its key.
        const again = await importFile('u-unlinked', linked, file(trust('12600.00')), '2026-11-04');
        assert.deepEqual(again.manual, { insert: 0, update: 1, unchanged: 0, replacedPositions: 0 });
        assert.equal((await handValued('u-unlinked')).filter((h) => h.portfolio === linked).length, 1);
    });

    test('a holding the file leaves out stays as it was', async () => {
        const account = await seedUser('u-left');
        await importFile('u-left', account, file(trust('12345.67'), stable('10000.00')), '2026-11-02');
        await importFile('u-left', account, file(trust('12500.00')), '2026-11-03');
        assert.deepEqual((await handValued('u-left')).map((h) => [h.name, h.value, h.asOf]), [
            ['Stable Value Fund', 10000, '2026-11-02'], ['Target 2055 Trust', 12500, '2026-11-03'],
        ]);
    });

    test('another user\'s account is not found, and nothing is written', async () => {
        const owner = await seedUser('u-owner');
        await seedUser('u-intruder');
        await assert.rejects(importFile('u-intruder', owner, file(APPLE, trust('12345.67')), '2026-11-02'), ImportAccessError);
        assert.deepEqual(await handValued('u-owner'), []);
        assert.deepEqual(await handValued('u-intruder'), []);
        assert.deepEqual(await positions(owner), []);
    });

    test('a position imported earlier under its CUSIP is replaced by the holding valued by hand', async () => {
        const account = await seedUser('u-cusip');
        await sql`INSERT INTO holdings (portfolio_id, symbol, name, quantity, avg_cost) VALUES (${account}, '99ZZ12341', 'Stable Value Fund', 100, 90), (${account}, 'MSFT', 'Microsoft', 2, 300)`;
        const result = await importFile('u-cusip', account, file(stable('10000.00')), '2026-11-02');
        assert.deepEqual(result.manual, { insert: 1, update: 0, unchanged: 0, replacedPositions: 1 });
        assert.deepEqual(await positions(account), [['MSFT', 2, 300]]);
        assert.deepEqual((await handValued('u-cusip')).map((h) => [h.name, h.identifier, h.value, h.external]), [
            ['Stable Value Fund', '99ZZ12341', 10000, 'csv:id:99ZZ12341'],
        ]);
    });

    test('the source check accepts csv and still refuses any other value', async () => {
        const account = await seedUser('u-source');
        await sql`INSERT INTO manual_holdings (user_id, portfolio_id, name, value, value_as_of, source) VALUES ('u-source', ${account}, 'From a file', 1, '2026-11-02', 'csv')`;
        await assert.rejects(
            sql`INSERT INTO manual_holdings (user_id, portfolio_id, name, value, value_as_of, source) VALUES ('u-source', ${account}, 'Unknown', 1, '2026-11-02', 'broker')`,
            /manual_holdings_source_check/,
        );
    });

    test('the nightly valuation reads the holding with its value history', async () => {
        const account = await seedUser('u-nightly');
        await importFile('u-nightly', account, file(trust('12345.67')), '2026-11-02');
        await importFile('u-nightly', account, file(trust('12500.00')), '2026-11-03');
        const [{ id }] = await handValued('u-nightly');
        const states = await createSnapshotStore(database, { now: () => new Date('2026-11-04T12:00:00Z') }).portfolios();
        const held = states.find((s) => s.portfolioId === account)?.manual ?? [];
        assert.deepEqual(held.map((m) => [m.id, m.value, m.quantity, m.costBasis, m.history?.map((r) => [r.date, r.value, r.quantity])]), [
            [id, 12500, 120.5, 10000, [['2026-11-02', 12345.67, 120.5], ['2026-11-03', 12500, 120.5]]],
        ]);
    });

    test('moving a file\'s holding into an account with one under the same key keeps both, the moved one without a key', async () => {
        const old401k = await seedUser('u-move', 'Old 401k');
        const [{ id: new401k }] = await sql<{ id: string }[]>`INSERT INTO portfolios (user_id, name) VALUES ('u-move', 'New 401k') RETURNING id`;
        await importFile('u-move', old401k, file(trust('12345.67')), '2026-11-02');
        await importFile('u-move', new401k, file(trust('500.00', '5', '400')), '2026-11-02');
        const moved = (await handValued('u-move')).find((h) => h.portfolio === old401k)!;
        assert.ok(await updateManualHolding('u-move', moved.id, new401k, manualHoldingSchema.parse({
            name: moved.name, quantity: moved.quantity, value: moved.value, costBasis: moved.cost, valueAsOf: moved.asOf,
        }), { database }));
        assert.deepEqual((await handValued('u-move')).map((h) => [h.portfolio === new401k, h.value, h.source, h.external]), [
            [true, 500, 'csv', 'csv:name:target 2055 trust'], [true, 12345.67, 'csv', null],
        ]);
        // The next file updates the one with the key; the moved one stays.
        const next = await importFile('u-move', new401k, file(trust('600.00', '5', '400')), '2026-11-03');
        assert.deepEqual(next.manual, { insert: 0, update: 1, unchanged: 0, replacedPositions: 0 });
        assert.deepEqual((await handValued('u-move')).map((h) => [h.value, h.external]), [[600, 'csv:name:target 2055 trust'], [12345.67, null]]);
    });

    test('regression: a value as of 0001-01-01 or 9999-12-31, the first and last days Postgres keeps, is stored', async () => {
        const account = await seedUser('u-dates');
        const fund = (valueAsOf: string) => manualHoldingSchema.parse({ name: 'Target 2055 Trust', value: 100, valueAsOf });
        const id = await addManualHolding('u-dates', account, fund('0001-01-01'), { database });
        assert.deepEqual((await handValued('u-dates')).map((h) => h.asOf), ['0001-01-01']);
        assert.ok(await updateManualHolding('u-dates', id, account, fund('9999-12-31'), { database }));
        assert.deepEqual((await handValued('u-dates')).map((h) => h.asOf), ['9999-12-31']);
        assert.deepEqual(await history(id), [['0001-01-01', 100, null], ['9999-12-31', 100, null]]);
    });

    test('a bucket chosen for an imported holding still applies after the same file is imported again (launch item i54)', async () => {
        const account = await seedUser('u-bucket');
        await importFile('u-bucket', account, file(APPLE, trust('12345.67')), '2026-11-02');
        const [{ id }] = await handValued('u-bucket');
        // Chosen in Settings › Bucket policy: the settings document keeps it by the holding's id.
        const riskPolicy = { ...defaultPersistedSettings().riskPolicy, bucketAssignments: { [manualSymbol(id)]: 'speculative' } };
        await sql`INSERT INTO user_settings (user_id, version, settings) VALUES ('u-bucket', ${SETTINGS_VERSION}, ${JSON.stringify({ riskPolicy })}::jsonb)`;

        await importFile('u-bucket', account, file(APPLE, trust('12500.00')), '2026-11-03');
        assert.deepEqual((await handValued('u-bucket')).map((h) => [h.id, h.value]), [[id, 12500]]);

        // Read as Today reads the portfolio and the saved policy.
        const accounts = await database.query.portfolios.findMany({
            where: eq(schema.portfolios.userId, 'u-bucket'),
            with: { holdings: true, manualHoldings: { columns: { id: true, name: true, value: true, costBasis: true, valueAsOf: true } } },
        });
        const [stored] = await database.select().from(schema.userSettings).where(eq(schema.userSettings.userId, 'u-bucket'));
        const policy = storedRiskPolicy({ status: 'ok', document: { version: stored.version, settings: stored.settings, updatedAt: stored.updatedAt.toISOString() } });
        const portfolio = buildPolicyPortfolio({ accounts });
        assert.deepEqual(portfolio.handValued?.map((h) => [h.name, h.account, h.marketValue]), [['Target 2055 Trust', 'Workplace 401k', 12500]]);
        const input = riskPolicyInput(portfolio, policy);
        assert.deepEqual(input.holdings.map((h) => h.symbol), ['AAPL']);
        assert.deepEqual(input.otherHoldings?.map((h) => [h.symbol, h.policyBucket]), [[manualSymbol(id), 'speculative']]);
    });
});
