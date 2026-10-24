import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { recordIdSchema, writeOrderSchema } from './research-ids';

describe('recordIdSchema', () => {
    test('UUIDs and example ids, up to 64 characters', () => {
        for (const id of ['6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', 'w-coin', 'w-brk.b-1', 'seed-journal-1', 'a'.repeat(64)]) {
            assert.equal(recordIdSchema.safeParse(id).success, true, id);
        }
    });

    test('nothing else', () => {
        for (const id of ['', 'a'.repeat(65), 'W-COIN', '-coin', '.coin', 'w/coin', 'w coin']) {
            assert.equal(recordIdSchema.safeParse(id).error?.issues[0]?.message, 'id must be lowercase letters, digits, dots and hyphens', id);
        }
    });
});

describe('writeOrderSchema', () => {
    const order = { session: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', seq: 1 };
    const message = (o: unknown) => writeOrderSchema.safeParse(o).error?.issues[0]?.message;

    test('a page ID and a whole number from 1', () => {
        assert.equal(writeOrderSchema.safeParse(order).success, true);
        assert.equal(writeOrderSchema.safeParse({ ...order, session: 'abcd1234' }).success, true);
        assert.equal(writeOrderSchema.safeParse({ ...order, seq: Number.MAX_SAFE_INTEGER }).success, true);
    });

    test('refuses other sessions and counts', () => {
        assert.equal(message({ ...order, session: 'short' }), 'session must be a page ID');
        assert.equal(message({ ...order, session: 'NOT-LOWER-CASE' }), 'session must be a page ID');
        assert.equal(message({ ...order, session: 'a'.repeat(65) }), 'session must be a page ID');
        assert.equal(message({ ...order, seq: 0 }), 'seq must be at least 1');
        assert.equal(message({ ...order, seq: 1.5 }), 'seq must be a whole number');
        assert.equal(writeOrderSchema.safeParse({ ...order, seq: Number.MAX_SAFE_INTEGER + 2 }).success, false);
        assert.equal(writeOrderSchema.safeParse({ ...order, extra: 1 }).success, false);
    });
});
