import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    simpleReturn,
    periodReturn,
    chainLinkedReturn,
    twr,
    annualizedReturn,
    excessReturn,
    maxDrawdown,
    standardDeviation,
    volatility,
    sharpeRatio,
    dailyReturns,
    summarize,
    TRADING_DAYS_PER_YEAR,
} from './calculations.ts';

const EPS = 1e-9;

function approx(a: number, b: number, tol = 1e-9, msg?: string) {
    assert.ok(Math.abs(a - b) < tol, msg ?? `expected ${a} ≈ ${b} (tol ${tol})`);
}

describe('simpleReturn', () => {
    test('computes (end-start)/start', () => {
        approx(simpleReturn(100, 110), 0.1);
        approx(simpleReturn(100, 90), -0.1);
    });

    test('returns 0 when start is 0 or non-finite', () => {
        assert.strictEqual(simpleReturn(0, 100), 0);
        assert.strictEqual(simpleReturn(Number.NaN, 100), 0);
    });
});

describe('periodReturn', () => {
    test('backs out end-of-period contributions', () => {
        // start 100, end 115, but 10 came from a deposit -> 5% investment return
        approx(periodReturn(100, 115, 10), 0.05);
    });

    test('ignores cash flow when none is provided', () => {
        approx(periodReturn(100, 110), 0.1);
    });

    test('handles withdrawals (negative cash flow in)', () => {
        // start 100, end 95, -10 withdrawn (so before withdrawal the portfolio was 105) -> 5%
        approx(periodReturn(100, 95, -10), 0.05);
    });
});

describe('chainLinkedReturn', () => {
    test('empty series returns 0', () => {
        assert.strictEqual(chainLinkedReturn([]), 0);
    });

    test('single return passes through', () => {
        approx(chainLinkedReturn([0.1]), 0.1);
    });

    test('chains multiple subperiods geometrically', () => {
        // (1.1 * 0.9) - 1 = -0.01
        approx(chainLinkedReturn([0.1, -0.1]), -0.01, 1e-12);
    });
});

describe('twr', () => {
    test('ignores cash flows so adding money mid-period does not inflate the return', () => {
        const points = [
            { value: 100 },
            { value: 110 },              // +10% investment return
            { value: 220, cashFlowIn: 100 }, // added 100, so investment return is 10/110 ≈ 9.09%
        ];
        // TWR = (1.1 * (1 + 10/110)) - 1 = 1.2 - 1 = 0.2
        approx(twr(points), 0.2, 1e-12);
    });

    test('matches simple chain-link when no cash flows', () => {
        const points = [{ value: 100 }, { value: 110 }, { value: 121 }];
        approx(twr(points), 0.21, 1e-12);
    });

    test('returns 0 for <2 points', () => {
        assert.strictEqual(twr([]), 0);
        assert.strictEqual(twr([{ value: 100 }]), 0);
    });
});

describe('annualizedReturn', () => {
    test('returns input when days <= 0', () => {
        assert.strictEqual(annualizedReturn(0.1, 0), 0.1);
        assert.strictEqual(annualizedReturn(0.1, -5), 0.1);
    });

    test('annualizes a half-year return', () => {
        // (1.1)^(365/182.5) - 1 ≈ 0.21
        const result = annualizedReturn(0.1, 365 / 2);
        approx(result, Math.pow(1.1, 2) - 1, 1e-9);
    });

    test('passes through a 1-year return unchanged', () => {
        approx(annualizedReturn(0.15, 365), 0.15, 1e-9);
    });
});

describe('excessReturn', () => {
    test('subtracts benchmark from portfolio', () => {
        approx(excessReturn(0.1, 0.07), 0.03);
        approx(excessReturn(-0.05, 0.02), -0.07);
    });
});

describe('maxDrawdown', () => {
    test('zero for monotonically increasing series', () => {
        assert.strictEqual(maxDrawdown([100, 110, 120, 130]), 0);
    });

    test('captures the largest peak-to-trough decline', () => {
        // peak 120, trough 80 -> -33.33%
        approx(maxDrawdown([100, 120, 100, 80, 110]), -1 / 3, 1e-12);
    });

    test('empty series returns 0', () => {
        assert.strictEqual(maxDrawdown([]), 0);
    });
});

describe('standardDeviation', () => {
    test('matches sample stddev for a known series', () => {
        // series [1,2,3,4,5], sample stddev = sqrt(2.5) ≈ 1.5811
        approx(standardDeviation([1, 2, 3, 4, 5]), Math.sqrt(2.5), 1e-12);
    });

    test('returns 0 for fewer than 2 elements', () => {
        assert.strictEqual(standardDeviation([]), 0);
        assert.strictEqual(standardDeviation([5]), 0);
    });
});

describe('volatility', () => {
    test('annualizes by sqrt(periodsPerYear)', () => {
        const daily = [0.01, -0.01, 0.02, -0.02];
        const stddev = standardDeviation(daily);
        approx(volatility(daily, TRADING_DAYS_PER_YEAR), stddev * Math.sqrt(TRADING_DAYS_PER_YEAR), EPS);
    });
});

describe('sharpeRatio', () => {
    test('returns 0 when volatility is 0', () => {
        assert.strictEqual(sharpeRatio([0.01, 0.01, 0.01]), 0);
    });

    test('returns 0 for <2 returns', () => {
        assert.strictEqual(sharpeRatio([0.01]), 0);
    });

    test('is positive when annualized mean return exceeds the risk-free rate', () => {
        const result = sharpeRatio([0.01, 0.02, 0.015, 0.005], 0.02);
        assert.ok(result > 0, `expected positive sharpe, got ${result}`);
    });

    test('flips sign when returns fall below the risk-free rate', () => {
        const result = sharpeRatio([-0.01, -0.02, -0.015], 0.02);
        assert.ok(result < 0, `expected negative sharpe, got ${result}`);
    });
});

describe('dailyReturns', () => {
    test('empty / single-element input produces empty output', () => {
        assert.deepStrictEqual(dailyReturns([]), []);
        assert.deepStrictEqual(dailyReturns([100]), []);
    });

    test('produces n-1 returns from n values', () => {
        const returns = dailyReturns([100, 110, 121]);
        assert.strictEqual(returns.length, 2);
        approx(returns[0], 0.1);
        approx(returns[1], 0.1);
    });
});

describe('summarize', () => {
    test('returns zeros for insufficient data', () => {
        const s = summarize([100]);
        assert.strictEqual(s.totalReturn, 0);
        assert.strictEqual(s.annualizedReturn, 0);
        assert.strictEqual(s.maxDrawdown, 0);
        assert.strictEqual(s.volatility, 0);
        assert.strictEqual(s.sharpeRatio, 0);
    });

    test('reports total and max drawdown consistent with helpers', () => {
        const values = [100, 110, 105, 120];
        const s = summarize(values);
        approx(s.totalReturn, 0.2, 1e-12);
        approx(s.maxDrawdown, -0.0454545454545, 1e-9);
        assert.ok(s.volatility >= 0);
    });

    test('accepts a days override for annualization', () => {
        const values = [100, 110];
        // 10% return over 365/2 days should annualize to ~21%
        const s = summarize(values, { days: 365 / 2 });
        approx(s.annualizedReturn, Math.pow(1.1, 2) - 1, 1e-9);
    });
});
