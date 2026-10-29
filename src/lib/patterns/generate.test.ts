import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PATTERN_WINDOW_DAYS, inPatternWindow } from './generate';

test('inPatternWindow - keeps the trades closed in the last 90 days (launch item i51)', () => {
    const now = new Date('2026-10-29T15:00:00.000Z');
    const closed = (id: string, closedAt: string) => ({ id, closedAt });
    const trades = [
        closed('today', '2026-10-29T12:00:00.000Z'),
        closed('edge', '2026-07-31T15:00:00.000Z'),
        closed('older', '2026-07-31T12:00:00.000Z'),
        closed('last-year', '2025-10-29T12:00:00.000Z'),
        closed('unreadable', 'not a date'),
    ];
    assert.equal(PATTERN_WINDOW_DAYS, 90);
    assert.deepEqual(inPatternWindow(trades, now).map((t) => t.id), ['today', 'edge']);
    assert.deepEqual(inPatternWindow([], now), []);
});
