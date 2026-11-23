import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { netWorthItems } from '@/db/schema';

import { MAX_NET_WORTH_ITEM_BODY_BYTES, NET_WORTH_ITEM_LIMITS, netWorthItemSchema } from './net-worth-item';

const HOME = { kind: 'asset', category: 'property', name: 'Home', value: 300_000, valueAsOf: '2026-11-01' };
const MORTGAGE = { kind: 'debt', category: 'mortgage', name: 'Mortgage', value: 200_000, valueAsOf: '2026-10-15' };

/** The first issue's message, or null when the item is accepted. */
const refused = (input: unknown): string | null => {
    const result = netWorthItemSchema.safeParse(input);
    return result.success ? null : result.error.issues[0].message;
};

describe('netWorthItemSchema', () => {
    test('accepts an asset and a debt with only the required fields; the note comes back null', () => {
        assert.deepEqual(netWorthItemSchema.parse(HOME), { ...HOME, note: null });
        assert.deepEqual(netWorthItemSchema.parse(MORTGAGE), { ...MORTGAGE, note: null });
        assert.deepEqual(netWorthItemSchema.parse({ ...MORTGAGE, note: null }), { ...MORTGAGE, note: null });
    });

    test('trims the name and note, rounds the value to cents, and turns an empty note into none', () => {
        assert.deepEqual(netWorthItemSchema.parse({ ...HOME, name: '  Lake house ', value: 412_345.678, note: '  Zillow estimate ' }), {
            ...HOME, name: 'Lake house', value: 412_345.68, note: 'Zillow estimate',
        });
        assert.equal(netWorthItemSchema.parse({ ...HOME, note: '' }).note, null);
        assert.equal(netWorthItemSchema.parse({ ...HOME, note: '   ' }).note, null);
    });

    test('a debt is a balance owed: zero is fine, a negative amount is not', () => {
        assert.equal(netWorthItemSchema.parse({ ...MORTGAGE, value: 0 }).value, 0);
        assert.equal(refused({ ...MORTGAGE, value: -200_000 }), "Value can't be negative");
    });

    test('refuses a category of the other kind, naming the kind', () => {
        assert.equal(refused({ ...HOME, category: 'mortgage' }), 'Choose a kind of asset');
        assert.equal(refused({ ...MORTGAGE, category: 'vehicle' }), 'Choose a kind of debt');
        const issue = netWorthItemSchema.safeParse({ ...HOME, category: 'mortgage' });
        assert.ok(!issue.success);
        assert.deepEqual(issue.error.issues[0].path, ['category']);
    });

    test('refuses an unknown kind or category', () => {
        assert.equal(refused({ ...HOME, kind: 'liability' }), 'Choose asset or debt');
        assert.equal(refused({ ...HOME, kind: undefined }), 'Choose asset or debt');
        assert.equal(refused({ ...HOME, category: 'retirement_account' }), 'Choose what it is');
    });

    test('refuses a negative, non-finite, text or too-large value, each with its message', () => {
        assert.equal(refused({ ...HOME, value: -0.01 }), "Value can't be negative");
        assert.equal(refused({ ...HOME, value: Number.POSITIVE_INFINITY }), 'Value must be a number');
        assert.equal(refused({ ...HOME, value: Number.NaN }), 'Value must be a number');
        assert.equal(refused({ ...HOME, value: '300000' }), 'Value must be a number');
        assert.equal(refused({ ...HOME, value: undefined }), 'Value must be a number');
        assert.equal(refused({ ...HOME, value: NET_WORTH_ITEM_LIMITS.value + 1 }), 'Value is out of range');
        assert.equal(netWorthItemSchema.parse({ ...HOME, value: NET_WORTH_ITEM_LIMITS.value }).value, 1e12);
    });

    test('refuses an empty or too long name, and markup or a formula in it', () => {
        assert.equal(refused({ ...HOME, name: '   ' }), 'Name the asset or debt');
        assert.equal(netWorthItemSchema.parse({ ...HOME, name: 'x'.repeat(120) }).name.length, 120);
        assert.equal(refused({ ...HOME, name: 'x'.repeat(121) }), 'Name is too long');
        assert.equal(refused({ ...HOME, name: '<b>Home</b>' }), 'Input contains invalid characters (< or >)');
        assert.equal(refused({ ...HOME, name: '=HYPERLINK("x")' }), 'Input cannot start with =');
    });

    test('refuses a note longer than 500 characters', () => {
        assert.equal(netWorthItemSchema.parse({ ...HOME, note: 'n'.repeat(500) }).note?.length, 500);
        assert.equal(refused({ ...HOME, note: 'n'.repeat(501) }), 'Note is too long');
    });

    test('regression: refuses a NUL in the name or note, which Postgres can\'t store, so it never fails as a server error', () => {
        assert.equal(refused({ ...HOME, name: 'Sample\u0000home' }), 'Input contains an invalid character (a null character)');
        assert.equal(refused({ ...HOME, note: 'Sample\u0000note' }), 'Input contains an invalid character (a null character)');
        // Other control characters store fine, as they always have.
        assert.equal(refused({ ...HOME, note: 'Sample\u0001note' }), null);
    });

    test('refuses a date that isn\'t YYYY-MM-DD or isn\'t a real day; a future one is fine', () => {
        assert.equal(refused({ ...HOME, valueAsOf: '11/01/2026' }), 'Enter the date of the value (YYYY-MM-DD)');
        assert.equal(refused({ ...HOME, valueAsOf: '2026-02-30' }), 'Enter the date of the value (YYYY-MM-DD)');
        assert.equal(refused({ ...HOME, valueAsOf: undefined }), 'Enter the date of the value (YYYY-MM-DD)');
        assert.equal(netWorthItemSchema.parse({ ...HOME, valueAsOf: '2031-01-01' }).valueAsOf, '2031-01-01');
    });

    // Postgres has no year 0: a day in it would fail the save with a 500
    // (scripts/db/net-worth-items.test.ts stores the first and last days).
    test('refuses year 0000, which the ISO format has and Postgres doesn\'t; any day from 0001 to 9999 is fine', () => {
        assert.equal(refused({ ...HOME, valueAsOf: '0000-01-01' }), 'Enter the date of the value (YYYY-MM-DD)');
        assert.equal(refused({ ...HOME, valueAsOf: '0000-12-31' }), 'Enter the date of the value (YYYY-MM-DD)');
        assert.equal(refused({ ...HOME, valueAsOf: '0000-02-29' }), 'Enter the date of the value (YYYY-MM-DD)');
        assert.equal(netWorthItemSchema.parse({ ...HOME, valueAsOf: '0001-01-01' }).valueAsOf, '0001-01-01');
        assert.equal(netWorthItemSchema.parse({ ...HOME, valueAsOf: '9999-12-31' }).valueAsOf, '9999-12-31');
    });

    test('refuses fields the item doesn\'t have, such as another user\'s ID', () => {
        assert.match(refused({ ...HOME, userId: 'someone-else' }) ?? '', /userId/);
        assert.match(refused({ ...HOME, id: '00000000-0000-4000-8000-000000000701' }) ?? '', /\bid\b/);
    });

    test('the limits are the table\'s, and the largest item fits the body cap', () => {
        assert.deepEqual(NET_WORTH_ITEM_LIMITS, { name: 120, note: 500, value: 1e12 });
        const dialect = new PgDialect();
        const checks = new Map(getTableConfig(netWorthItems).checks.map((c) => [c.name, dialect.sqlToQuery(c.value).sql]));
        assert.match(checks.get('net_worth_items_name_check') ?? '', new RegExp(`between 1 and ${NET_WORTH_ITEM_LIMITS.name}$`));
        assert.match(checks.get('net_worth_items_note_check') ?? '', new RegExp(`between 1 and ${NET_WORTH_ITEM_LIMITS.note}$`));
        const largest = JSON.stringify({ ...HOME, name: 'x'.repeat(120), note: 'n'.repeat(500), value: 1e12 });
        assert.ok(Buffer.byteLength(largest) < MAX_NET_WORTH_ITEM_BODY_BYTES);
    });
});
