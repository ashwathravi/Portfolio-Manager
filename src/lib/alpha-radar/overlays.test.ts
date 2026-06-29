import { describe, test } from 'node:test';
import assert from 'node:assert';
import type { AlphaRadarExternalOverlay } from './agent-contracts';
import type { AlphaRadarMemoChange } from './memo';
import {
    DisabledAlphaRadarOverlayProvider,
    FixtureAlphaRadarOverlayProvider,
    attachAlphaRadarOverlaysToIdeas,
    enrichAlphaRadarIdeasWithOverlays,
    filterAlphaRadarOverlayIdeas,
    getAlphaRadarOverlayFilters,
    type AlphaRadarOverlayProvider,
} from './overlays';

const BASE_RELEVANCE = {
    portfolio: false,
    watchlist: false,
    thesis: false,
    reasons: [] as string[],
    matchedTickers: [] as string[],
    matchedCusips: [] as string[],
};

function change(input: Partial<AlphaRadarMemoChange> & Pick<AlphaRadarMemoChange, 'issuerName' | 'cusip' | 'ticker' | 'changeType'>): AlphaRadarMemoChange {
    return {
        trackedFilerId: '11111111-1111-4111-8111-111111111111',
        reportPeriod: '2025-Q4',
        materialityScore: 80,
        userRelevance: BASE_RELEVANCE,
        displayReason: `${input.issuerName} ${input.changeType}`,
        ...input,
    };
}

function overlay(input: Partial<AlphaRadarExternalOverlay> & Pick<AlphaRadarExternalOverlay, 'kind' | 'issuerName' | 'ticker' | 'summary'>): AlphaRadarExternalOverlay {
    return {
        provider: 'fixture-provider',
        asOf: '2026-05-13',
        evidence: [{
            kind: 'external-overlay',
            id: `evidence-${input.ticker}`,
            title: `${input.ticker} provider citation`,
            citation: 'Fixture source',
        }],
        ...input,
    };
}

describe('Alpha Radar external overlays', () => {
    test('attaches cited fixture provider overlays to matching ideas', async () => {
        const changes = [
            change({
                issuerName: 'NVIDIA CORP',
                cusip: '67066G104',
                ticker: 'NVDA',
                changeType: 'new',
            }),
            change({
                issuerName: 'APPLE INC',
                cusip: '037833100',
                ticker: 'AAPL',
                changeType: 'decreased',
            }),
        ];
        const provider = new FixtureAlphaRadarOverlayProvider('theme-exposure', [
            overlay({
                kind: 'theme-exposure',
                issuerName: 'NVIDIA CORP',
                ticker: 'NVDA',
                summary: 'AI infrastructure exposure through accelerators and data center demand.',
            }),
        ]);

        const result = await enrichAlphaRadarIdeasWithOverlays({ changes, providers: [provider] });

        assert.strictEqual(result.providerResults[0].status, 'succeeded');
        assert.strictEqual(result.overlays.length, 1);
        assert.strictEqual(result.ideas.length, 1);
        assert.strictEqual(result.ideas[0].change.ticker, 'NVDA');
        assert.deepStrictEqual(getAlphaRadarOverlayFilters(result.ideas), ['all', 'theme-exposure', 'AI infrastructure']);
    });

    test('filters ideas by overlay kind and thematic token', () => {
        const ideas = attachAlphaRadarOverlaysToIdeas({
            changes: [
                change({
                    issuerName: 'NVIDIA CORP',
                    cusip: '67066G104',
                    ticker: 'NVDA',
                    changeType: 'new',
                }),
                change({
                    issuerName: 'CHUBB LTD',
                    cusip: 'H1467J104',
                    ticker: 'CB',
                    changeType: 'increased',
                }),
            ],
            overlays: [
                overlay({
                    kind: 'theme-exposure',
                    issuerName: 'NVIDIA CORP',
                    ticker: 'NVDA',
                    summary: 'AI infrastructure exposure through accelerator demand.',
                }),
                overlay({
                    kind: 'insider-activity',
                    issuerName: 'CHUBB LTD',
                    ticker: 'CB',
                    summary: 'Insider activity corroboration remained neutral-positive.',
                }),
            ],
        });

        assert.strictEqual(filterAlphaRadarOverlayIdeas(ideas, 'AI infrastructure').map((idea) => idea.change.ticker)[0], 'NVDA');
        assert.strictEqual(filterAlphaRadarOverlayIdeas(ideas, 'insider-activity').map((idea) => idea.change.ticker)[0], 'CB');
        assert.strictEqual(filterAlphaRadarOverlayIdeas(ideas, 'all').length, 2);
    });

    test('disabled providers return warnings without blocking core ideas', async () => {
        const result = await enrichAlphaRadarIdeasWithOverlays({
            changes: [
                change({
                    issuerName: 'APPLE INC',
                    cusip: '037833100',
                    ticker: 'AAPL',
                    changeType: 'increased',
                }),
            ],
            providers: [new DisabledAlphaRadarOverlayProvider('valuation')],
        });

        assert.strictEqual(result.providerResults[0].status, 'disabled');
        assert.strictEqual(result.overlays.length, 0);
        assert.strictEqual(result.ideas.length, 0);
        assert.match(result.warnings[0].code, /overlay_provider_disabled/);
    });

    test('provider failures are isolated and successful providers still enrich ideas', async () => {
        const failingProvider: AlphaRadarOverlayProvider = {
            id: 'broken-provider',
            label: 'Broken provider',
            kind: 'transcript-sentiment',
            async fetchOverlays() {
                throw new Error('upstream timeout');
            },
        };
        const workingProvider = new FixtureAlphaRadarOverlayProvider('valuation', [
            overlay({
                kind: 'valuation',
                issuerName: 'APPLE INC',
                ticker: 'AAPL',
                summary: 'Valuation overlay shows premium multiple versus mega-cap peer median.',
            }),
        ]);

        const result = await enrichAlphaRadarIdeasWithOverlays({
            changes: [
                change({
                    issuerName: 'APPLE INC',
                    cusip: '037833100',
                    ticker: 'AAPL',
                    changeType: 'increased',
                }),
            ],
            providers: [failingProvider, workingProvider],
        });

        assert.strictEqual(result.providerResults[0].status, 'failed');
        assert.strictEqual(result.providerResults[1].status, 'succeeded');
        assert.strictEqual(result.ideas.length, 1);
        assert.ok(result.warnings.some((warning) => warning.code === 'overlay_provider_failed'));
    });

    test('drops overlays that lack provider/source evidence', async () => {
        const provider = new FixtureAlphaRadarOverlayProvider('theme-exposure', [
            {
                provider: 'fixture-provider',
                kind: 'theme-exposure',
                issuerName: 'NVIDIA CORP',
                ticker: 'NVDA',
                summary: 'AI infrastructure exposure without a source should be dropped.',
                asOf: '2026-05-13',
                evidence: [],
            },
        ]);

        const result = await enrichAlphaRadarIdeasWithOverlays({
            changes: [
                change({
                    issuerName: 'NVIDIA CORP',
                    cusip: '67066G104',
                    ticker: 'NVDA',
                    changeType: 'new',
                }),
            ],
            providers: [provider],
        });

        assert.strictEqual(result.overlays.length, 0);
        assert.strictEqual(result.ideas.length, 0);
        assert.ok(result.warnings.some((warning) => warning.code === 'overlay_missing_citation'));
    });
});
