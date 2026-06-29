import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
    buildAlphaRadarCloneGraph,
    filterAlphaRadarCloneClusters,
} from './clone-graph';
import type { AlphaRadarMemoChange } from './memo';
import type { AlphaRadarTrackedFilerRecord } from './contracts';

const FILERS: AlphaRadarTrackedFilerRecord[] = [
    {
        id: 'filer-berkshire',
        name: 'Berkshire Hathaway',
        slug: 'berkshire-hathaway',
        cik: '0001067983',
        fundStyle: 'Deep value',
        enabled: true,
    },
    {
        id: 'filer-coatue',
        name: 'Coatue Management',
        slug: 'coatue-management',
        cik: '0000941459',
        fundStyle: 'AI focus',
        enabled: true,
    },
    {
        id: 'filer-bridgewater',
        name: 'Bridgewater Associates',
        slug: 'bridgewater-associates',
        cik: '0001350694',
        fundStyle: 'Macro',
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
        materialityScore: 75,
        userRelevance: BASE_RELEVANCE,
        displayReason: `${input.issuerName} ${input.changeType}`,
        ...input,
    };
}

describe('buildAlphaRadarCloneGraph', () => {
    test('clusters multi-filer consensus buys and user thesis overlap', () => {
        const graph = buildAlphaRadarCloneGraph({
            filers: FILERS,
            changes: [
                change({
                    trackedFilerId: 'filer-berkshire',
                    changeType: 'increased',
                    issuerName: 'NVIDIA CORP',
                    cusip: '67066G104',
                    ticker: 'NVDA',
                    materialityScore: 88,
                }),
                change({
                    trackedFilerId: 'filer-coatue',
                    changeType: 'new',
                    issuerName: 'NVIDIA CORP',
                    cusip: '67066G104',
                    ticker: 'NVDA',
                    materialityScore: 94,
                    userRelevance: { ...BASE_RELEVANCE, thesis: true, reasons: ['active thesis'], matchedTickers: ['NVDA'] },
                }),
            ],
            userThesisTickers: ['NVDA'],
        });

        assert.strictEqual(graph.clusters.length, 1);
        assert.strictEqual(graph.clusters[0].direction, 'consensus_buy');
        assert.deepStrictEqual(graph.clusters[0].fundStyles, ['AI focus', 'Deep value']);
        assert.strictEqual(graph.clusters[0].userOverlap.thesis, true);
        assert.ok(graph.clusters[0].overlapScore > 80);
        assert.ok(graph.nodes.some((node) => node.id === 'user:thesis'));
        assert.ok(graph.edges.some((edge) => edge.kind === 'thesis-overlap'));
    });

    test('identifies mixed cross-filer direction on a portfolio-owned name', () => {
        const graph = buildAlphaRadarCloneGraph({
            filers: FILERS,
            changes: [
                change({
                    trackedFilerId: 'filer-berkshire',
                    changeType: 'decreased',
                    issuerName: 'APPLE INC',
                    cusip: '037833100',
                    ticker: 'AAPL',
                    materialityScore: 90,
                }),
                change({
                    trackedFilerId: 'filer-coatue',
                    changeType: 'increased',
                    issuerName: 'APPLE INC',
                    cusip: '037833100',
                    ticker: 'AAPL',
                    materialityScore: 72,
                }),
            ],
            userPortfolioTickers: ['AAPL'],
        });

        assert.strictEqual(graph.clusters[0].direction, 'mixed');
        assert.strictEqual(graph.clusters[0].userOverlap.portfolio, true);
        assert.ok(graph.edges.some((edge) => edge.kind === 'portfolio-overlap'));
    });

    test('filters clusters by fund style without changing the source graph', () => {
        const graph = buildAlphaRadarCloneGraph({
            filers: FILERS,
            changes: [
                change({
                    trackedFilerId: 'filer-bridgewater',
                    changeType: 'increased',
                    issuerName: 'PROCTER & GAMBLE CO',
                    cusip: '742718109',
                    ticker: 'PG',
                }),
                change({
                    trackedFilerId: 'filer-coatue',
                    changeType: 'new',
                    issuerName: 'NVIDIA CORP',
                    cusip: '67066G104',
                    ticker: 'NVDA',
                }),
            ],
        });

        const macro = filterAlphaRadarCloneClusters(graph.clusters, 'Macro');

        assert.strictEqual(graph.clusters.length, 2);
        assert.strictEqual(macro.length, 1);
        assert.strictEqual(macro[0].ticker, 'PG');
    });

    test('returns an empty graph for sparse input with no material changes', () => {
        const graph = buildAlphaRadarCloneGraph({
            filers: FILERS,
            changes: [],
        });

        assert.deepStrictEqual(graph.clusters, []);
        assert.deepStrictEqual(graph.nodes, []);
        assert.deepStrictEqual(graph.edges, []);
    });
});
