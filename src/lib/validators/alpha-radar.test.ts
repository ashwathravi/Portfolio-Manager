import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ALPHA_RADAR_SEED_FILERS } from '../alpha-radar/seed';
import {
    alphaRadarFilingHoldingSchema,
    alphaRadarHoldingChangeSchema,
    alphaRadarListLimitSchema,
    alphaRadarMemorySearchQuerySchema,
    alphaRadarReportSchema,
    alphaRadarRefreshRequestSchema,
    alphaRadarSecFilingBatchSchema,
    alphaRadarTrackedFilerListSchema,
    alphaRadarTrackedFilerSchema,
} from './alpha-radar';

const FILER_ID = '11111111-1111-4111-8111-111111111111';
const FILING_ID = '22222222-2222-4222-8222-222222222222';
const PRIOR_FILING_ID = '33333333-3333-4333-8333-333333333333';
const CHANGE_ID = '44444444-4444-4444-8444-444444444444';

describe('alphaRadarTrackedFilerSchema', () => {
    test('accepts a valid tracked filer and normalizes CIK', () => {
        const result = alphaRadarTrackedFilerSchema.safeParse({
            name: 'Berkshire Hathaway Inc',
            slug: 'berkshire-hathaway',
            cik: '1067983',
            fundStyle: 'quality-value',
        });

        assert.strictEqual(result.success, true);
        if (result.success) {
            assert.strictEqual(result.data.cik, '0001067983');
            assert.strictEqual(result.data.enabled, true);
        }
    });

    test('rejects invalid slug and unsafe text', () => {
        assert.strictEqual(alphaRadarTrackedFilerSchema.safeParse({
            name: 'Bridgewater',
            slug: 'Bridgewater Associates',
            cik: '0001350694',
        }).success, false);

        assert.strictEqual(alphaRadarTrackedFilerSchema.safeParse({
            name: '<script>bad</script>',
            slug: 'bad-filer',
            cik: '0001350694',
        }).success, false);
    });

    test('rejects duplicate filer slug and CIK in a batch', () => {
        const result = alphaRadarTrackedFilerListSchema.safeParse([
            { name: 'A', slug: 'same', cik: '1' },
            { name: 'B', slug: 'same', cik: '0000000001' },
        ]);

        assert.strictEqual(result.success, false);
        if (!result.success) {
            assert.ok(result.error.issues.some((issue) => issue.message.includes('Duplicate tracked filer slug')));
            assert.ok(result.error.issues.some((issue) => issue.message.includes('Duplicate tracked filer CIK')));
        }
    });
});

describe('alphaRadarSecFilingBatchSchema', () => {
    const filing = {
        trackedFilerId: FILER_ID,
        cik: '0001067983',
        accessionNumber: '0000950123-26-000001',
        filingType: '13F-HR' as const,
        reportPeriod: '2025-Q4',
        filedAt: '2026-02-14T00:00:00.000Z',
        primaryDocumentUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/filing.txt',
    };

    test('accepts a valid filing identity', () => {
        const result = alphaRadarSecFilingBatchSchema.safeParse([filing]);
        assert.strictEqual(result.success, true);
    });

    test('rejects duplicate accession and duplicate filer period type', () => {
        const result = alphaRadarSecFilingBatchSchema.safeParse([
            filing,
            { ...filing },
        ]);

        assert.strictEqual(result.success, false);
        if (!result.success) {
            assert.ok(result.error.issues.some((issue) => issue.message.includes('Duplicate accession number')));
            assert.ok(result.error.issues.some((issue) => issue.message.includes('Duplicate filer/period/type')));
        }
    });
});

describe('alphaRadarFilingHoldingSchema', () => {
    test('accepts normalized holding values at numeric boundaries', () => {
        const result = alphaRadarFilingHoldingSchema.safeParse({
            filingId: FILING_ID,
            issuerName: 'Apple Inc',
            cusip: '037833100',
            ticker: 'aapl',
            valueUsd: 0,
            shares: 0,
            positionRank: 1,
        });

        assert.strictEqual(result.success, true);
        if (result.success) {
            assert.strictEqual(result.data.ticker, 'AAPL');
            assert.strictEqual(result.data.cusip, '037833100');
        }
    });

    test('rejects negative values and malformed CUSIPs', () => {
        assert.strictEqual(alphaRadarFilingHoldingSchema.safeParse({
            filingId: FILING_ID,
            issuerName: 'Apple Inc',
            cusip: 'BAD',
            valueUsd: 10,
            shares: 1,
        }).success, false);

        assert.strictEqual(alphaRadarFilingHoldingSchema.safeParse({
            filingId: FILING_ID,
            issuerName: 'Apple Inc',
            cusip: '037833100',
            valueUsd: -1,
            shares: 1,
        }).success, false);
    });
});

describe('alphaRadarHoldingChangeSchema', () => {
    const base = {
        trackedFilerId: FILER_ID,
        reportPeriod: '2025-Q4',
        issuerName: 'Apple Inc',
        cusip: '037833100',
        ticker: 'AAPL',
        materialityScore: 80,
    };

    test('represents each supported change state', () => {
        const cases = [
            { changeType: 'new', currentValueUsd: 100, currentShares: 10, currentFilingId: FILING_ID },
            { changeType: 'exited', priorValueUsd: 100, priorShares: 10, priorFilingId: PRIOR_FILING_ID },
            { changeType: 'increased', currentValueUsd: 150, priorValueUsd: 100, valueDeltaUsd: 50 },
            { changeType: 'decreased', currentValueUsd: 80, priorValueUsd: 100, valueDeltaUsd: -20 },
            { changeType: 'unchanged', currentValueUsd: 100, priorValueUsd: 100, valueDeltaUsd: 0 },
            { changeType: 'amended', currentValueUsd: 120, priorValueUsd: 100, valueDeltaUsd: 20 },
        ] as const;

        for (const item of cases) {
            const result = alphaRadarHoldingChangeSchema.safeParse({ ...base, ...item });
            assert.strictEqual(result.success, true, `${item.changeType} should be valid`);
        }
    });

    test('enforces current and prior value requirements by change type', () => {
        const newWithoutCurrent = alphaRadarHoldingChangeSchema.safeParse({
            ...base,
            changeType: 'new',
        });
        assert.strictEqual(newWithoutCurrent.success, false);

        const exitedWithoutPrior = alphaRadarHoldingChangeSchema.safeParse({
            ...base,
            changeType: 'exited',
        });
        assert.strictEqual(exitedWithoutPrior.success, false);
    });

    test('rejects impossible weights', () => {
        const result = alphaRadarHoldingChangeSchema.safeParse({
            ...base,
            changeType: 'increased',
            currentValueUsd: 150,
            priorValueUsd: 100,
            currentWeight: 1.5,
        });
        assert.strictEqual(result.success, false);
    });

    test('accepts user relevance metadata for downstream alerts and UI', () => {
        const result = alphaRadarHoldingChangeSchema.safeParse({
            ...base,
            changeType: 'increased',
            currentValueUsd: 150,
            priorValueUsd: 100,
            userRelevance: {
                portfolio: true,
                watchlist: true,
                thesis: false,
                reasons: ['Held in portfolio', 'On watchlist'],
                matchedTickers: ['aapl'],
                matchedCusips: ['037833100'],
            },
        });

        assert.strictEqual(result.success, true);
        if (result.success) {
            assert.strictEqual(result.data.userRelevance?.portfolio, true);
            assert.deepStrictEqual(result.data.userRelevance?.matchedTickers, ['AAPL']);
        }
    });
});

describe('alphaRadarReportSchema', () => {
    test('accepts a structured report with sections and source filings', () => {
        const result = alphaRadarReportSchema.safeParse({
            trackedFilerId: FILER_ID,
            filingId: FILING_ID,
            reportPeriod: '2025-Q4',
            title: 'Berkshire Q4 Alpha Radar',
            summary: 'Berkshire added to Apple and trimmed Chevron.',
            sections: [
                {
                    id: 'summary',
                    title: 'Summary',
                    kind: 'summary',
                    markdown: 'Berkshire changed several top positions.',
                    changeIds: [CHANGE_ID],
                },
            ],
            markdown: 'Berkshire changed several top positions.',
            sourceFilingIds: [FILING_ID],
        });

        assert.strictEqual(result.success, true);
    });

    test('requires source filings and at least one section', () => {
        const result = alphaRadarReportSchema.safeParse({
            trackedFilerId: FILER_ID,
            reportPeriod: '2025-Q4',
            title: 'Empty',
            summary: 'No data.',
            sections: [],
            markdown: 'No data.',
            sourceFilingIds: [],
        });

        assert.strictEqual(result.success, false);
    });
});

describe('ALPHA_RADAR_SEED_FILERS', () => {
    test('contains the required seed filer set and validates as a unique batch', () => {
        const result = alphaRadarTrackedFilerListSchema.safeParse(ALPHA_RADAR_SEED_FILERS);
        assert.strictEqual(result.success, true);

        const names = new Set(ALPHA_RADAR_SEED_FILERS.map((filer) => filer.name));
        assert.ok(names.has('Berkshire Hathaway Inc'));
        assert.ok(names.has('Bridgewater Associates, LP'));
        assert.ok(names.has('Altimeter Capital Management, LP'));
        assert.ok(names.has('Coatue Management LLC'));
        assert.ok(names.has('ARK Investment Management LLC'));
        assert.ok(names.has('Pershing Square Capital Management, L.P.'));
    });
});

describe('Alpha Radar API bounds', () => {
    test('caps list limits', () => {
        assert.strictEqual(alphaRadarListLimitSchema.safeParse('250').success, true);
        assert.strictEqual(alphaRadarListLimitSchema.safeParse('251').success, false);
        assert.strictEqual(alphaRadarListLimitSchema.safeParse('0').success, false);
    });

    test('bounds refresh filing limits', () => {
        assert.strictEqual(alphaRadarRefreshRequestSchema.safeParse({ force: true, filingLimit: 20 }).success, true);
        assert.strictEqual(alphaRadarRefreshRequestSchema.safeParse({ filingLimit: 21 }).success, false);
        assert.strictEqual(alphaRadarRefreshRequestSchema.safeParse({ filingLimit: 0 }).success, false);
    });

    test('validates semantic memory search filters', () => {
        const result = alphaRadarMemorySearchQuerySchema.safeParse({
            query: 'AI infrastructure',
            limit: '10',
            trackedFilerId: FILER_ID,
            reportPeriod: '2025-Q4',
        });

        assert.strictEqual(result.success, true);
        if (result.success) {
            assert.strictEqual(result.data.limit, 10);
            assert.strictEqual(result.data.query, 'AI infrastructure');
        }

        assert.strictEqual(alphaRadarMemorySearchQuerySchema.safeParse({ query: '<script>', limit: 5 }).success, false);
        assert.strictEqual(alphaRadarMemorySearchQuerySchema.safeParse({ query: 'AI', limit: 26 }).success, false);
    });
});
