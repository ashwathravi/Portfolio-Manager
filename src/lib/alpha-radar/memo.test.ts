import { describe, test } from 'node:test';
import assert from 'node:assert';
import { alphaRadarReportSchema } from '@/lib/validators/alpha-radar';
import { computeQuarterlyHoldingChanges, type AlphaRadarDiffHolding } from './diff';
import {
    ALPHA_RADAR_DETERMINISTIC_MEMO_VERSION,
    DeterministicAlphaRadarMemoAdapter,
    generateAlphaRadarMemo,
    type AlphaRadarMemoChange,
} from './memo';

const TRACKED_FILER_ID = '11111111-1111-4111-8111-111111111111';
const CURRENT_FILING_ID = '22222222-2222-4222-8222-222222222222';
const PRIOR_FILING_ID = '33333333-3333-4333-8333-333333333333';
const CHANGE_ID = '44444444-4444-4444-8444-444444444444';
const SECOND_CHANGE_ID = '55555555-5555-4555-8555-555555555555';

function holding(
    issuerName: string,
    cusip: string,
    ticker: string,
    valueUsd: number,
    shares: number,
    positionRank?: number,
): AlphaRadarDiffHolding {
    return { issuerName, cusip, ticker, valueUsd, shares, positionRank };
}

function sampleChanges(): AlphaRadarMemoChange[] {
    const changes = computeQuarterlyHoldingChanges({
        trackedFilerId: TRACKED_FILER_ID,
        currentFilingId: CURRENT_FILING_ID,
        priorFilingId: PRIOR_FILING_ID,
        reportPeriod: '2025-Q4',
        currentHoldings: [
            holding('Apple Inc', '037833100', 'AAPL', 150_000_000, 7_500, 1),
            holding('Nvidia Corp', '67066G104', 'NVDA', 125_000_000, 2_000, 2),
            holding('Microsoft Corp', '594918104', 'MSFT', 75_000_000, 1_000, 3),
        ],
        priorHoldings: [
            holding('Apple Inc', '037833100', 'AAPL', 100_000_000, 5_000, 2),
            holding('Microsoft Corp', '594918104', 'MSFT', 100_000_000, 1_500, 1),
            holding('Exxon Mobil Corp', '30231G102', 'XOM', 50_000_000, 800, 3),
        ],
        userRelevance: {
            portfolioTickers: ['MSFT'],
            watchlistTickers: ['NVDA'],
            thesisTickers: ['AAPL'],
        },
    });

    return changes.map((change, index) => ({
        ...change,
        id: index === 0 ? CHANGE_ID : index === 1 ? SECOND_CHANGE_ID : undefined,
    }));
}

describe('generateAlphaRadarMemo', () => {
    test('generates validated report JSON plus markdown sections for standard changes', () => {
        const report = generateAlphaRadarMemo({
            trackedFilerId: TRACKED_FILER_ID,
            filingId: CURRENT_FILING_ID,
            filerName: 'Berkshire Hathaway',
            reportPeriod: '2025-Q4',
            sourceFilingIds: [CURRENT_FILING_ID, PRIOR_FILING_ID],
            changes: sampleChanges(),
        });

        assert.strictEqual(report.generatorVersion, ALPHA_RADAR_DETERMINISTIC_MEMO_VERSION);
        assert.strictEqual(report.title, 'Berkshire Hathaway Alpha Radar 2025-Q4');
        assert.strictEqual(alphaRadarReportSchema.safeParse(report).success, true);
        assert.ok(report.summary.includes('Top signal'));
        assert.ok(report.markdown.includes('# Berkshire Hathaway Alpha Radar 2025-Q4'));
        assert.ok(report.markdown.includes('Source filings'));
        assert.deepStrictEqual(
            report.sections.map((section) => section.kind),
            ['summary', 'top_adds', 'trims', 'exits', 'new_positions', 'overlap', 'watch_next', 'risks'],
        );
        assert.ok(report.sections.some((section) => section.changeIds.includes(CHANGE_ID)));
    });

    test('renders user-overlap callouts without requiring prose parsing', () => {
        const report = generateAlphaRadarMemo({
            trackedFilerId: TRACKED_FILER_ID,
            filingId: CURRENT_FILING_ID,
            filerName: 'Berkshire Hathaway',
            reportPeriod: '2025-Q4',
            sourceFilingIds: [CURRENT_FILING_ID],
            changes: sampleChanges(),
        });

        const overlap = report.sections.find((section) => section.kind === 'overlap');
        assert.ok(overlap);
        assert.match(overlap.markdown, /Held in portfolio|On watchlist|Linked to active thesis/);
        assert.ok(overlap.changeIds.length > 0);
    });

    test('handles no-change reports deterministically', () => {
        const unchanged = computeQuarterlyHoldingChanges({
            trackedFilerId: TRACKED_FILER_ID,
            currentFilingId: CURRENT_FILING_ID,
            priorFilingId: PRIOR_FILING_ID,
            reportPeriod: '2025-Q4',
            currentHoldings: [holding('Apple Inc', '037833100', 'AAPL', 100_000_000, 5_000, 1)],
            priorHoldings: [holding('Apple Inc', '037833100', 'AAPL', 100_000_000, 5_000, 1)],
        });

        const report = generateAlphaRadarMemo({
            trackedFilerId: TRACKED_FILER_ID,
            filerName: 'Berkshire Hathaway',
            reportPeriod: '2025-Q4',
            sourceFilingIds: [CURRENT_FILING_ID, PRIOR_FILING_ID],
            changes: unchanged,
        });

        assert.match(report.summary, /no material quarter-over-quarter/);
        assert.match(report.sections.find((section) => section.kind === 'watch_next')?.markdown ?? '', /next filing/);
    });

    test('handles empty parsed data without network or AI dependencies', () => {
        const report = generateAlphaRadarMemo({
            trackedFilerId: TRACKED_FILER_ID,
            filerName: 'Empty Filer',
            reportPeriod: '2025-Q4',
            sourceFilingIds: [CURRENT_FILING_ID],
            changes: [],
        });

        assert.match(report.summary, /no parsed 13F holdings/);
        assert.match(report.sections.find((section) => section.kind === 'top_adds')?.markdown ?? '', /No material adds/);
        assert.ok(report.markdown.length > 0);
    });

    test('future adapter boundary delegates to the deterministic generator in v1', async () => {
        const adapter = new DeterministicAlphaRadarMemoAdapter();
        const report = await adapter.generate({
            trackedFilerId: TRACKED_FILER_ID,
            filingId: CURRENT_FILING_ID,
            filerName: 'Berkshire Hathaway',
            reportPeriod: '2025-Q4',
            sourceFilingIds: [CURRENT_FILING_ID],
            changes: sampleChanges(),
            generatorVersion: 'deterministic-test',
        });

        assert.strictEqual(report.generatorVersion, 'deterministic-test');
        assert.strictEqual(alphaRadarReportSchema.safeParse(report).success, true);
    });
});
