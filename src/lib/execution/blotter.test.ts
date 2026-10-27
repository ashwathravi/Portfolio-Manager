import { test, describe } from 'node:test';
import assert from 'node:assert';
import { formatPlanTime, parseOrderPrefill, sortOrdersNewestFirst } from './blotter';

const params = (q: string) => new URLSearchParams(q);

describe('sortOrdersNewestFirst', () => {
    test('regression: the blotter renders in time order (was 08:48, 08:15, 08:56)', () => {
        const input = [
            { id: 'a', createdAt: '2026-10-27T12:48:00.000Z' },
            { id: 'b', createdAt: '2026-10-27T12:15:00.000Z' },
            { id: 'c', createdAt: '2026-10-27T12:56:00.000Z' },
        ];
        assert.deepStrictEqual(sortOrdersNewestFirst(input).map((o) => o.id), ['c', 'a', 'b']);
    });

    test('does not mutate the input and breaks ties by id', () => {
        const t = new Date('2026-01-01T10:00:00Z');
        const input = [{ id: 'a', createdAt: t }, { id: 'b', createdAt: t }, { id: 'c', createdAt: new Date('2026-01-01T11:00:00Z') }];
        const copy = [...input];
        assert.deepStrictEqual(sortOrdersNewestFirst(input).map((o) => o.id), ['c', 'b', 'a']);
        assert.deepStrictEqual(input, copy);
    });
});

describe('formatPlanTime', () => {
    test("today's plans show the time in market time, ET", () => {
        assert.strictEqual(formatPlanTime('2026-10-27T13:05:00.000Z', '2026-10-27'), '09:05');
        // 9 PM ET is still the same Eastern day, though UTC has moved on.
        assert.strictEqual(formatPlanTime('2026-10-28T01:00:00.000Z', '2026-10-27'), '21:00');
    });

    test("earlier plans show the date, with the year when it isn't this one", () => {
        assert.strictEqual(formatPlanTime('2026-10-24T14:00:00.000Z', '2026-10-27'), 'Oct 24');
        assert.strictEqual(formatPlanTime('2025-12-31T15:00:00.000Z', '2026-10-27'), 'Dec 31, 2025');
        assert.strictEqual(formatPlanTime('not a time', '2026-10-27'), '—');
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
