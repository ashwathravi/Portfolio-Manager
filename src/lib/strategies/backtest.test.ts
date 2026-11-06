import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { compileRules, judge, runBacktest, warmupSessions, type BacktestBar } from './backtest';
import type { BacktestStats, StrategyDefinition, StrategyRule } from './strategy';

/** Weekday sessions from 2026-01-05 (a Monday). */
function sessions(n: number): string[] {
    const out: string[] = [];
    const d = new Date('2026-01-05T00:00:00Z');
    while (out.length < n) {
        if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
}

/** Bars from [open, low, close] triples; high is the larger of open and close. */
function bars(rows: [open: number, low: number, close: number][], dates = sessions(rows.length)): BacktestBar[] {
    return rows.map(([open, low, close], i) => ({ date: dates[i], open, high: Math.max(open, close), low, close, volume: 1000 }));
}

const flat = (closes: number[]) => bars(closes.map((c) => [c, c, c]));

const rule = (field: string, op: StrategyRule['op'], value: string, id = field): StrategyRule => ({ id, field, op, value });

function definition(overrides: Partial<StrategyDefinition> = {}): StrategyDefinition {
    return {
        rules: [rule('Close', '>', '100')],
        conjunctions: [],
        symbols: ['AAA'],
        guardrails: { maxPositionPct: 0.5, stopLossPct: 0.5, rebalanceDays: 1 },
        ...overrides,
    };
}

function run(def: StrategyDefinition, data: Record<string, BacktestBar[]>, benchmark?: BacktestBar[]) {
    const outcome = runBacktest(def, data, { benchmark });
    assert.ok(outcome.ok, outcome.ok ? '' : outcome.message);
    return outcome;
}

describe('runBacktest', () => {
    test('signals at the close trade at the next open, sized by max position, marked at each close', () => {
        // Day 2 closes above 100: buy at day 3's open (110) with half of $100k.
        // Day 4 closes at 100 (not above): sell at day 5's open (100).
        const { backtest, trades } = run(definition(), {
            AAA: bars([[90, 90, 90], [110, 110, 110], [110, 110, 121], [121, 100, 100], [100, 100, 100]]),
        });
        const quantity = 50_000 / 110;
        assert.deepEqual(trades, [{
            symbol: 'AAA', entryDate: '2026-01-07', entryPrice: 110, exitDate: '2026-01-09', exitPrice: 100,
            quantity, pnl: -10 * quantity, exitReason: 'rules',
        }]);
        assert.deepEqual(backtest.equityCurve, [100, 100, 105, 95.4545, 95.4545]);
        assert.equal(backtest.from, '2026-01-05');
        assert.equal(backtest.to, '2026-01-09');
        assert.equal(backtest.stats.tradeCount, 1);
        assert.equal(backtest.stats.winRatePct, 0);
        assert.equal(backtest.stats.profitFactor, 0);
        assert.equal(backtest.stats.totalReturnPct, -4.55);
        assert.equal(backtest.stats.netProfitUsd, -4545.45);
        assert.equal(backtest.stats.maxDrawdownPct, -9.09);
        // Under a year: no CAGR. Under 20 returns: no Sharpe, Sortino or Monte Carlo.
        assert.equal(backtest.stats.cagrPct, null);
        assert.equal(backtest.stats.sharpe, null);
        assert.equal(backtest.monteCarlo, null);
        assert.equal(backtest.verdict, 'Unproven');
    });

    test('a stop exits at the stop price, or at the open when the session opens below it', () => {
        const always = definition({ rules: [rule('Close', '>', '0')], guardrails: { maxPositionPct: 1, stopLossPct: 0.1, rebalanceDays: 1 } });
        // Bought at 100 on day 2; day 3 opens at 85, under the 90 stop.
        const gap = run(always, { AAA: bars([[100, 100, 100], [100, 95, 100], [85, 80, 88], [88, 88, 88]]) });
        assert.deepEqual(gap.trades.map((t) => [t.exitDate, t.exitPrice, t.exitReason]), [['2026-01-07', 85, 'stop']]);
        // Day 3 trades down through 90 after opening above it.
        const through = run(always, { AAA: bars([[100, 100, 100], [100, 95, 100], [99, 80, 88], [88, 88, 88]]) });
        assert.equal(through.trades[0].exitPrice, 90);
    });

    test('the rules are only read on check days, rebalanceDays apart', () => {
        // Above 100 from day 2 (Tue), but a weekly check after day 1 (Mon) next reads them on day 6 (Mon).
        const closes = [90, 110, 120, 130, 140, 150, 160, 170];
        const weekly = run(definition({ guardrails: { maxPositionPct: 0.5, stopLossPct: 0.5, rebalanceDays: 7 } }), { AAA: flat(closes) });
        assert.deepEqual(weekly.backtest.equityCurve.slice(0, 7), [100, 100, 100, 100, 100, 100, 100]);
        assert.ok(weekly.backtest.equityCurve[7] > 100, 'bought at day 7 open');
        const daily = run(definition(), { AAA: flat(closes) });
        assert.ok(daily.backtest.equityCurve[3] > 100, 'bought at day 3 open');
    });

    test('AND binds tighter than OR', () => {
        const yes = rule('Close', '>', '0', 'yes');
        const no = rule('Close', '>', '1000', 'no');
        const closes = flat([100, 100, 120]);
        const bought = (rules: StrategyRule[], conjunctions: StrategyDefinition['conjunctions']) =>
            run(definition({ rules, conjunctions }), { AAA: closes }).backtest.equityCurve.at(-1)! !== 100;
        assert.equal(bought([no, yes, yes], ['AND', 'OR']), true); // (no AND yes) OR yes
        assert.equal(bought([yes, no, no], ['OR', 'AND']), true); // yes OR (no AND no)
        assert.equal(bought([no, yes, no], ['OR', 'AND']), false); // no OR (yes AND no)
    });

    test('crossing rules need the session before; the window starts once every rule has history', () => {
        const def = definition({ rules: [rule('Close', 'crosses above', 'SMA(3)')] });
        const compiled = compileRules(def);
        assert.ok(compiled.ok);
        assert.equal(warmupSessions(compiled.rules), 3);
        // Day 5 closes at 13 over an SMA(3) of 11, having closed at its SMA the day before: bought at day 6's open.
        const { backtest, trades } = run(def, { AAA: flat([10, 10, 10, 10, 13, 13, 14]) });
        assert.equal(backtest.from, sessions(4)[3]);
        assert.equal(backtest.equityCurve.length, 4);
        // Regression: held while Close stays above its SMA, not sold the session after the cross.
        assert.equal(trades.length, 0);
        assert.ok(backtest.equityCurve.at(-1)! > 100);
    });

    test('measures against SPY over the same window, from its close on the first session', () => {
        const spy = flat([400, 410, 420, 430, 440]);
        const { backtest } = run(definition(), { AAA: flat([90, 90, 90, 90, 90]) }, spy);
        assert.deepEqual(backtest.benchmark, { symbol: 'SPY', totalReturnPct: 10 });
        assert.equal(run(definition(), { AAA: flat([90, 90]) }).backtest.benchmark, null);
    });

    test('regression: no SPY comparison when its stored closes stop more than a week before the window does', () => {
        const dates = sessions(20);
        const aaa = bars(dates.map(() => [90, 90, 90] as [number, number, number]), dates);
        const spyStopsEarly = bars([[400, 400, 400], [410, 410, 410], [420, 420, 420]], dates.slice(0, 3));
        assert.equal(run(definition(), { AAA: aaa }, spyStopsEarly).backtest.benchmark, null);
        const spyWholeWindow = bars(dates.map((_, i) => [400 + i, 400 + i, 400 + i] as [number, number, number]), dates);
        assert.deepEqual(run(definition(), { AAA: aaa }, spyWholeWindow).backtest.benchmark, { symbol: 'SPY', totalReturnPct: 4.75 });
    });

    test('tickers without history are named and left out', () => {
        const { backtest } = run(definition({ symbols: ['AAA', 'NOPE'] }), { AAA: flat([90, 90, 90]) });
        assert.deepEqual(backtest.symbolsWithoutHistory, ['NOPE']);
    });

    test('a long run gets a CAGR, Sharpe, a repeatable Monte Carlo strip and a verdict with its reason', () => {
        // 300 sessions trending up with a wobble: Close above SMA(5) buys, below sells.
        const closes = Array.from({ length: 300 }, (_, i) => 100 * 1.002 ** i * (1 + 0.03 * Math.sin(i / 3)));
        const def = definition({
            rules: [rule('Close', '>', 'SMA(5)')],
            symbols: ['AAA', 'BBB'],
            guardrails: { maxPositionPct: 0.5, stopLossPct: 0.2, rebalanceDays: 1 },
        });
        const data = { AAA: flat(closes), BBB: flat(closes.map((c) => c * 2)) };
        const first = run(def, data);
        const again = run(def, data);
        const { stats, monteCarlo, verdict, verdictReason } = first.backtest;
        assert.ok(stats.cagrPct !== null && stats.sharpe !== null && stats.sortino !== null);
        assert.ok(stats.tradeCount >= 10);
        assert.deepEqual(monteCarlo?.map((c) => c.percentile), [5, 25, 50, 75, 95]);
        assert.ok(monteCarlo!.every((c, i) => i === 0 || c.value >= monteCarlo![i - 1].value));
        assert.deepEqual(again.backtest, first.backtest);
        assert.ok(verdictReason.length > 0 && verdict !== undefined);
    });

    test('says why it can\'t run', () => {
        const code = (def: StrategyDefinition, data: Record<string, BacktestBar[]> = { AAA: flat([90, 90, 90]) }) => {
            const outcome = runBacktest(def, data);
            return outcome.ok ? 'ok' : `${outcome.code}: ${outcome.message}`;
        };
        assert.equal(code(definition({ rules: [] })), 'NO_RULES: Add a rule to backtest.');
        assert.equal(code(definition({ symbols: [] })), 'NO_SYMBOLS: Add a ticker for the strategy to trade.');
        assert.equal(code(definition({ rules: [rule('P/E', '<', '18')] })), 'INVALID_RULE: Rule 1: Atlas can\'t compute "P/E".');
        assert.equal(code(definition({ rules: [rule('Close', '>', 'SPX RS')] })), 'INVALID_RULE: Rule 1: "SPX RS" isn\'t a number or an indicator.');
        assert.match(code(definition(), {}), /^NO_HISTORY: /);
        assert.equal(code(definition({ rules: [rule('SMA(200)', '>', '0')] })), 'SHORT_HISTORY: These rules need 201 sessions of history; Atlas has 3.');
    });
});

describe('judge', () => {
    const stats = (overrides: Partial<BacktestStats>): BacktestStats => ({
        totalReturnPct: 20, cagrPct: 10, netProfitUsd: 20_000, sharpe: 1.2, sortino: 1.5,
        maxDrawdownPct: -8, profitFactor: 1.8, tradeCount: 40, winRatePct: 55, ...overrides,
    });
    const mc = (p5: number, p25: number) => [
        { percentile: 5 as const, value: p5 }, { percentile: 25 as const, value: p25 }, { percentile: 50 as const, value: 1.2 },
        { percentile: 75 as const, value: 1.3 }, { percentile: 95 as const, value: 1.5 },
    ];

    test('too short, too few trades or too few returns is Unproven', () => {
        assert.equal(judge(stats({}), mc(1.05, 1.1), 100).verdict, 'Unproven');
        assert.deepEqual(judge(stats({ tradeCount: 1 }), mc(1.05, 1.1), 300), { verdict: 'Unproven', verdictReason: '1 closed trade: too few to judge.' });
        assert.equal(judge(stats({ sharpe: null }), null, 300).verdict, 'Unproven');
    });

    test('Robust, Promising and Fragile follow Sharpe and the resampled paths, and say so', () => {
        assert.equal(judge(stats({}), mc(1.05, 1.1), 300).verdict, 'Robust');
        assert.equal(judge(stats({}), mc(0.95, 1.1), 300).verdict, 'Promising');
        assert.equal(judge(stats({ sharpe: 0.7 }), mc(1.05, 1.1), 300).verdictReason, 'Sharpe 0.70, between 0.5 and 1.');
        assert.equal(judge(stats({ sharpe: 0.3 }), mc(1.05, 1.1), 300).verdict, 'Fragile');
        assert.equal(judge(stats({}), mc(0.8, 0.95), 300).verdictReason, 'More than a quarter of the resampled paths ended below the start.');
    });
});
