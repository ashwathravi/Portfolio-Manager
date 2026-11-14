import { SEED_ADHERENCE_RULES } from '@/lib/adherence/seed';

import type { Strategy, StrategyDefinition } from './strategy';

/**
 * Example strategies for the Strategy Builder, shown as Sample data.
 *
 * Their rules use the same indicators a saved strategy can (indicators.ts),
 * so a copy saved to the user's account backtests for real. Their own
 * backtests are illustrative: deterministic equity curves anchored on the
 * stats, never a run over stored prices.
 */

// Deterministic 72-point walk from `start` to `end` with `seed`-driven noise.
function walk(seed: number, start: number, end: number, points = 72, noisePct = 0.025): number[] {
    let a = seed | 0;
    const rand = () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const out = new Array<number>(points);
    for (let i = 0; i < points; i++) {
        const t = i / (points - 1 || 1);
        const trend = start + (end - start) * t;
        const noise = (rand() - 0.5) * 2 * noisePct * end;
        out[i] = trend + noise;
    }
    out[points - 1] = end; // anchor the last point exactly
    return out;
}

const momentum: StrategyDefinition = {
    rules: [
        { id: 'rule-mv-1', field: 'Mom(6M)', op: '>', value: '10%' },
        { id: 'rule-mv-2', field: 'Close', op: '>', value: 'SMA(200)' },
        { id: 'rule-mv-3', field: 'ADV(30)', op: '>=', value: '$5M' },
    ],
    conjunctions: ['AND', 'AND'],
    symbols: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'JPM', 'UNH', 'XOM', 'HD'],
    guardrails: { maxPositionPct: 0.05, stopLossPct: 0.12, rebalanceDays: 30 },
};

const meanReversion: StrategyDefinition = {
    rules: [
        { id: 'rule-mr-1', field: 'RSI(14)', op: '<', value: '30' },
        { id: 'rule-mr-2', field: 'Close', op: 'crosses above', value: 'SMA(10)' },
    ],
    conjunctions: ['OR'],
    symbols: ['SPY', 'QQQ', 'IWM', 'DIA'],
    guardrails: { maxPositionPct: 0.03, stopLossPct: 0.08, rebalanceDays: 7 },
};

const sectorRotation: StrategyDefinition = {
    rules: [
        { id: 'rule-sr-1', field: 'Mom(3M)', op: '>', value: '0' },
        { id: 'rule-sr-2', field: 'Close', op: '>', value: 'SMA(50)' },
    ],
    conjunctions: ['AND'],
    symbols: ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'],
    guardrails: { maxPositionPct: 0.25, stopLossPct: 0.1, rebalanceDays: 30 },
};

const ladder = (active: 'robustness' | 'paper' | 'backtest') => {
    const keys = ['rules', 'backtest', 'robustness', 'paper', 'live'] as const;
    const labels = { rules: 'Rules', backtest: 'Backtest', robustness: 'Robustness', paper: 'Paper trade', live: 'Gates real orders' };
    const at = keys.indexOf(active);
    return keys.map((key, i) => ({ key, label: labels[key], status: i < at ? 'done' as const : i === at ? 'active' as const : 'pending' as const }));
};

export const SEED_STRATEGIES: Strategy[] = [
    {
        id: 'strategy-momentum-value',
        name: 'Momentum + Trend',
        description: 'Large caps with strong 6-month momentum, trading above their 200-day average.',
        example: true,
        ...momentum,
        adherenceRules: SEED_ADHERENCE_RULES['strategy-momentum-value'] ?? [],
        backtest: {
            from: '2024-05-01',
            to: '2026-04-30',
            verdict: 'Robust',
            verdictReason: 'Sharpe 1.92, and 95% of the resampled paths ended above the start.',
            equityCurve: walk(1337, 100, 131.2, 72, 0.02),
            stats: {
                totalReturnPct: 31.2,
                cagrPct: 14.5,
                netProfitUsd: 31_200,
                sharpe: 1.92,
                sortino: 2.41,
                maxDrawdownPct: -8.4,
                profitFactor: 2.15,
                tradeCount: 64,
                winRatePct: 64.5,
            },
            benchmark: null,
            monteCarlo: [
                { percentile: 5, value: 1.04 },
                { percentile: 25, value: 1.18 },
                { percentile: 50, value: 1.29 },
                { percentile: 75, value: 1.41 },
                { percentile: 95, value: 1.62 },
            ],
            symbolsWithoutHistory: [],
            definition: momentum,
            promotion: ladder('robustness'),
        },
    },
    {
        id: 'strategy-mean-reversion',
        name: 'Mean Reversion',
        description: 'Short-term trades on oversold index ETFs, with RSI under 30.',
        example: true,
        ...meanReversion,
        adherenceRules: SEED_ADHERENCE_RULES['strategy-mean-reversion'] ?? [],
        backtest: {
            from: '2024-05-01',
            to: '2026-04-30',
            verdict: 'Promising',
            verdictReason: 'Sharpe of at least 1, but more than 5% of the resampled paths ended below the start.',
            equityCurve: walk(4242, 100, 122.3, 72, 0.03),
            stats: {
                totalReturnPct: 22.3,
                cagrPct: 10.6,
                netProfitUsd: 22_300,
                sharpe: 1.45,
                sortino: 1.72,
                maxDrawdownPct: -11.2,
                profitFactor: 1.68,
                tradeCount: 101,
                winRatePct: 58.2,
            },
            benchmark: null,
            monteCarlo: [
                { percentile: 5, value: 0.97 },
                { percentile: 25, value: 1.1 },
                { percentile: 50, value: 1.2 },
                { percentile: 75, value: 1.31 },
                { percentile: 95, value: 1.49 },
            ],
            symbolsWithoutHistory: [],
            definition: meanReversion,
            promotion: ladder('paper'),
        },
    },
    {
        id: 'strategy-sector-rotation',
        name: 'Sector Rotation',
        description: 'Monthly rotation into the sector ETFs with positive 3-month momentum.',
        example: true,
        ...sectorRotation,
        adherenceRules: SEED_ADHERENCE_RULES['strategy-sector-rotation'] ?? [],
        backtest: {
            from: '2024-05-01',
            to: '2026-04-30',
            verdict: 'Unproven',
            verdictReason: '8 closed trades: too few to judge.',
            equityCurve: walk(9001, 100, 109.5, 72, 0.018),
            stats: {
                totalReturnPct: 9.5,
                cagrPct: 4.6,
                netProfitUsd: 9_500,
                sharpe: 0.98,
                sortino: 1.15,
                maxDrawdownPct: -13.1,
                profitFactor: 1.32,
                tradeCount: 8,
                winRatePct: 50,
            },
            benchmark: null,
            monteCarlo: [
                { percentile: 5, value: 0.91 },
                { percentile: 25, value: 1.01 },
                { percentile: 50, value: 1.09 },
                { percentile: 75, value: 1.17 },
                { percentile: 95, value: 1.3 },
            ],
            symbolsWithoutHistory: [],
            definition: sectorRotation,
            promotion: ladder('backtest'),
        },
    },
];
