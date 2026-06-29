import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildAlphaRadarBacktestSignals,
    runAlphaRadarBacktest,
    type AlphaRadarBacktestPricePoint,
} from './backtest';
import type { AlphaRadarMemoChange } from './memo';

describe('Alpha Radar backtests', () => {
    test('enters after 13F reporting lag instead of same-day quarter end', () => {
        const signals = buildAlphaRadarBacktestSignals({
            changes: [change({ ticker: 'AAPL', changeType: 'increased', materialityScore: 92 })],
            reportPeriodEndByPeriod: { '2025-Q4': '2025-12-31' },
        });
        const result = runAlphaRadarBacktest({
            signals,
            pricesByTicker: {
                AAPL: prices([
                    ['2025-12-31', 100],
                    ['2026-01-15', 160],
                    ['2026-02-15', 120],
                    ['2026-03-17', 132],
                ]),
            },
            benchmarkPrices: prices([
                ['2026-02-15', 100],
                ['2026-03-17', 105],
            ]),
            forwardWindowsDays: [30],
            generatedAt: '2026-05-13T00:00:00.000Z',
        });

        assert.equal(result.trades.length, 1);
        assert.equal(result.trades[0].availabilityDate, '2026-02-14');
        assert.equal(result.trades[0].entryDate, '2026-02-15');
        assert.equal(result.trades[0].entryPrice, 120);
        assert.equal(result.trades[0].exitPrice, 132);
        assert.equal(result.trades[0].signalReturn, 0.1);
        assert.equal(result.trades[0].lagDays, 46);
    });

    test('uses filing acceptance when it is later than the default lag window', () => {
        const signals = buildAlphaRadarBacktestSignals({
            changes: [change({ ticker: 'NVDA', currentFilingId: 'filing-nvda', changeType: 'new', materialityScore: 95 })],
            reportPeriodEndByPeriod: { '2025-Q4': '2025-12-31' },
            filingAcceptedAtByFilingId: { 'filing-nvda': '2026-02-20' },
        });
        const result = runAlphaRadarBacktest({
            signals,
            pricesByTicker: {
                NVDA: prices([
                    ['2026-02-15', 100],
                    ['2026-02-20', 110],
                    ['2026-03-22', 121],
                ]),
            },
            benchmarkPrices: prices([
                ['2026-02-20', 100],
                ['2026-03-22', 104],
            ]),
            forwardWindowsDays: [30],
        });

        assert.equal(result.trades[0].availabilityDate, '2026-02-20');
        assert.equal(result.trades[0].entryDate, '2026-02-20');
        assert.equal(Math.round(result.trades[0].relativeReturn * 100), 6);
    });

    test('models exits as avoid-or-short signals and compares against benchmark', () => {
        const signals = buildAlphaRadarBacktestSignals({
            changes: [change({ ticker: 'TSLA', changeType: 'exited', materialityScore: 88 })],
            reportPeriodEndByPeriod: { '2025-Q4': '2025-12-31' },
        });
        const result = runAlphaRadarBacktest({
            signals,
            pricesByTicker: {
                TSLA: prices([
                    ['2026-02-14', 200],
                    ['2026-03-16', 160],
                ]),
            },
            benchmarkPrices: prices([
                ['2026-02-14', 100],
                ['2026-03-16', 102],
            ]),
            forwardWindowsDays: [30],
        });

        assert.equal(result.trades[0].direction, 'avoid-or-short');
        assert.equal(result.trades[0].securityReturn, -0.2);
        assert.equal(result.trades[0].signalReturn, 0.2);
        assert.equal(result.trades[0].hit, true);
        assert.ok(result.summaries[0].hitRate > 0.99);
    });

    test('skips missing prices and records split-adjustment warnings', () => {
        const signals = buildAlphaRadarBacktestSignals({
            changes: [
                change({ ticker: 'AAPL', changeType: 'increased', materialityScore: 92 }),
                change({ ticker: 'MSFT', changeType: 'increased', materialityScore: 91 }),
            ],
            reportPeriodEndByPeriod: { '2025-Q4': '2025-12-31' },
        });
        const result = runAlphaRadarBacktest({
            signals,
            pricesByTicker: {
                AAPL: [
                    { date: '2026-02-14', close: 100, splitAdjusted: false },
                    { date: '2026-03-16', close: 90, splitAdjusted: false },
                ],
            },
            benchmarkPrices: prices([
                ['2026-02-14', 100],
                ['2026-03-16', 100],
            ]),
            forwardWindowsDays: [30],
        });

        assert.equal(result.trades.length, 1);
        assert.deepEqual(result.trades[0].warnings, ['price-series-not-split-adjusted']);
        assert.equal(result.skipped.length, 1);
        assert.equal(result.skipped[0].ticker, 'MSFT');
        assert.equal(result.skipped[0].reason, 'missing-price-series');
    });

    test('creates summaries for top-adds, user-overlap, conviction, and consensus scenarios', () => {
        const baseChange = change({
            ticker: 'NVDA',
            changeType: 'new',
            materialityScore: 96,
            userRelevance: {
                portfolio: false,
                watchlist: true,
                thesis: false,
                reasons: ['watchlist overlap'],
                matchedTickers: ['NVDA'],
                matchedCusips: ['67066G104'],
            },
        });
        const signals = buildAlphaRadarBacktestSignals({
            changes: [baseChange],
            convictionItems: [{
                id: 'conviction-nvda',
                securityKey: 'nvda',
                trackedFilerId: 'filer-1',
                rank: 1,
                reportPeriod: '2025-Q4',
                ticker: 'NVDA',
                issuerName: 'NVIDIA CORP',
                cusip: '67066G104',
                changeType: 'new',
                convictionScore: 91,
                rawSignalScore: 90,
                userRelevanceScore: 70,
                evidenceFitScore: 45,
                trend: 'strengthening',
                factors: [],
                displayReason: 'Fixture conviction signal',
            }],
            cloneClusters: [{
                id: 'cluster-nvda',
                securityKey: 'nvda',
                ticker: 'NVDA',
                issuerName: 'NVIDIA CORP',
                cusip: '67066G104',
                reportPeriod: '2025-Q4',
                direction: 'consensus_buy',
                overlapScore: 88,
                fundStyles: ['Technology growth'],
                filers: [],
                userOverlap: {
                    portfolio: false,
                    watchlist: true,
                    thesis: false,
                    reasons: ['watchlist overlap'],
                },
                materialityScore: 96,
            }],
            reportPeriodEndByPeriod: { '2025-Q4': '2025-12-31' },
        });
        const result = runAlphaRadarBacktest({
            signals,
            pricesByTicker: {
                NVDA: prices([
                    ['2026-02-14', 100],
                    ['2026-03-16', 112],
                ]),
            },
            benchmarkPrices: prices([
                ['2026-02-14', 100],
                ['2026-03-16', 104],
            ]),
            forwardWindowsDays: [30],
        });

        assert.deepEqual(
            result.summaries.map((summary) => summary.scenario).sort(),
            ['consensus', 'conviction', 'top-adds', 'user-overlap'],
        );
        assert.ok(result.summaries.every((summary) => summary.averageRelativeReturn > 0));
        assert.match(result.methodologyNote, /not trading recommendations/i);
    });
});

function change(overrides: Partial<AlphaRadarMemoChange> & { ticker: string }): AlphaRadarMemoChange {
    const { ticker, ...rest } = overrides;
    return {
        trackedFilerId: 'filer-1',
        currentFilingId: rest.currentFilingId ?? 'filing-1',
        reportPeriod: '2025-Q4',
        changeType: 'increased',
        issuerName: `${ticker} INC`,
        cusip: `${ticker.padEnd(9, '0').slice(0, 9)}`,
        ticker,
        currentValueUsd: 1_000_000,
        priorValueUsd: 500_000,
        valueDeltaUsd: 500_000,
        currentShares: 10_000,
        priorShares: 5_000,
        shareDelta: 5_000,
        currentWeight: 0.05,
        priorWeight: 0.02,
        weightDelta: 0.03,
        materialityScore: 90,
        userRelevance: {
            portfolio: false,
            watchlist: false,
            thesis: false,
            reasons: [],
            matchedTickers: [],
            matchedCusips: [],
        },
        displayReason: 'Fixture signal',
        ...rest,
    };
}

function prices(points: Array<[string, number]>): AlphaRadarBacktestPricePoint[] {
    return points.map(([date, close]) => ({ date, close, splitAdjusted: true }));
}
