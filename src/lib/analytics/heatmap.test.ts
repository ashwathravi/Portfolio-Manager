import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildHeatmap, colorFor, HEAT_COLORS, totalTrades } from './heatmap';
import type { JournalEntry } from '@/types/trade';

describe('colorFor', () => {
    test('maps the avg/scale ratio onto the five theme stops', () => {
        assert.strictEqual(colorFor(70, 100), HEAT_COLORS.pos2);
        assert.strictEqual(colorFor(30, 100), HEAT_COLORS.pos1);
        assert.strictEqual(colorFor(10, 100), HEAT_COLORS.zero);
        assert.strictEqual(colorFor(-10, 100), HEAT_COLORS.zero);
        assert.strictEqual(colorFor(-30, 100), HEAT_COLORS.neg1);
        assert.strictEqual(colorFor(-70, 100), HEAT_COLORS.neg2);
    });

    test('boundaries fall to the milder stop', () => {
        assert.strictEqual(colorFor(60, 100), HEAT_COLORS.pos1);
        assert.strictEqual(colorFor(20, 100), HEAT_COLORS.zero);
        assert.strictEqual(colorFor(-20, 100), HEAT_COLORS.neg1);
        assert.strictEqual(colorFor(-60, 100), HEAT_COLORS.neg2);
    });

    test('zero scale or zero P&L is neutral', () => {
        assert.strictEqual(colorFor(50, 0), HEAT_COLORS.zero);
        assert.strictEqual(colorFor(0, 100), HEAT_COLORS.zero);
    });

    test('every stop is a theme token, never a literal colour', () => {
        for (const c of Object.values(HEAT_COLORS)) assert.match(c, /^var\(--pm-heat-/);
    });
});

describe('buildHeatmap', () => {
    const trade = (patch: Partial<JournalEntry>): JournalEntry => ({
        id: 't',
        ticker: 'AAPL',
        side: 'buy',
        quantity: 1,
        entryPrice: 100,
        exitPrice: 110,
        notionalUsd: 100,
        realizedPnlUsd: 10,
        holdingPeriodDays: 1,
        openedAt: '2026-10-05T12:00:00.000Z',
        closedAt: '2026-10-06T15:00:00.000Z',
        ...patch,
    });

    test('bins a timed trade by weekday and hour', () => {
        const cells = buildHeatmap([trade({})], null);
        assert.strictEqual(totalTrades(cells), 1);
    });

    test('leaves out trades with only a date: their hour means nothing (launch item i51)', () => {
        const cells = buildHeatmap([trade({ dateOnly: true }), trade({ id: 'u', dateOnly: true })], null);
        assert.strictEqual(cells.length, 144);
        assert.strictEqual(totalTrades(cells), 0);
    });
});
