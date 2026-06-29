import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { SEED_ORDER_BASE_TIME_MS, SEED_ORDERS } from './seed';

describe('execution seed orders', () => {
    test('uses deterministic timestamps so SSR and hydration agree', () => {
        const firstOrder = SEED_ORDERS.find((order) => order.id === 'o-1001');
        const lastOrder = SEED_ORDERS.find((order) => order.id === 'o-1006');

        assert.equal(
            firstOrder?.placedAt.toISOString(),
            new Date(SEED_ORDER_BASE_TIME_MS - 12 * 60 * 1000).toISOString(),
        );
        assert.equal(
            lastOrder?.placedAt.toISOString(),
            new Date(SEED_ORDER_BASE_TIME_MS - 330 * 60 * 1000).toISOString(),
        );
    });
});
