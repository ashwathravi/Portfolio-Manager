import { describe, test } from 'node:test';
import assert from 'node:assert';
import { buildAlphaRadarCloneGraph } from './clone-graph';
import {
    scoreAlphaRadarConviction,
    summarizeAlphaRadarConviction,
    type AlphaRadarConvictionHistoryPoint,
} from './conviction';
import type { AlphaRadarMemoChange } from './memo';
import type { AlphaRadarTrackedFilerRecord } from './contracts';
import type { AlphaRadarSemanticContextSnippet } from './agent-contracts';

const FILERS: AlphaRadarTrackedFilerRecord[] = [
    {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Berkshire Hathaway',
        slug: 'berkshire-hathaway',
        cik: '0001067983',
        fundStyle: 'Concentrated value',
        enabled: true,
    },
    {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Coatue Management',
        slug: 'coatue-management',
        cik: '0000941459',
        fundStyle: 'Technology growth',
        enabled: true,
    },
];

const BASE_RELEVANCE = {
    portfolio: false,
    watchlist: false,
    thesis: false,
    reasons: [] as string[],
    matchedTickers: [] as string[],
    matchedCusips: [] as string[],
};

function change(input: Partial<AlphaRadarMemoChange> & Pick<AlphaRadarMemoChange, 'trackedFilerId' | 'changeType' | 'issuerName' | 'cusip' | 'ticker'>): AlphaRadarMemoChange {
    return {
        reportPeriod: '2025-Q4',
        currentFilingId: `${input.trackedFilerId}-filing`,
        materialityScore: 50,
        currentWeight: 0.02,
        priorWeight: 0.01,
        weightDelta: 0.01,
        rankDelta: 0,
        valueDeltaUsd: 10_000_000,
        userRelevance: BASE_RELEVANCE,
        displayReason: `${input.issuerName} ${input.changeType}`,
        ...input,
    };
}

function semanticSnippet(ticker: string, score = 4): AlphaRadarSemanticContextSnippet {
    return {
        chunkId: `chunk-${ticker}`,
        sourceId: `source-${ticker}`,
        sourceKind: 'memo-section',
        text: `${ticker} appeared in Alpha Radar memo evidence with portfolio and thesis context.`,
        score,
        citation: {
            kind: 'memo-section',
            id: `memo-${ticker}`,
            title: `${ticker} Alpha Radar memo`,
            citation: 'Alpha Radar',
        },
    };
}

describe('scoreAlphaRadarConviction', () => {
    test('ranks consensus thesis overlap above a larger isolated dollar move', () => {
        const changes = [
            change({
                trackedFilerId: FILERS[0].id,
                changeType: 'new',
                issuerName: 'NVIDIA CORP',
                cusip: '67066G104',
                ticker: 'NVDA',
                currentWeight: 0.052,
                weightDelta: 0.052,
                materialityScore: 82,
                valueDeltaUsd: 1_250_000_000,
                userRelevance: { ...BASE_RELEVANCE, thesis: true, watchlist: true, reasons: ['active thesis', 'watchlist overlap'], matchedTickers: ['NVDA'] },
            }),
            change({
                trackedFilerId: FILERS[1].id,
                changeType: 'increased',
                issuerName: 'NVIDIA CORP',
                cusip: '67066G104',
                ticker: 'NVDA',
                currentWeight: 0.041,
                priorWeight: 0.02,
                weightDelta: 0.021,
                materialityScore: 79,
                valueDeltaUsd: 700_000_000,
                userRelevance: { ...BASE_RELEVANCE, thesis: true, reasons: ['active thesis'], matchedTickers: ['NVDA'] },
            }),
            change({
                trackedFilerId: FILERS[0].id,
                changeType: 'decreased',
                issuerName: 'EXXON MOBIL CORP',
                cusip: '30231G102',
                ticker: 'XOM',
                currentWeight: 0.18,
                priorWeight: 0.3,
                weightDelta: -0.12,
                materialityScore: 100,
                valueDeltaUsd: -3_000_000_000,
            }),
        ];
        const cloneGraph = buildAlphaRadarCloneGraph({
            filers: FILERS,
            changes,
            userThesisTickers: ['NVDA'],
            userWatchlistTickers: ['NVDA'],
        });

        const ranking = scoreAlphaRadarConviction({
            changes,
            cloneClusters: cloneGraph.clusters,
            semanticContext: [semanticSnippet('NVDA')],
        });

        assert.strictEqual(ranking[0].ticker, 'NVDA');
        assert.ok(ranking[0].convictionScore > ranking.find((item) => item.ticker === 'XOM')!.convictionScore);
        assert.ok(ranking[0].factors.some((factor) => factor.kind === 'filer-consensus'));
        assert.ok(ranking[0].factors.some((factor) => factor.kind === 'thesis-overlap'));
        assert.ok(ranking[0].factors.some((factor) => factor.kind === 'evidence-fit'));
    });

    test('separates raw 13F signal, user relevance, and evidence fit components', () => {
        const [item] = scoreAlphaRadarConviction({
            changes: [
                change({
                    trackedFilerId: FILERS[0].id,
                    changeType: 'increased',
                    issuerName: 'APPLE INC',
                    cusip: '037833100',
                    ticker: 'AAPL',
                    currentWeight: 0.42,
                    priorWeight: 0.31,
                    weightDelta: 0.11,
                    rankDelta: 2,
                    materialityScore: 88,
                    userRelevance: { ...BASE_RELEVANCE, portfolio: true, thesis: true, reasons: ['portfolio overlap', 'active thesis'], matchedTickers: ['AAPL'] },
                }),
            ],
            semanticContext: [semanticSnippet('AAPL', 6)],
        });

        assert.ok(item.rawSignalScore > 0);
        assert.ok(item.userRelevanceScore > 0);
        assert.ok(item.evidenceFitScore > 0);
        assert.ok(item.factors.every((factor) => factor.kind && factor.component && factor.label && factor.detail));
        assert.match(summarizeAlphaRadarConviction(item), /ranked \d+\/100/);
    });

    test('is stable across repeated unchanged input refreshes', () => {
        const input = {
            changes: [
                change({
                    trackedFilerId: FILERS[0].id,
                    changeType: 'new',
                    issuerName: 'CHUBB LTD',
                    cusip: 'H1467J104',
                    ticker: 'CB',
                    currentWeight: 0.064,
                    weightDelta: 0.064,
                    materialityScore: 92,
                    userRelevance: { ...BASE_RELEVANCE, watchlist: true, reasons: ['watchlist overlap'], matchedTickers: ['CB'] },
                }),
            ],
            semanticContext: [semanticSnippet('CB')],
        };

        assert.deepStrictEqual(scoreAlphaRadarConviction(input), scoreAlphaRadarConviction(input));
    });

    test('uses prior history to label strengthening, weakening, and stable conviction', () => {
        const history: AlphaRadarConvictionHistoryPoint[] = [
            {
                securityKey: 'AAPL',
                reportPeriod: '2025-Q3',
                convictionScore: 45,
            },
            {
                securityKey: 'MSFT',
                reportPeriod: '2025-Q3',
                convictionScore: 82,
            },
        ];

        const ranking = scoreAlphaRadarConviction({
            reportPeriod: '2025-Q4',
            history,
            changes: [
                change({
                    trackedFilerId: FILERS[0].id,
                    changeType: 'increased',
                    issuerName: 'APPLE INC',
                    cusip: '037833100',
                    ticker: 'AAPL',
                    currentWeight: 0.2,
                    weightDelta: 0.07,
                    materialityScore: 86,
                }),
                change({
                    trackedFilerId: FILERS[0].id,
                    changeType: 'decreased',
                    issuerName: 'MICROSOFT CORP',
                    cusip: '594918104',
                    ticker: 'MSFT',
                    currentWeight: 0.01,
                    priorWeight: 0.09,
                    weightDelta: -0.08,
                    materialityScore: 30,
                }),
            ],
        });

        assert.strictEqual(ranking.find((item) => item.ticker === 'AAPL')?.trend, 'strengthening');
        assert.strictEqual(ranking.find((item) => item.ticker === 'MSFT')?.trend, 'weakening');
        assert.strictEqual(ranking.find((item) => item.ticker === 'MSFT')?.priorScore, 82);
    });

    test('returns an empty ranking for sparse input', () => {
        assert.deepStrictEqual(scoreAlphaRadarConviction({ changes: [] }), []);
        assert.deepStrictEqual(scoreAlphaRadarConviction({
            changes: [
                change({
                    trackedFilerId: FILERS[0].id,
                    changeType: 'unchanged',
                    issuerName: 'APPLE INC',
                    cusip: '037833100',
                    ticker: 'AAPL',
                }),
            ],
        }), []);
    });
});
