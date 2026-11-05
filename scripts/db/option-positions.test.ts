import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import {
    countOptionContractsToMark,
    listOptionContractsToMark,
    pruneOptionMarks,
    saveOptionMark,
} from '../../src/lib/markets/option-marks';
import { importHoldings } from '../../src/lib/portfolio/importHoldings';
import {
    addOptionPosition,
    deleteOptionPosition,
    DuplicateOptionPositionError,
    loadOptionPositions,
    loadThesisChoices,
    updateOptionPosition,
} from '../../src/lib/portfolio/option-positions-store';
import { AccountNotFoundError } from '../../src/lib/portfolio/transactionsWrite';
import { optionPositionSchema, type OptionPositionInput } from '../../src/lib/validators/option-position';

// Launch item i63: option positions for the LEAPS ledger, and the shared
// end-of-day marks the nightly job stores, against a scratch database with
// every migration applied. Needs a local Postgres it may create databases
// in; CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

const AAPL_CALL = 'O:AAPL270115C00250000';
const SESSION = '2026-10-16';

describe('option positions', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `option_positions_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: Parameters<typeof addOptionPosition>[3] & object;

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

    async function seedUser(user: string, account = 'Brokerage'): Promise<string> {
        await sql`INSERT INTO auth_users (id, name, email) VALUES (${user}, ${user}, ${`${user}@example.test`}) ON CONFLICT DO NOTHING`;
        const [p] = await sql<{ id: string }[]>`INSERT INTO portfolios (user_id, name) VALUES (${user}, ${account}) RETURNING id`;
        return p.id;
    }

    const position = (overrides: Partial<Record<keyof OptionPositionInput, unknown>> = {}): OptionPositionInput => optionPositionSchema.parse({
        underlying: 'AAPL', contractType: 'call', strike: 250, expiry: '2027-01-15', quantity: 3, premium: 18.2, ...overrides,
    });

    test("a position is saved to the user's own account and reads back marked at cost, with its thesis", async () => {
        const account = await seedUser('u-add');
        await sql`INSERT INTO theses (user_id, id, ticker, title, description, type, status, conviction, target_price, date_created, date_updated) VALUES ('u-add', 't-own', 'AAPL', 'Services margin', 'd', 'bull', 'active', 'HIGH', 300, '2026-03-01', '2026-03-01')`;
        const id = await addOptionPosition('u-add', account, position({ thesisId: 't-own', exitRule: 'Exit at half', expiryTest: 'Services re-rate' }), database);

        const [loaded] = await loadOptionPositions('u-add', { database, quotes: async () => ({ AAPL: { price: 231.5 } }) });
        assert.deepEqual(
            [loaded.id, loaded.portfolioId, loaded.account, loaded.contract, loaded.quantity, loaded.premium, loaded.multiplier, loaded.thesisTitle, loaded.underlyingPrice],
            [id, account, 'Brokerage', AAPL_CALL, 3, 18.2, 100, 'Services margin', 231.5],
        );
        assert.deepEqual(loaded.mark, { source: 'cost', price: 18.2 });
        assert.deepEqual(await loadThesisChoices('u-add', database), [{ id: 't-own', ticker: 'AAPL', title: 'Services margin' }]);
    });

    test("regression: another user's account is refused, in code and by the database", async () => {
        const theirs = await seedUser('u-victim');
        await seedUser('u-attacker');
        await assert.rejects(addOptionPosition('u-attacker', theirs, position(), database), AccountNotFoundError);
        // Even a write that skipped the check: the account must be the same user's.
        await assert.rejects(
            sql`INSERT INTO option_positions (user_id, portfolio_id, contract, underlying, contract_type, strike, expiry, quantity, premium) VALUES ('u-attacker', ${theirs}, ${AAPL_CALL}, 'AAPL', 'call', 250, '2027-01-15', 1, 1)`,
            /option_positions_portfolio_owner_fk/,
        );
        assert.deepEqual(await loadOptionPositions('u-attacker', { database }), []);
    });

    test("a thesis is read only from the user's own, undeleted theses", async () => {
        const account = await seedUser('u-thesis');
        await seedUser('u-someone');
        await sql`INSERT INTO theses (user_id, id, ticker, title, description, type, status, conviction, target_price, date_created, date_updated) VALUES ('u-someone', 't-shared-id', 'AAPL', 'Not yours', 'd', 'bull', 'active', 'HIGH', 300, '2026-03-01', '2026-03-01')`;
        await sql`INSERT INTO theses (user_id, id, ticker, title, description, type, status, conviction, target_price, date_created, date_updated, dismissed) VALUES ('u-thesis', 't-gone', 'AAPL', '', '', 'bull', 'active', 'HIGH', 0, '2026-03-01', '2026-03-01', true)`;
        await addOptionPosition('u-thesis', account, position({ thesisId: 't-shared-id' }), database);
        await addOptionPosition('u-thesis', account, position({ strike: 300, thesisId: 't-gone' }), database);
        const loaded = await loadOptionPositions('u-thesis', { database });
        assert.deepEqual(loaded.map((p) => [p.strike, p.thesisId, p.thesisTitle]), [[250, 't-shared-id', null], [300, 't-gone', null]]);
    });

    test('one row per contract an account holds; edit, move and delete only your own', async () => {
        const brokerage = await seedUser('u-edit');
        const ira = await seedUser('u-edit', 'IRA');
        const other = await seedUser('u-edit-other');
        const id = await addOptionPosition('u-edit', brokerage, position(), database);
        await assert.rejects(addOptionPosition('u-edit', brokerage, position({ quantity: 1 }), database), DuplicateOptionPositionError);
        // The same contract in another account is another position.
        const iraId = await addOptionPosition('u-edit', ira, position(), database);

        // Moving it into the account that already holds the contract collides.
        await assert.rejects(updateOptionPosition('u-edit', id, ira, position(), { database }), DuplicateOptionPositionError);
        assert.equal(await deleteOptionPosition('u-edit', iraId, database), true);
        assert.equal(await updateOptionPosition('u-edit', id, ira, position({ quantity: -2, userMark: 20, userMarkDate: '2026-10-17' }), { database }), true);
        const [moved] = await loadOptionPositions('u-edit', { database });
        assert.deepEqual([moved.portfolioId, moved.account, moved.quantity], [ira, 'IRA', -2]);
        assert.deepEqual(moved.mark, { source: 'user', price: 20, date: '2026-10-17' });

        // Another user can't change or delete it, or move it into their account.
        assert.equal(await updateOptionPosition('u-edit-other', id, other, position(), { database }), false);
        await assert.rejects(updateOptionPosition('u-edit', id, other, position(), { database }), AccountNotFoundError);
        assert.equal(await deleteOptionPosition('u-edit-other', id, database), false);
        assert.equal(await deleteOptionPosition('u-edit', id, database), true);
        assert.deepEqual(await loadOptionPositions('u-edit', { database }), []);
    });

    test("a CSV's option rows go in with its stocks; importing it again updates the counts and keeps the plan", async () => {
        const account = await seedUser('u-import');
        const rows = [{ symbol: 'AAPL', name: 'Apple', quantity: 10, avgCost: 150 }];
        const options = [
            { underlying: 'AAPL', contractType: 'call' as const, strike: 250, expiry: '2027-01-15', quantity: 3, premium: 18.2 },
            { underlying: 'RIVN', contractType: 'call' as const, strike: 25, expiry: '2027-01-15', quantity: -2, premium: 4.4 },
        ];
        const first = await importHoldings('u-import', { portfolioId: account, rows, options }, {}, database);
        assert.deepEqual(first.options, { insert: 2, update: 0, unchanged: 0 });
        const [aapl] = await loadOptionPositions('u-import', { database });
        await updateOptionPosition('u-import', aapl.id, account, position({ exitRule: 'Exit at half', thesisId: 't-1' }), { database });

        const again = await importHoldings('u-import', { portfolioId: account, rows, options: [{ ...options[0], quantity: 5, premium: 17 }, options[1]] }, {}, database);
        assert.deepEqual(again.options, { insert: 0, update: 1, unchanged: 1 });
        const loaded = await loadOptionPositions('u-import', { database });
        assert.deepEqual(loaded.map((p) => [p.underlying, p.quantity, p.premium, p.exitRule, p.thesisId]), [
            ['AAPL', 5, 17, 'Exit at half', 't-1'],
            ['RIVN', -2, 4.4, '', null],
        ]);
        const [{ source }] = await sql<{ source: string }[]>`SELECT source FROM option_positions WHERE underlying = 'RIVN' AND user_id = 'u-import'`;
        assert.equal(source, 'csv');
    });

    test('marks: held, unexpired contracts once a session, never-asked first; an older close never replaces a newer one', async () => {
        // Marks are for every contract anyone holds: start from no one's.
        await sql`DELETE FROM option_positions`;
        const account = await seedUser('u-marks');
        await addOptionPosition('u-marks', account, position(), database);
        await addOptionPosition('u-marks', account, position({ underlying: 'RIVN', strike: 25 }), database);
        // Expired before the session: it trades no more.
        await addOptionPosition('u-marks', account, position({ underlying: 'MSFT', strike: 400, expiry: '2026-10-09' }), database);
        // Another user holding the same contract doesn't make it two.
        const other = await seedUser('u-marks-other');
        await addOptionPosition('u-marks-other', other, position(), database);

        const RIVN_CALL = 'O:RIVN270115C00025000';
        await saveOptionMark(RIVN_CALL, { date: '2026-10-14', close: 1.9 }, { session: '2026-10-15', at: new Date('2026-10-15T22:30:00Z'), source: 'massive' }, database);
        assert.deepEqual(await listOptionContractsToMark(10, SESSION, database), [AAPL_CALL, RIVN_CALL]);
        assert.deepEqual(await listOptionContractsToMark(1, SESSION, database), [AAPL_CALL]);

        const at = new Date('2026-10-16T22:30:00Z');
        await saveOptionMark(AAPL_CALL, { date: '2026-10-16', close: 21.4 }, { session: SESSION, at, source: 'massive' }, database);
        // No trade this time: the last close stays.
        await saveOptionMark(RIVN_CALL, null, { session: SESSION, at, source: 'massive' }, database);
        assert.equal(await countOptionContractsToMark(SESSION, database), 0);
        await saveOptionMark(AAPL_CALL, { date: '2026-10-12', close: 15 }, { session: SESSION, at, source: 'massive' }, database);

        const loaded = await loadOptionPositions('u-marks', { database });
        assert.deepEqual(loaded.map((p) => [p.underlying, p.mark]), [
            ['MSFT', { source: 'cost', price: 18.2 }],
            ['AAPL', { source: 'close', price: 21.4, date: '2026-10-16' }],
            ['RIVN', { source: 'close', price: 1.9, date: '2026-10-14' }],
        ]);

        // A mark of a contract no one holds any more goes.
        await sql`DELETE FROM option_positions WHERE contract = ${RIVN_CALL}`;
        assert.equal(await pruneOptionMarks(database), 1);
        assert.deepEqual((await sql`SELECT contract FROM option_marks ORDER BY contract`).map((r) => r.contract), [AAPL_CALL]);
    });

    test("the table's checks refuse what the API would", async () => {
        const account = await seedUser('u-checks');
        const insert = (fields: string, values: string) =>
            sql.unsafe(`INSERT INTO option_positions (user_id, portfolio_id, contract, underlying, contract_type, strike, expiry, quantity, premium${fields}) VALUES ('u-checks', '${account}', 'O:X', 'X', 'call', 1, '2027-01-15', 1, 1${values})`);
        await assert.rejects(insert(', user_mark', ', 5'), /option_positions_user_mark_check/);
        await assert.rejects(sql.unsafe(`INSERT INTO option_positions (user_id, portfolio_id, contract, underlying, contract_type, strike, expiry, quantity, premium) VALUES ('u-checks', '${account}', 'O:X', 'X', 'call', 1, '2027-01-15', 0, 1)`), /option_positions_quantity_check/);
        await assert.rejects(sql.unsafe(`INSERT INTO option_positions (user_id, portfolio_id, contract, underlying, contract_type, strike, expiry, quantity, premium) VALUES ('u-checks', '${account}', 'O:X', 'X', 'straddle', 1, '2027-01-15', 1, 1)`), /option_positions_contract_type_check/);
    });
});
