import { describe, test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
    computeQuarterlyHoldingChanges,
    type AlphaRadarDiffHolding,
    type ComputeQuarterlyChangesInput,
} from './diff';

const TRACKED_FILER_ID = '11111111-1111-4111-8111-111111111111';
const CURRENT_FILING_ID = '22222222-2222-4222-8222-222222222222';
const PRIOR_FILING_ID = '33333333-3333-4333-8333-333333333333';
const FIXTURE_DIR = 'src/lib/alpha-radar/fixtures';

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

function byCusip(changes: ReturnType<typeof computeQuarterlyHoldingChanges>, cusip: string) {
    const change = changes.find((item) => item.cusip === cusip);
    assert.ok(change, `Expected change for ${cusip}`);
    return change;
}

function loadJsonFixture<T>(filename: string): T {
    return JSON.parse(readFileSync(`${FIXTURE_DIR}/${filename}`, 'utf8')) as T;
}

function comparableChange(change: ReturnType<typeof computeQuarterlyHoldingChanges>[number]) {
    return JSON.parse(JSON.stringify({
        cusip: change.cusip,
        issuerName: change.issuerName,
        ticker: change.ticker,
        changeType: change.changeType,
        valueDeltaUsd: change.valueDeltaUsd,
        shareDelta: change.shareDelta,
        rankDelta: change.rankDelta,
        currentWeight: change.currentWeight,
        priorWeight: change.priorWeight,
        materialityScore: change.materialityScore,
        portfolio: change.userRelevance.portfolio,
        watchlist: change.userRelevance.watchlist,
        thesis: change.userRelevance.thesis,
        reasons: change.userRelevance.reasons,
    })) as Record<string, unknown>;
}

describe('computeQuarterlyHoldingChanges', () => {
    test('treats an empty prior quarter as new positions with weights and first-seen metadata', () => {
        const changes = computeQuarterlyHoldingChanges({
            trackedFilerId: TRACKED_FILER_ID,
            currentFilingId: CURRENT_FILING_ID,
            reportPeriod: '2025-Q4',
            currentHoldings: [
                holding('Apple Inc', '037833100', 'AAPL', 300_000_000, 10_000, 1),
                holding('Nvidia Corp', '67066G104', 'NVDA', 100_000_000, 2_000, 2),
            ],
            priorHoldings: [],
            userRelevance: {
                portfolioTickers: ['AAPL'],
                watchlistTickers: ['NVDA'],
            },
        });

        assert.strictEqual(changes.length, 2);
        assert.ok(changes.every((change) => change.changeType === 'new'));

        const apple = byCusip(changes, '037833100');
        assert.strictEqual(apple.currentWeight, 0.75);
        assert.strictEqual(apple.firstSeenReportPeriod, '2025-Q4');
        assert.strictEqual(apple.userRelevance.portfolio, true);
        assert.match(apple.displayReason, /New position/);

        const nvidia = byCusip(changes, '67066G104');
        assert.strictEqual(nvidia.currentWeight, 0.25);
        assert.strictEqual(nvidia.userRelevance.watchlist, true);
    });

    test('classifies unchanged holdings without inventing deltas', () => {
        const current = [holding('Apple Inc', '037833100', 'AAPL', 100_000_000, 5_000, 1)];
        const changes = computeQuarterlyHoldingChanges({
            trackedFilerId: TRACKED_FILER_ID,
            currentFilingId: CURRENT_FILING_ID,
            priorFilingId: PRIOR_FILING_ID,
            reportPeriod: '2025-Q4',
            currentHoldings: current,
            priorHoldings: current,
        });

        assert.strictEqual(changes.length, 1);
        assert.strictEqual(changes[0].changeType, 'unchanged');
        assert.strictEqual(changes[0].valueDeltaUsd, 0);
        assert.strictEqual(changes[0].shareDelta, 0);
        assert.strictEqual(changes[0].rankDelta, 0);
        assert.match(changes[0].displayReason, /unchanged/);
    });

    test('detects increased, decreased, exited, and new positions in the same quarter', () => {
        const changes = computeQuarterlyHoldingChanges({
            trackedFilerId: TRACKED_FILER_ID,
            currentFilingId: CURRENT_FILING_ID,
            priorFilingId: PRIOR_FILING_ID,
            reportPeriod: '2025-Q4',
            currentHoldings: [
                holding('Apple Inc', '037833100', 'AAPL', 150_000_000, 7_500, 1),
                holding('Microsoft Corp', '594918104', 'MSFT', 75_000_000, 1_000, 3),
                holding('Nvidia Corp', '67066G104', 'NVDA', 125_000_000, 2_000, 2),
            ],
            priorHoldings: [
                holding('Apple Inc', '037833100', 'AAPL', 100_000_000, 5_000, 2),
                holding('Microsoft Corp', '594918104', 'MSFT', 100_000_000, 1_500, 1),
                holding('Exxon Mobil Corp', '30231G102', 'XOM', 50_000_000, 800, 3),
            ],
            userRelevance: {
                portfolioTickers: ['MSFT'],
                thesisTickers: ['NVDA'],
            },
        });

        const apple = byCusip(changes, '037833100');
        assert.strictEqual(apple.changeType, 'increased');
        assert.strictEqual(apple.valueDeltaUsd, 50_000_000);
        assert.strictEqual(apple.shareDelta, 2_500);
        assert.strictEqual(apple.rankDelta, 1);

        const microsoft = byCusip(changes, '594918104');
        assert.strictEqual(microsoft.changeType, 'decreased');
        assert.strictEqual(microsoft.valueDeltaUsd, -25_000_000);
        assert.strictEqual(microsoft.userRelevance.portfolio, true);
        assert.match(microsoft.displayReason, /held in portfolio/);

        const nvidia = byCusip(changes, '67066G104');
        assert.strictEqual(nvidia.changeType, 'new');
        assert.strictEqual(nvidia.userRelevance.thesis, true);

        const exxon = byCusip(changes, '30231G102');
        assert.strictEqual(exxon.changeType, 'exited');
        assert.strictEqual(exxon.lastSeenReportPeriod, '2025-Q4');
        assert.strictEqual(exxon.currentValueUsd, undefined);
    });

    test('matches the representative fixture expected diff output', () => {
        const input = loadJsonFixture<ComputeQuarterlyChangesInput>('berkshire-2025q4-diff-input.json');
        const expected = loadJsonFixture<Array<Record<string, unknown>>>('berkshire-2025q4-expected-changes.json');

        const changes = computeQuarterlyHoldingChanges(input);

        assert.deepStrictEqual(changes.map(comparableChange), expected);
    });

    test('supports amended rows as a distinct change type', () => {
        const changes = computeQuarterlyHoldingChanges({
            trackedFilerId: TRACKED_FILER_ID,
            currentFilingId: CURRENT_FILING_ID,
            priorFilingId: PRIOR_FILING_ID,
            reportPeriod: '2025-Q4',
            currentHoldings: [holding('Apple Inc', '037833100', 'AAPL', 110_000_000, 5_200, 1)],
            priorHoldings: [holding('Apple Inc', '037833100', 'AAPL', 100_000_000, 5_000, 1)],
            amendedCusips: ['037833100'],
        });

        assert.strictEqual(changes[0].changeType, 'amended');
        assert.match(changes[0].displayReason, /Amended/);
        assert.ok(changes[0].materialityScore > 0);
    });

    test('uses deterministic tie-breaking after materiality and delta comparisons', () => {
        const changes = computeQuarterlyHoldingChanges({
            trackedFilerId: TRACKED_FILER_ID,
            currentFilingId: CURRENT_FILING_ID,
            reportPeriod: '2025-Q4',
            currentHoldings: [
                holding('Beta Corp', '111111111', 'BET', 50_000_000, 100),
                holding('Alpha Corp', '222222222', 'ALP', 50_000_000, 100),
            ],
            priorHoldings: [],
        });

        assert.deepStrictEqual(changes.map((change) => change.issuerName), ['Alpha Corp', 'Beta Corp']);
    });

    test('flags direct user relevance by CUSIP even when ticker is unknown', () => {
        const changes = computeQuarterlyHoldingChanges({
            trackedFilerId: TRACKED_FILER_ID,
            currentFilingId: CURRENT_FILING_ID,
            reportPeriod: '2025-Q4',
            currentHoldings: [{ issuerName: 'Private-ish Holding', cusip: '123456789', valueUsd: 10_000_000, shares: 10 }],
            priorHoldings: [],
            userRelevance: {
                portfolioCusips: ['123456789'],
            },
        });

        assert.strictEqual(changes[0].userRelevance.portfolio, true);
        assert.deepStrictEqual(changes[0].userRelevance.matchedCusips, ['123456789']);
        assert.match(changes[0].displayReason, /held in portfolio/);
    });
});
