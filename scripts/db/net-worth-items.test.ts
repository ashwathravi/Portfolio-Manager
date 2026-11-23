import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../../src/db/schema';
import { ASSET_CATEGORIES, DEBT_CATEGORIES } from '../../src/lib/portfolio/net-worth';
import { addNetWorthItem, deleteNetWorthItem, loadNetWorthItems, NetWorthKindChangeError, updateNetWorthItem } from '../../src/lib/portfolio/net-worth-items';
import { netWorthItemSchema } from '../../src/lib/validators/net-worth-item';

// Other assets and debts (net_worth_items) and the value each had on each
// day it was valued (net_worth_item_values), checked by the real writes
// against a scratch database with every migration applied. Needs a local
// Postgres it may create databases in; CI's e2e job sets this.
// Locally: SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth
const DATABASE_URL = process.env.SCRIPTS_TEST_DATABASE_URL?.trim();

const ADDED = new Date('2026-11-01T15:00:00.000Z');
const EDITED = new Date('2026-11-23T15:00:00.000Z');
// How the table keeps them (timestamp, in UTC), read back as text.
const ADDED_AT = '2026-11-01 15:00:00';
const EDITED_AT = '2026-11-23 15:00:00';

describe('other assets and debts', { skip: !DATABASE_URL && 'SCRIPTS_TEST_DATABASE_URL is not set', timeout: 120_000 }, () => {
    const name = `net_worth_items_test_${process.pid}`;
    let server: ReturnType<typeof postgres>;
    let sql: ReturnType<typeof postgres>;
    let database: Parameters<typeof loadNetWorthItems>[1] & object;

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

    beforeEach(async () => {
        await sql`TRUNCATE auth_users CASCADE`;
        await sql`INSERT INTO auth_users (id, name, email) VALUES ('u-1', 'One', 'u-1@example.test'), ('u-2', 'Two', 'u-2@example.test')`;
    });

    /** An item as the routes pass it on: through the validator. */
    const item = (fields: Record<string, unknown> = {}) => netWorthItemSchema.parse({
        kind: 'asset', category: 'property', name: 'Home', value: 300_000, valueAsOf: '2026-11-01', ...fields,
    });
    /** A row straight into the table, past the validator, for the table's own checks. */
    const insert = (fields: Record<string, string | number | null> = {}) => sql`
        INSERT INTO net_worth_items ${sql({ user_id: 'u-1', kind: 'asset', category: 'property', name: 'Home', value: 1, value_as_of: '2026-11-01', note: null, ...fields })}
        RETURNING id`;
    const valuesOf = async (id: string) => (await sql<{ date: string; value: string }[]>`
        SELECT to_char(date, 'YYYY-MM-DD') AS date, value::text AS value FROM net_worth_item_values
        WHERE net_worth_item_id = ${id} ORDER BY date`).map((r) => [r.date, Number(r.value)]);
    const at = (column: string) => sql.unsafe(`to_char(${column}, 'YYYY-MM-DD HH24:MI:SS')`);

    test('every category goes with its own kind, and only with it', async () => {
        for (const category of ASSET_CATEGORIES) await insert({ kind: 'asset', category });
        for (const category of DEBT_CATEGORIES) await insert({ kind: 'debt', category });
        assert.equal((await sql`SELECT 1 FROM net_worth_items`).length, ASSET_CATEGORIES.length + DEBT_CATEGORIES.length);

        await assert.rejects(insert({ kind: 'asset', category: 'mortgage' }), /net_worth_items_category_check/);
        await assert.rejects(insert({ kind: 'debt', category: 'vehicle' }), /net_worth_items_category_check/);
        await assert.rejects(insert({ category: 'retirement_account' }), /net_worth_items_category_check/);
    });

    test('a negative value, an empty or too long name, an empty note or an unknown kind is refused; no note is fine', async () => {
        await assert.rejects(insert({ value: -0.01 }), /net_worth_items_value_check/);
        await assert.rejects(insert({ name: '' }), /net_worth_items_name_check/);
        await assert.rejects(insert({ name: 'x'.repeat(121) }), /net_worth_items_name_check/);
        await insert({ name: 'x'.repeat(120) });
        await assert.rejects(insert({ note: '' }), /net_worth_items_note_check/);
        await assert.rejects(insert({ note: 'n'.repeat(501) }), /net_worth_items_note_check/);
        // Checks run in name order, so the category check, which also needs
        // asset or debt, can be the one that answers.
        await assert.rejects(insert({ kind: 'liability' }), /net_worth_items_(category|kind)_check/);
        await insert({ note: null });

        const [{ id }] = await insert();
        await assert.rejects(sql`INSERT INTO net_worth_item_values (net_worth_item_id, date, value) VALUES (${id}, '2026-11-01', -1)`, /net_worth_item_values_value_check/);
    });

    test('adding one keeps its first value as of its day', async () => {
        const id = await addNetWorthItem('u-1', item({ note: 'estimate' }), { database, now: ADDED });
        const [row] = await sql`SELECT user_id, kind, category, name, value::text AS value, to_char(value_as_of, 'YYYY-MM-DD') AS as_of, note,
                                       ${at('created_at')} AS created_at, ${at('updated_at')} AS updated_at
                                FROM net_worth_items WHERE id = ${id}`;
        assert.deepEqual({ ...row }, {
            user_id: 'u-1', kind: 'asset', category: 'property', name: 'Home', value: '300000', as_of: '2026-11-01', note: 'estimate',
            created_at: ADDED_AT, updated_at: ADDED_AT,
        });
        assert.deepEqual(await valuesOf(id), [['2026-11-01', 300_000]]);
    });

    test('an update replaces the value and its date and moves updated_at; each day\'s value is kept, and a value stands from its day on', async () => {
        const id = await addNetWorthItem('u-1', item(), { database, now: ADDED });

        assert.equal(await updateNetWorthItem('u-1', id, item({ value: 310_000, valueAsOf: '2026-11-15', note: 'appraisal' }), { database, now: EDITED }), true);
        const [row] = await sql`SELECT value::text AS value, to_char(value_as_of, 'YYYY-MM-DD') AS as_of, note,
                                       ${at('created_at')} AS created_at, ${at('updated_at')} AS updated_at
                                FROM net_worth_items WHERE id = ${id}`;
        assert.deepEqual({ ...row }, { value: '310000', as_of: '2026-11-15', note: 'appraisal', created_at: ADDED_AT, updated_at: EDITED_AT });
        assert.deepEqual(await valuesOf(id), [['2026-11-01', 300_000], ['2026-11-15', 310_000]]);

        // The same day again replaces that day's value.
        await updateNetWorthItem('u-1', id, item({ value: 312_000, valueAsOf: '2026-11-15' }), { database, now: EDITED });
        assert.deepEqual(await valuesOf(id), [['2026-11-01', 300_000], ['2026-11-15', 312_000]]);

        // An earlier day: the value given stands from then on, so the later one goes.
        await updateNetWorthItem('u-1', id, item({ value: 305_000, valueAsOf: '2026-11-10' }), { database, now: EDITED });
        assert.deepEqual(await valuesOf(id), [['2026-11-01', 300_000], ['2026-11-10', 305_000]]);

        // The category can change with it, within its kind.
        await updateNetWorthItem('u-1', id, item({ category: 'other_asset', name: 'Land', value: 305_000, valueAsOf: '2026-11-10' }), { database, now: EDITED });
        assert.deepEqual((await loadNetWorthItems('u-1', database)).map((i) => [i.kind, i.category, i.name, i.value]), [['asset', 'other_asset', 'Land', 305_000]]);
        assert.deepEqual(await valuesOf(id), [['2026-11-01', 300_000], ['2026-11-10', 305_000]]);
    });

    test('an asset can\'t become a debt, nor a debt an asset: refused, with the item and its values as they were', async () => {
        // The values kept by day have no kind: kept, a home's would read as a debt's.
        const home = await addNetWorthItem('u-1', item(), { database, now: ADDED });
        await assert.rejects(
            updateNetWorthItem('u-1', home, item({ kind: 'debt', category: 'other_debt', name: 'Loan', value: 5_000, valueAsOf: '2026-11-20' }), { database, now: EDITED }),
            (error: unknown) => error instanceof NetWorthKindChangeError && error.message === 'An asset can\'t become a debt. Delete it and add it as a debt.',
        );
        const [row] = await sql`SELECT kind, category, name, value::text AS value, to_char(value_as_of, 'YYYY-MM-DD') AS as_of, ${at('updated_at')} AS updated_at
                                FROM net_worth_items WHERE id = ${home}`;
        assert.deepEqual({ ...row }, { kind: 'asset', category: 'property', name: 'Home', value: '300000', as_of: '2026-11-01', updated_at: ADDED_AT });
        assert.deepEqual(await valuesOf(home), [['2026-11-01', 300_000]]);

        const loan = await addNetWorthItem('u-1', item({ kind: 'debt', category: 'student_loan', name: 'Loan', value: 25_000 }), { database, now: ADDED });
        await assert.rejects(
            updateNetWorthItem('u-1', loan, item({ category: 'owed_to_you', name: 'Loan', value: 25_000, valueAsOf: '2026-11-20' }), { database, now: EDITED }),
            { message: 'A debt can\'t become an asset. Delete it and add it as an asset.' },
        );
        assert.deepEqual((await loadNetWorthItems('u-1', database)).map((i) => [i.kind, i.name, i.valueAsOf]), [['asset', 'Home', '2026-11-01'], ['debt', 'Loan', '2026-11-01']]);
        assert.deepEqual(await valuesOf(loan), [['2026-11-01', 25_000]]);

        // Another user's item is not found, whatever kind is sent: its kind isn't given away.
        assert.equal(await updateNetWorthItem('u-2', home, item({ kind: 'debt', category: 'mortgage' }), { database, now: EDITED }), false);
        assert.deepEqual(await valuesOf(home), [['2026-11-01', 300_000]]);
    });

    test('the first and last days the form takes are days Postgres keeps', async () => {
        const id = await addNetWorthItem('u-1', item({ valueAsOf: '0001-01-01', value: 1 }), { database, now: ADDED });
        assert.equal(await updateNetWorthItem('u-1', id, item({ valueAsOf: '9999-12-31', value: 2 }), { database, now: EDITED }), true);
        assert.deepEqual(await valuesOf(id), [['0001-01-01', 1], ['9999-12-31', 2]]);
        assert.equal((await loadNetWorthItems('u-1', database))[0].valueAsOf, '9999-12-31');
        // The day before the first is the form's to refuse (400), not the database's (500).
        assert.equal(netWorthItemSchema.safeParse({ kind: 'asset', category: 'property', name: 'Home', value: 1, valueAsOf: '0000-12-31' }).success, false);
        await assert.rejects(sql`SELECT '0000-12-31'::date`, /out of range/);
    });

    test('another user\'s item can\'t be updated or deleted, and keeps its values', async () => {
        const id = await addNetWorthItem('u-1', item(), { database, now: ADDED });
        assert.equal(await updateNetWorthItem('u-2', id, item({ name: 'Taken', value: 1, valueAsOf: '2026-11-20' }), { database, now: EDITED }), false);
        assert.equal(await deleteNetWorthItem('u-2', id, { database }), false);
        const [row] = await sql`SELECT user_id, name, value::text AS value, ${at('updated_at')} AS updated_at FROM net_worth_items WHERE id = ${id}`;
        assert.deepEqual({ ...row }, { user_id: 'u-1', name: 'Home', value: '300000', updated_at: ADDED_AT });
        assert.deepEqual(await valuesOf(id), [['2026-11-01', 300_000]]);
        // And it isn't among theirs.
        assert.deepEqual(await loadNetWorthItems('u-2', database), []);

        assert.equal(await updateNetWorthItem('u-1', '00000000-0000-4000-8000-000000000799', item(), { database }), false);
        assert.equal(await deleteNetWorthItem('u-1', '00000000-0000-4000-8000-000000000799', { database }), false);
    });

    test('the user\'s items come back assets first, then the largest first, then by name, with values as numbers', async () => {
        await addNetWorthItem('u-1', item({ kind: 'debt', category: 'credit_card', name: 'Card', value: 1_000 }), { database, now: ADDED });
        await addNetWorthItem('u-1', item({ category: 'vehicle', name: 'Car', value: 1_234.56 }), { database, now: ADDED });
        await addNetWorthItem('u-1', item({ name: 'Home', value: 300_000 }), { database, now: ADDED });
        await addNetWorthItem('u-1', item({ category: 'valuables', name: 'Art', value: 1_234.56 }), { database, now: ADDED });
        await addNetWorthItem('u-1', item({ kind: 'debt', category: 'mortgage', name: 'Mortgage', value: 200_000, valueAsOf: '2026-10-15' }), { database, now: ADDED });
        await addNetWorthItem('u-2', item({ name: 'Theirs', value: 999_999 }), { database, now: ADDED });

        const items = await loadNetWorthItems('u-1', database);
        assert.deepEqual(items.map((i) => [i.kind, i.name, i.value]), [
            ['asset', 'Home', 300_000],
            ['asset', 'Art', 1_234.56],
            ['asset', 'Car', 1_234.56],
            ['debt', 'Mortgage', 200_000],
            ['debt', 'Card', 1_000],
        ]);
        assert.equal(items[3].valueAsOf, '2026-10-15');
        assert.equal(items[0].updatedAt, ADDED.toISOString());
        assert.equal(items[0].note, null);
    });

    test('deleting an item takes its values; deleting the user takes their items and leaves the other user\'s', async () => {
        const home = await addNetWorthItem('u-1', item(), { database, now: ADDED });
        const loan = await addNetWorthItem('u-1', item({ kind: 'debt', category: 'student_loan', name: 'Loan', value: 25_000 }), { database, now: ADDED });
        const theirs = await addNetWorthItem('u-2', item({ name: 'Theirs' }), { database, now: ADDED });

        assert.equal(await deleteNetWorthItem('u-1', loan, { database }), true);
        assert.deepEqual(await valuesOf(loan), []);
        assert.equal(await deleteNetWorthItem('u-1', loan, { database }), false);

        await sql`DELETE FROM auth_users WHERE id = 'u-1'`;
        assert.equal((await sql`SELECT 1 FROM net_worth_items WHERE user_id = 'u-1'`).length, 0);
        assert.deepEqual(await valuesOf(home), []);
        assert.deepEqual((await loadNetWorthItems('u-2', database)).map((i) => i.name), ['Theirs']);
        assert.deepEqual(await valuesOf(theirs), [['2026-11-01', 300_000]]);
    });
});
