import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    calendarDaysBetween,
    computePeriodMetrics,
    computeRiskSnapshot,
    type MonthlyValuation,
} from './periodSummary.ts';

function monthly(values: readonly number[], startYear = 2025, startMonth = 0): MonthlyValuation[] {
    return values.map((value, i) => {
        const year = startYear + Math.floor((startMonth + i) / 12);
        const month = (startMonth + i) % 12;
        return { year, month, value };
    });
}

describe('calendarDaysBetween', () => {
    test('returns zero for same month/year', () => {
        assert.strictEqual(
            calendarDaysBetween({ year: 2026, month: 3, value: 0 }, { year: 2026, month: 3, value: 0 }),
            0,
        );
    });

    test('counts the span between first of each month', () => {
        // Jan 1 2026 -> Feb 1 2026 = 31 days.
        const days = calendarDaysBetween({ year: 2026, month: 0, value: 0 }, { year: 2026, month: 1, value: 0 });
        assert.strictEqual(days, 31);
    });
});

describe('computePeriodMetrics', () => {
    // 13 months of data: Jan 25 through Jan 26
    const portfolio = monthly([100, 102, 104, 103, 108, 112, 110, 115, 120, 118, 123, 130, 135]);
    const benchmark = monthly([100, 101, 102, 101, 104, 106, 105, 108, 111, 110, 114, 118, 122]);

    test('returns the expected set of periods', () => {
        const metrics = computePeriodMetrics(portfolio, benchmark);
        const keys = metrics.map((m) => m.period);
        assert.deepStrictEqual(keys, ['1M', '3M', '6M', 'YTD', '1Y', 'ALL']);
    });

    test('1M return matches last two observations', () => {
        const [oneMonth] = computePeriodMetrics(portfolio, benchmark, ['1M']);
        // 130 -> 135 = +3.846%
        assert.ok(Math.abs(oneMonth.return - (135 / 130 - 1)) < 1e-9);
    });

    test('ALL period spans the whole series', () => {
        const [all] = computePeriodMetrics(portfolio, benchmark, ['ALL']);
        assert.ok(Math.abs(all.return - 0.35) < 1e-9); // 100 -> 135
    });

    test('alpha = portfolio - benchmark', () => {
        const [one] = computePeriodMetrics(portfolio, benchmark, ['1M']);
        const expectedAlpha = one.return - one.benchmark;
        assert.ok(Math.abs(one.alpha - expectedAlpha) < 1e-12);
    });

    test('YTD slice starts at December of the prior year', () => {
        // asOf is Jan 26 (month=0). YTD should include Dec 25 and Jan 26 only.
        const [ytd] = computePeriodMetrics(portfolio, benchmark, ['YTD']);
        // 130 (Dec 25) -> 135 (Jan 26) = +3.846%
        assert.ok(Math.abs(ytd.return - (135 / 130 - 1)) < 1e-9);
    });

    test('returns zero metrics when series has <2 points', () => {
        const metrics = computePeriodMetrics(monthly([100]), monthly([100]), ['1M']);
        assert.strictEqual(metrics[0].return, 0);
        assert.strictEqual(metrics[0].sharpe, 0);
        assert.strictEqual(metrics[0].volatility, 0);
    });

    test('is order-independent (sorts inputs)', () => {
        const reversed = [...portfolio].reverse();
        const metrics = computePeriodMetrics(reversed, benchmark, ['ALL']);
        assert.ok(Math.abs(metrics[0].return - 0.35) < 1e-9);
    });
});

describe('computeRiskSnapshot', () => {
    const portfolio = monthly([100, 102, 99, 105, 108, 106, 112, 118, 115, 122, 128, 134, 140]);
    const benchmark = monthly([100, 101, 99, 102, 104, 103, 107, 110, 109, 113, 116, 119, 123]);

    test('volatility is non-negative', () => {
        const snapshot = computeRiskSnapshot(portfolio, benchmark);
        assert.ok(snapshot.volatility >= 0);
    });

    test('beta is positive when portfolio moves with benchmark', () => {
        const snapshot = computeRiskSnapshot(portfolio, benchmark);
        assert.ok(snapshot.beta > 0, `expected positive beta, got ${snapshot.beta}`);
    });

    test('value at risk is <= 0 (loss or zero)', () => {
        const snapshot = computeRiskSnapshot(portfolio, benchmark);
        assert.ok(snapshot.valueAtRisk95 <= 0);
    });

    test('returns zeros when insufficient data', () => {
        const snapshot = computeRiskSnapshot(monthly([100]), monthly([100]));
        assert.strictEqual(snapshot.volatility, 0);
        assert.strictEqual(snapshot.beta, 0);
        assert.strictEqual(snapshot.sortinoRatio, 0);
        assert.strictEqual(snapshot.valueAtRisk95, 0);
    });

    test('sortino is zero when there are no downside months', () => {
        const flatUp = monthly([100, 101, 102, 103, 104, 105]);
        const flatBench = monthly([100, 100.5, 101, 101.5, 102, 102.5]);
        const snapshot = computeRiskSnapshot(flatUp, flatBench);
        assert.strictEqual(snapshot.sortinoRatio, 0);
    });
});
