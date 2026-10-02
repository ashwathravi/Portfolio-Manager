import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    buildYearCalendar,
    calendarScale,
    dailyTotals,
    intensity,
    summarizeCalendar,
    yearsWithTrades,
} from './dailyPnl';

const trade = (closedAt: string, realizedPnlUsd: number) => ({ closedAt, realizedPnlUsd });

describe('dailyPnl', () => {
    test('dailyTotals groups trades by UTC close date and skips bad dates', () => {
        const totals = dailyTotals([
            trade('2026-02-06T15:00:00Z', 120.5),
            trade('2026-02-06T20:30:00Z', -20.25),
            trade('2026-02-07T01:00:00Z', 10),
            trade('not a date', 999),
        ]);
        assert.deepStrictEqual(totals.get('2026-02-06'), { pnl: 100.25, trades: 2 });
        assert.deepStrictEqual(totals.get('2026-02-07'), { pnl: 10, trades: 1 });
        assert.strictEqual(totals.size, 2);
    });

    test('buildYearCalendar produces full Sunday-first weeks covering the year', () => {
        const weeks = buildYearCalendar([], 2026);
        // 2026-01-01 is a Thursday → 4 padding days, 365 days → 53 columns.
        assert.strictEqual(weeks.length, 53);
        for (const week of weeks) assert.strictEqual(week.length, 7);
        assert.strictEqual(weeks[0][4].date, '2026-01-01');
        assert.strictEqual(weeks[0][4].inYear, true);
        assert.strictEqual(weeks[0][3].inYear, false);
        const inYear = weeks.flat().filter((c) => c.inYear).length;
        assert.strictEqual(inYear, 365);
    });

    test('buildYearCalendar places trades on their day and ignores other years', () => {
        const weeks = buildYearCalendar([trade('2026-03-02T14:00:00Z', 50), trade('2025-03-02T14:00:00Z', 70)], 2026);
        const cell = weeks.flat().find((c) => c.date === '2026-03-02');
        assert.deepStrictEqual({ pnl: cell?.pnl, trades: cell?.trades, weekday: cell?.weekday }, { pnl: 50, trades: 1, weekday: 1 });
        assert.strictEqual(weeks.flat().filter((c) => c.trades > 0).length, 1);
    });

    test('summarizeCalendar totals trading days, win rate, best and worst', () => {
        const weeks = buildYearCalendar([
            trade('2026-01-14T15:00:00Z', 540),
            trade('2026-01-21T15:00:00Z', -120),
            trade('2026-01-28T15:00:00Z', 875),
            trade('2026-01-28T16:00:00Z', 25),
        ], 2026);
        const s = summarizeCalendar(weeks);
        assert.strictEqual(s.totalPnl, 1320);
        assert.strictEqual(s.trades, 4);
        assert.strictEqual(s.tradingDays, 3);
        assert.strictEqual(s.winRatePct, 66.7);
        assert.strictEqual(s.bestDay?.date, '2026-01-28');
        assert.strictEqual(s.bestDay?.pnl, 900);
        assert.strictEqual(s.worstDay?.date, '2026-01-21');
    });

    test('regression: no losing day means no "Worst day $0.00"', () => {
        const s = summarizeCalendar(buildYearCalendar([trade('2026-02-06T15:00:00Z', 10)], 2026));
        assert.strictEqual(s.worstDay, null);
    });

    test('summarizeCalendar on an empty year has null win rate and no best day', () => {
        const s = summarizeCalendar(buildYearCalendar([], 2026));
        assert.deepStrictEqual(s, { totalPnl: 0, trades: 0, tradingDays: 0, winRatePct: null, bestDay: null, worstDay: null });
    });

    test('intensity buckets by size and sign', () => {
        assert.strictEqual(intensity(0, 0, 100), 0);
        assert.strictEqual(intensity(10, 1, 100), 1);
        assert.strictEqual(intensity(50, 1, 100), 2);
        assert.strictEqual(intensity(100, 1, 100), 3);
        assert.strictEqual(intensity(-80, 1, 100), -3);
        assert.strictEqual(intensity(5, 1, 0), 0);
    });

    test('calendarScale is the largest absolute in-year day', () => {
        const weeks = buildYearCalendar([trade('2026-05-01T12:00:00Z', -300), trade('2026-05-04T12:00:00Z', 200)], 2026);
        assert.strictEqual(calendarScale(weeks), 300);
    });

    test('yearsWithTrades lists distinct years newest first', () => {
        assert.deepStrictEqual(
            yearsWithTrades([trade('2025-12-31T23:00:00Z', 1), trade('2026-01-01T01:00:00Z', 1), trade('2026-06-01T01:00:00Z', 1)]),
            [2026, 2025],
        );
    });
});
