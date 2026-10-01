import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SEED_ORDERS } from './seed';
import { parseOrderPrefill, sortOrdersNewestFirst } from './blotter';

const params = (q: string) => new URLSearchParams(q);

describe('sortOrdersNewestFirst', () => {
    test('regression: seeded blotter renders in time order (was 08:48, 08:15, 08:56)', () => {
        const sorted = sortOrdersNewestFirst(SEED_ORDERS);
        for (let i = 1; i < sorted.length; i++) {
            assert.ok(new Date(sorted[i - 1].placedAt) >= new Date(sorted[i].placedAt));
        }
    });

    test('does not mutate the input and breaks ties by id', () => {
        const t = new Date('2026-01-01T10:00:00Z');
        const input = [{ id: 'a', placedAt: t }, { id: 'b', placedAt: t }, { id: 'c', placedAt: new Date('2026-01-01T11:00:00Z') }];
        const copy = [...input];
        assert.deepStrictEqual(sortOrdersNewestFirst(input).map((o) => o.id), ['c', 'b', 'a']);
        assert.deepStrictEqual(input, copy);
    });
});

describe('parseOrderPrefill', () => {
    test('reads a valid symbol (uppercased) and side', () => {
        assert.deepStrictEqual(parseOrderPrefill(params('symbol=nvda&side=Sell')), { ticker: 'NVDA', side: 'sell' });
        assert.deepStrictEqual(parseOrderPrefill(params('symbol=BRK.B')), { ticker: 'BRK.B' });
    });

    test('ignores invalid symbols and sides', () => {
        assert.deepStrictEqual(parseOrderPrefill(params('symbol=<script>&side=short')), {});
        assert.deepStrictEqual(parseOrderPrefill(params('')), {});
    });
});
