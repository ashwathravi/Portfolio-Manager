import type { Strategy } from './strategy';

/**
 * Seed strategies for the Phase 6 Strategy Builder.
 *
 * Three hand-tuned strategies that exercise the full builder surface
 * (rules with AND/OR glue, universe filters, guardrails, a full backtest
 * bundle with Monte Carlo percentiles and promotion ladder). The equity
 * curves are deterministic walks anchored on the Strategy's totalReturnPct
 * so the backtest chart always matches the card stats.
 */

// Deterministic 72-point walk from `start` to `end` with `seed`-driven noise.
// Kept inline so the seed module stays self-contained — the Phase 6 page
// re-samples this on the fly when users tweak a strategy so we don't want
// an external dependency loop through `@/lib/charts` here.
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

export const SEED_STRATEGIES: Strategy[] = [
    {
        id: 'strategy-momentum-value',
        shortId: 'S-001',
        name: 'Momentum + Value',
        description: 'Long positions with strong 6M momentum and below-market P/E.',
        status: 'active',
        stats: {
            totalReturnPct: 18.45,
            sharpe: 1.92,
            maxDrawdownPct: -8.4,
            winRatePct: 64.5,
        },
        rules: [
            { id: 'rule-mv-1', field: 'MomScore(6M)', op: '>', value: '0.7' },
            { id: 'rule-mv-2', field: 'P/E', op: '<', value: '18' },
            { id: 'rule-mv-3', field: 'ADV(30)', op: '>=', value: '$5M' },
        ],
        conjunctions: ['AND', 'AND'],
        universe: [
            { id: 'uni-sp500', label: 'S&P 500', enabled: true },
            { id: 'uni-no-fin', label: 'Exclude financials', enabled: true },
            { id: 'uni-mktcap', label: 'Min mkt cap $5B', enabled: true },
        ],
        guardrails: {
            maxPositionPct: 0.05, // 5% per position
            stopLossPct: 0.12, // 12% stop
            rebalanceDays: 30, // monthly
        },
        backtest: {
            windowLabel: 'Jan 2020 – Apr 2026',
            verdict: 'Robust',
            equityCurve: walk(1337, 100, 218.45, 72, 0.020),
            stats: {
                cagrPct: 14.2,
                netProfitUsd: 118_450,
                sharpe: 1.92,
                sortino: 2.41,
                maxDrawdownPct: -8.4,
                profitFactor: 2.15,
                tradeCount: 127,
                winRatePct: 64.5,
            },
            monteCarlo: [
                { percentile: 95, value: 2.75, cagrPct: 17.6 },
                { percentile: 75, value: 2.32, cagrPct: 15.1 },
                { percentile: 50, value: 2.05, cagrPct: 13.5 },
                { percentile: 25, value: 1.74, cagrPct: 10.8 },
                { percentile: 5, value: 1.42, cagrPct: 6.3 },
            ],
            promotion: [
                { key: 'rules', label: 'Rules', status: 'done' },
                { key: 'backtest', label: 'Backtest', status: 'done' },
                { key: 'robustness', label: 'Robustness', status: 'active' },
                { key: 'paper', label: 'Paper trade', status: 'pending' },
                { key: 'live', label: 'Live', status: 'pending' },
            ],
        },
    },
    {
        id: 'strategy-mean-reversion',
        shortId: 'S-002',
        name: 'Mean Reversion',
        description: 'Short-term trades on oversold conditions with RSI < 30.',
        status: 'paused',
        stats: {
            totalReturnPct: 12.34,
            sharpe: 1.45,
            maxDrawdownPct: -11.2,
            winRatePct: 58.2,
        },
        rules: [
            { id: 'rule-mr-1', field: 'RSI(14)', op: '<', value: '30' },
            { id: 'rule-mr-2', field: 'Close', op: 'crosses above', value: 'SMA(10)' },
        ],
        conjunctions: ['OR'],
        universe: [
            { id: 'uni-sp500', label: 'S&P 500', enabled: true },
            { id: 'uni-no-biotech', label: 'Exclude biotech', enabled: true },
            { id: 'uni-liquid', label: 'Min liquidity $10M ADV', enabled: false },
        ],
        guardrails: {
            maxPositionPct: 0.03,
            stopLossPct: 0.08,
            rebalanceDays: 7,
        },
        backtest: {
            windowLabel: 'Jan 2020 – Apr 2026',
            verdict: 'Promising',
            equityCurve: walk(4242, 100, 212.34, 72, 0.030),
            stats: {
                cagrPct: 10.8,
                netProfitUsd: 82_300,
                sharpe: 1.45,
                sortino: 1.72,
                maxDrawdownPct: -11.2,
                profitFactor: 1.68,
                tradeCount: 203,
                winRatePct: 58.2,
            },
            monteCarlo: [
                { percentile: 95, value: 2.40, cagrPct: 14.1 },
                { percentile: 75, value: 2.06, cagrPct: 11.8 },
                { percentile: 50, value: 1.82, cagrPct: 10.0 },
                { percentile: 25, value: 1.55, cagrPct: 7.5 },
                { percentile: 5, value: 1.18, cagrPct: 2.7 },
            ],
            promotion: [
                { key: 'rules', label: 'Rules', status: 'done' },
                { key: 'backtest', label: 'Backtest', status: 'done' },
                { key: 'robustness', label: 'Robustness', status: 'done' },
                { key: 'paper', label: 'Paper trade', status: 'active' },
                { key: 'live', label: 'Live', status: 'pending' },
            ],
        },
    },
    {
        id: 'strategy-sector-rotation',
        shortId: 'S-003',
        name: 'Sector Rotation',
        description: 'Monthly rotation based on sector relative strength.',
        status: 'backtesting',
        stats: {
            totalReturnPct: 0,
            sharpe: 0,
            maxDrawdownPct: 0,
            winRatePct: 0,
        },
        rules: [
            { id: 'rule-sr-1', field: 'SectorRS(3M)', op: '>', value: 'SPX RS' },
            { id: 'rule-sr-2', field: 'Breadth(40D)', op: '>=', value: '0.55' },
        ],
        conjunctions: ['AND'],
        universe: [
            { id: 'uni-sectors', label: 'S&P 500 sector ETFs', enabled: true },
            { id: 'uni-etfs-only', label: 'ETFs only', enabled: true },
        ],
        guardrails: {
            maxPositionPct: 0.25, // bigger sector bets
            stopLossPct: 0.10,
            rebalanceDays: 30,
        },
        backtest: {
            windowLabel: 'Jan 2020 – Apr 2026',
            verdict: 'Unproven',
            equityCurve: walk(9001, 100, 145, 72, 0.018),
            stats: {
                cagrPct: 6.4,
                netProfitUsd: 45_000,
                sharpe: 0.98,
                sortino: 1.15,
                maxDrawdownPct: -13.1,
                profitFactor: 1.32,
                tradeCount: 48,
                winRatePct: 52.0,
            },
            monteCarlo: [
                { percentile: 95, value: 1.95, cagrPct: 11.4 },
                { percentile: 75, value: 1.62, cagrPct: 8.2 },
                { percentile: 50, value: 1.42, cagrPct: 6.2 },
                { percentile: 25, value: 1.18, cagrPct: 2.8 },
                { percentile: 5, value: 0.91, cagrPct: -1.5 },
            ],
            promotion: [
                { key: 'rules', label: 'Rules', status: 'done' },
                { key: 'backtest', label: 'Backtest', status: 'active' },
                { key: 'robustness', label: 'Robustness', status: 'pending' },
                { key: 'paper', label: 'Paper trade', status: 'pending' },
                { key: 'live', label: 'Live', status: 'pending' },
            ],
        },
    },
];
