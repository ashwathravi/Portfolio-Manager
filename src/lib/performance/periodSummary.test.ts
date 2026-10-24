import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    DAILY,
    calendarDaysBetween,
    computePeriodMetrics,
    computeRiskSnapshot,
    measuresRisk,
    minusMonths,
    monthlyReturns,
    periodStartTarget,
    sliceForPeriod,
    type DatedValue,
} from './periodSummary.ts';

/** Month-end observations starting at `startMonth` (0 = Jan) of `startYear`. */
function monthly(values: readonly number[], startYear = 2025, startMonth = 0): DatedValue[] {
    return values.map((value, i) => {
        const year = startYear + Math.floor((startMonth + i) / 12);
        const month = (startMonth + i) % 12;
        const day = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        return { date: `${year}-${String(month + 1).padStart(2, '0')}-${day}`, value };
    });
}

describe('calendarDaysBetween', () => {
    test('returns zero for the same date', () => {
        assert.strictEqual(calendarDaysBetween({ date: '2026-04-30', value: 0 }, { date: '2026-04-30', value: 0 }), 0);
    });

    test('counts calendar days', () => {
        assert.strictEqual(calendarDaysBetween({ date: '2026-01-31', value: 0 }, { date: '2026-02-28', value: 0 }), 28);
        assert.strictEqual(calendarDaysBetween({ date: '2026-10-16', value: 0 }, { date: '2026-10-19', value: 0 }), 3);
    });
});

describe('period start dates', () => {
    test('a month end maps to the earlier month end; other days are clamped', () => {
        assert.strictEqual(minusMonths('2026-09-30', 1), '2026-08-31');
        assert.strictEqual(minusMonths('2026-03-31', 1), '2026-02-28');
        assert.strictEqual(minusMonths('2026-03-30', 1), '2026-02-28');
        assert.strictEqual(minusMonths('2026-10-22', 1), '2026-09-22');
        assert.strictEqual(minusMonths('2026-01-15', 3), '2025-10-15');
        assert.strictEqual(minusMonths('2026-02-28', 12), '2025-02-28');
        assert.strictEqual(minusMonths('2024-02-29', 12), '2023-02-28');
    });

    test('YTD starts at the prior year end; ALL has no start', () => {
        assert.strictEqual(periodStartTarget('2026-10-22', 'YTD'), '2025-12-31');
        assert.strictEqual(periodStartTarget('2026-10-22', '3Y'), '2023-10-22');
        assert.strictEqual(periodStartTarget('2026-10-22', 'ALL'), null);
    });

    test('a daily series is measured from the last session on or before the start', () => {
        const daily: DatedValue[] = [
            { date: '2026-09-18', value: 100 }, // Fri
            { date: '2026-09-21', value: 101 }, // Mon
            { date: '2026-10-21', value: 105 },
            { date: '2026-10-22', value: 106 },
        ];
        // 1M back from Thu Oct 22 is Tue Sep 22: the last session on or before it is Sep 21.
        const { points, covered } = sliceForPeriod(daily, '1M');
        assert.strictEqual(covered, true);
        assert.strictEqual(points[0].date, '2026-09-21');
    });

    test('a series shorter than the period comes back whole, not covered', () => {
        const short = monthly([100, 110, 120], 2026, 6);
        assert.deepStrictEqual(sliceForPeriod(short, '6M'), { points: short, covered: false });
        assert.deepStrictEqual(sliceForPeriod(short, 'ALL'), { points: short, covered: true });
        assert.strictEqual(sliceForPeriod(short.slice(0, 1), 'ALL').covered, false);
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
        assert.ok(one.alpha !== null && one.benchmark !== null);
        assert.ok(Math.abs(one.alpha - (one.return - one.benchmark)) < 1e-12);
    });

    test('YTD slice starts at December of the prior year', () => {
        // asOf is Jan 26 (month=0). YTD should include Dec 25 and Jan 26 only.
        const [ytd] = computePeriodMetrics(portfolio, benchmark, ['YTD']);
        // 130 (Dec 25) -> 135 (Jan 26) = +3.846%
        assert.ok(Math.abs(ytd.return - (135 / 130 - 1)) < 1e-9);
    });

    test('periods longer than the series are flagged and cover the whole series', () => {
        const short = monthly([100, 105, 110], 2025, 10); // Nov 25 – Jan 26
        const [sixMonths] = computePeriodMetrics(short, short, ['6M']);
        assert.strictEqual(sixMonths.covered, false);
        assert.strictEqual(sixMonths.start, '2025-11-30');
        assert.ok(Math.abs(sixMonths.return - 0.1) < 1e-9);
        const [oneMonth] = computePeriodMetrics(short, short, ['1M']);
        assert.strictEqual(oneMonth.covered, true);
    });

    test('the benchmark is measured over the same dates, or null without them', () => {
        const [all] = computePeriodMetrics(portfolio, benchmark.slice(1), ['ALL']);
        assert.strictEqual(all.benchmark, null);
        assert.strictEqual(all.alpha, null);
        const [oneMonth] = computePeriodMetrics(portfolio, benchmark.slice(1), ['1M']);
        assert.ok(oneMonth.benchmark !== null && Math.abs(oneMonth.benchmark - (122 / 118 - 1)) < 1e-9);
    });

    test('daily series annualize with 252 sessions', () => {
        const daily: DatedValue[] = [
            { date: '2026-09-21', value: 100 },
            { date: '2026-10-20', value: 101 },
            { date: '2026-10-21', value: 100 },
            { date: '2026-10-22', value: 102 },
        ];
        const [monthlyScale] = computePeriodMetrics(daily, daily, ['ALL']);
        const [dailyScale] = computePeriodMetrics(daily, daily, ['ALL'], { periodsPerYear: DAILY });
        assert.ok(monthlyScale.volatility !== null && dailyScale.volatility !== null);
        assert.ok(Math.abs(dailyScale.volatility / monthlyScale.volatility - Math.sqrt(252 / 12)) < 1e-9);
    });

    test('regression: risk needs three returns over four weeks, not a Sharpe of 123 from two days', () => {
        const days: DatedValue[] = [
            { date: '2026-10-20', value: 100 },
            { date: '2026-10-21', value: 104.1 },
            { date: '2026-10-22', value: 109.3 },
        ];
        const [all] = computePeriodMetrics(days, days, ['ALL'], { periodsPerYear: DAILY });
        assert.strictEqual(all.volatility, null);
        assert.strictEqual(all.sharpe, null);
        assert.ok(Math.abs(all.return - 0.093) < 1e-9);
        assert.strictEqual(measuresRisk(days), false);
        // Three returns, but over two days.
        assert.strictEqual(measuresRisk([...days, { date: '2026-10-23', value: 110 }]), false);
        assert.strictEqual(measuresRisk(monthly([100, 101, 102, 103])), true);
        assert.strictEqual(measuresRisk(monthly([100, 101])), false);
    });

    test('returns zero metrics when series has <2 points', () => {
        const metrics = computePeriodMetrics(monthly([100]), monthly([100]), ['1M']);
        assert.strictEqual(metrics[0].return, 0);
        assert.strictEqual(metrics[0].sharpe, null);
        assert.strictEqual(metrics[0].volatility, null);
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

    test('regression: Sortino uses downside deviation over all months, not the spread of losing months', () => {
        // Monthly returns: +10%, -1%, +10%, -1.1% (two near-identical losses).
        const values = [100, 110, 108.9, 119.79, 118.47231];
        const snapshot = computeRiskSnapshot(monthly(values), monthly(values));
        // Target semideviation: sqrt((0.01^2 + 0.011^2) / 4) ≈ 0.007433 → ×√12 ≈ 0.025749.
        // Mean monthly return ≈ 0.04475 → ×12 ≈ 0.537. Sortino ≈ 20.9.
        // The old formula (stddev of the two losses ≈ 0.000707) gave ≈ 219.
        assert.ok(snapshot.sortinoRatio > 15 && snapshot.sortinoRatio < 25, `got ${snapshot.sortinoRatio}`);
    });

    test('a single losing month still produces a finite Sortino', () => {
        const values = [100, 102, 101, 103, 105];
        const snapshot = computeRiskSnapshot(monthly(values), monthly(values));
        assert.ok(Number.isFinite(snapshot.sortinoRatio) && snapshot.sortinoRatio > 0);
    });
});

describe('monthlyReturns', () => {
    test('month ends: one return per month after the first', () => {
        const returns = monthlyReturns(monthly([100, 110, 99], 2025, 10));
        assert.deepStrictEqual(returns.map((r) => [r.year, r.month, r.from]), [[2025, 11, undefined], [2026, 0, undefined]]);
        assert.ok(Math.abs(returns[0].return - 0.1) < 1e-12);
        assert.ok(Math.abs(returns[1].return + 0.1) < 1e-12);
    });

    test('daily closes: each month from the last close of the month before; a mid-month start is partial', () => {
        const returns = monthlyReturns([
            { date: '2026-09-14', value: 100 },
            { date: '2026-09-30', value: 105 },
            { date: '2026-10-01', value: 104 },
            { date: '2026-10-22', value: 110.25 },
        ]);
        assert.deepStrictEqual(returns.map((r) => [r.month, r.from]), [[8, '2026-09-14'], [9, undefined]]);
        assert.ok(Math.abs(returns[0].return - 0.05) < 1e-12);
        assert.ok(Math.abs(returns[1].return - 0.05) < 1e-12);
    });

    test('fewer than two observations have no months', () => {
        assert.deepStrictEqual(monthlyReturns([{ date: '2026-10-22', value: 100 }]), []);
    });
});
