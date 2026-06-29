import { describe, test } from 'node:test';
import assert from 'node:assert';
import type {
    AlphaRadarExternalOverlay,
    AlphaRadarSemanticContextSnippet,
} from './agent-contracts';
import { scoreAlphaRadarConviction } from './conviction';
import { generateAlphaRadarThesisDrafts } from './thesis-drafts';
import type { AlphaRadarMemoChange } from './memo';

const BASE_RELEVANCE = {
    portfolio: false,
    watchlist: false,
    thesis: false,
    reasons: [] as string[],
    matchedTickers: [] as string[],
    matchedCusips: [] as string[],
};

function change(input: {
    issuerName: string;
    cusip: string;
    ticker: string;
    changeType: AlphaRadarMemoChange['changeType'];
} & Partial<Omit<AlphaRadarMemoChange, 'issuerName' | 'cusip' | 'ticker' | 'changeType'>>): AlphaRadarMemoChange {
    return {
        id: `change-${input.ticker}`,
        trackedFilerId: '11111111-1111-4111-8111-111111111111',
        reportPeriod: '2025-Q4',
        materialityScore: 90,
        currentWeight: 0.05,
        weightDelta: 0.04,
        valueDeltaUsd: 500_000_000,
        userRelevance: { ...BASE_RELEVANCE, thesis: true, reasons: ['active thesis'], matchedTickers: [input.ticker] },
        displayReason: `${input.issuerName} ${input.changeType} in the 2025-Q4 13F.`,
        ...input,
    };
}

function overlay(ticker: string): AlphaRadarExternalOverlay {
    return {
        provider: 'Seeded research overlay',
        kind: 'theme-exposure',
        issuerName: ticker === 'NVDA' ? 'NVIDIA CORP' : 'APPLE INC',
        ticker,
        summary: `${ticker} has AI infrastructure overlay context in the seeded fixture.`,
        asOf: '2026-05-13',
        evidence: [{
            kind: 'external-overlay',
            id: `overlay-${ticker}`,
            title: `${ticker} overlay source`,
            citation: 'Seed fixture citation',
        }],
    };
}

function snippet(ticker: string): AlphaRadarSemanticContextSnippet {
    return {
        chunkId: `chunk-${ticker}`,
        sourceId: `source-${ticker}`,
        sourceKind: 'memo-section',
        text: `${ticker} appeared in cited Alpha Radar memo context.`,
        score: 4,
        citation: {
            kind: 'semantic-chunk',
            id: `chunk-${ticker}`,
            title: `${ticker} memo citation`,
            citation: 'Alpha Radar semantic memory',
        },
    };
}

describe('generateAlphaRadarThesisDrafts', () => {
    test('generates sourced why-now draft structure from conviction-ranked ideas', () => {
        const changes = [
            change({
                issuerName: 'NVIDIA CORP',
                cusip: '67066G104',
                ticker: 'NVDA',
                changeType: 'new',
            }),
        ];
        const convictionItems = scoreAlphaRadarConviction({
            changes,
            semanticContext: [snippet('NVDA')],
        });

        const [draft] = generateAlphaRadarThesisDrafts({
            changes,
            convictionItems,
            reportPeriod: '2025-Q4',
            sourceFilingIds: ['filing-current', 'filing-prior'],
            semanticContext: [snippet('NVDA')],
            externalOverlays: [overlay('NVDA')],
        });

        assert.ok(draft);
        assert.match(draft.hypothesis, /human review|candidate thesis/i);
        assert.match(draft.whyNow, /2025-Q4/);
        assert.match(draft.falsifyIf, /next 13F reverses/);
        assert.ok(draft.risks.every((risk) => risk.length > 0));
        assert.ok(draft.nextWatchItems.some((item) => /Ask Ledger/i.test(item)));
        assert.ok(draft.supportingEvidence.some((item) => item.kind === 'holding-change'));
        assert.ok(draft.supportingEvidence.some((item) => item.kind === 'filing'));
        assert.ok(draft.supportingEvidence.some((item) => item.kind === 'external-overlay'));
        assert.ok(draft.supportingEvidence.some((item) => item.kind === 'semantic-chunk'));
    });

    test('marks duplicate active-thesis tickers without overwriting them', () => {
        const changes = [
            change({
                issuerName: 'APPLE INC',
                cusip: '037833100',
                ticker: 'AAPL',
                changeType: 'increased',
                materialityScore: 95,
                currentWeight: 0.35,
                weightDelta: 0.08,
            }),
        ];
        const [draft] = generateAlphaRadarThesisDrafts({
            changes,
            convictionItems: scoreAlphaRadarConviction({ changes }),
            reportPeriod: '2025-Q4',
            sourceFilingIds: ['filing-current'],
            existingThesisTickers: ['AAPL'],
        });

        assert.strictEqual(draft.duplicateOfExistingThesis, true);
        assert.match(draft.title, /Existing thesis review/);
        assert.match(draft.hypothesis, /not a replacement/);
        assert.strictEqual(draft.reviewStatus, 'needs-review');
    });

    test('filters low-conviction and unchanged ideas from generated drafts', () => {
        const changes = [
            change({
                issuerName: 'LOW SCORE INC',
                cusip: '123456789',
                ticker: 'LOWX',
                changeType: 'increased',
                materialityScore: 5,
                currentWeight: 0.001,
                weightDelta: 0.001,
                userRelevance: BASE_RELEVANCE,
            }),
            change({
                issuerName: 'UNCHANGED INC',
                cusip: '987654321',
                ticker: 'UNCH',
                changeType: 'unchanged',
                materialityScore: 100,
            }),
        ];

        assert.deepStrictEqual(generateAlphaRadarThesisDrafts({
            changes,
            convictionItems: scoreAlphaRadarConviction({ changes }),
            reportPeriod: '2025-Q4',
            sourceFilingIds: ['filing-current'],
        }), []);
    });

    test('is deterministic for identical inputs', () => {
        const changes = [
            change({
                issuerName: 'NVIDIA CORP',
                cusip: '67066G104',
                ticker: 'NVDA',
                changeType: 'new',
            }),
        ];
        const input = {
            changes,
            convictionItems: scoreAlphaRadarConviction({ changes }),
            reportPeriod: '2025-Q4',
            sourceFilingIds: ['filing-current'],
            externalOverlays: [overlay('NVDA')],
        };

        assert.deepStrictEqual(generateAlphaRadarThesisDrafts(input), generateAlphaRadarThesisDrafts(input));
    });
});
