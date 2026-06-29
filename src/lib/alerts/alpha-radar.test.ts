import { describe, test } from 'node:test';
import assert from 'node:assert';
import { evaluateAlphaRadarAlerts, isAlphaRadarAlertMetric, isMarketAlertMetric } from './alpha-radar';
import type { AlertRule } from './types';
import type {
    AlphaRadarMemoChange,
    AlphaRadarReportRecord,
    AlphaRadarTrackedFilerRecord,
} from '@/lib/alpha-radar';

const filer: AlphaRadarTrackedFilerRecord = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Berkshire Hathaway',
    slug: 'berkshire-hathaway',
    cik: '0001067983',
    enabled: true,
};

const report: AlphaRadarReportRecord = {
    id: '22222222-2222-4222-8222-222222222222',
    trackedFilerId: filer.id,
    filingId: '33333333-3333-4333-8333-333333333333',
    reportPeriod: '2025-Q4',
    status: 'generated',
    title: 'Berkshire Hathaway Alpha Radar 2025-Q4',
    summary: 'Berkshire increased Chubb.',
    sections: [
        { id: 'summary', title: 'Summary', kind: 'summary', markdown: 'Berkshire increased Chubb.', changeIds: [] },
    ],
    markdown: 'Berkshire increased Chubb.',
    sourceFilingIds: ['33333333-3333-4333-8333-333333333333'],
    generatorVersion: 'deterministic-v1',
};

const baseRule: AlertRule = {
    id: 'alpha-overlap',
    name: 'Alpha Radar overlap score ≥ 80',
    metric: 'alpha_radar_user_overlap',
    comparator: 'gte',
    threshold: 80,
    enabled: true,
    rearm: 'always',
    source: 'alpha_radar',
    createdAt: '2026-05-13T09:00:00Z',
};

const baseChange: AlphaRadarMemoChange = {
    id: '44444444-4444-4444-8444-444444444444',
    trackedFilerId: filer.id,
    currentFilingId: report.filingId,
    reportPeriod: report.reportPeriod,
    changeType: 'increased',
    issuerName: 'CHUBB LTD',
    cusip: 'H1467J104',
    ticker: 'CB',
    currentValueUsd: 7_200_000_000,
    priorValueUsd: 5_800_000_000,
    valueDeltaUsd: 1_400_000_000,
    currentShares: 27_000_000,
    priorShares: 22_000_000,
    shareDelta: 5_000_000,
    currentWeight: 0.064,
    priorWeight: 0.048,
    weightDelta: 0.016,
    materialityScore: 92,
    userRelevance: {
        portfolio: false,
        watchlist: true,
        thesis: false,
        reasons: ['watchlist overlap'],
        matchedTickers: ['CB'],
        matchedCusips: [],
    },
    displayReason: 'Chubb was increased by roughly $1.4B.',
};

describe('Alpha Radar alert helpers', () => {
    test('identifies Alpha Radar metrics without misclassifying market metrics', () => {
        assert.strictEqual(isAlphaRadarAlertMetric('alpha_radar_large_add'), true);
        assert.strictEqual(isMarketAlertMetric('price'), true);
    });
});

describe('evaluateAlphaRadarAlerts', () => {
    test('fires user-overlap alerts with report-linked notification copy', () => {
        const triggers = evaluateAlphaRadarAlerts({
            rules: [baseRule],
            changes: [baseChange],
            reports: [report],
            filers: [filer],
            observedAt: '2026-05-13T14:30:00Z',
        });

        assert.strictEqual(triggers.length, 1);
        assert.strictEqual(triggers[0].source, 'alpha_radar');
        assert.strictEqual(triggers[0].observedValue, 92);
        assert.strictEqual(triggers[0].href, '/research?tab=alpha-radar');
        assert.match(triggers[0].message ?? '', /Berkshire Hathaway increased CHUBB LTD \(CB\)/);
        assert.strictEqual(triggers[0].alphaRadar?.reportId, report.id);
        assert.deepStrictEqual(triggers[0].alphaRadar?.relevanceReasons, ['watchlist overlap']);
    });

    test('dedupes repeated refreshes with stable filing/change trigger ids', () => {
        const first = evaluateAlphaRadarAlerts({
            rules: [baseRule],
            changes: [baseChange],
            reports: [report],
            filers: [filer],
            observedAt: '2026-05-13T14:30:00Z',
        });
        const second = evaluateAlphaRadarAlerts({
            rules: [baseRule],
            changes: [baseChange],
            reports: [report],
            filers: [filer],
            observedAt: '2026-05-13T16:30:00Z',
            existingTriggerIds: new Set(first.map((trigger) => trigger.id)),
        });

        assert.strictEqual(first.length, 1);
        assert.strictEqual(second.length, 0);
    });

    test('matches large trims and filters below-threshold scores', () => {
        const trimRule: AlertRule = {
            ...baseRule,
            id: 'alpha-trim',
            name: 'Alpha Radar trim score ≥ 90',
            metric: 'alpha_radar_large_trim',
            threshold: 90,
        };
        const trim: AlphaRadarMemoChange = {
            ...baseChange,
            changeType: 'decreased',
            materialityScore: 88,
            valueDeltaUsd: -1_000_000_000,
        };

        const triggers = evaluateAlphaRadarAlerts({
            rules: [trimRule],
            changes: [trim],
            reports: [report],
            filers: [filer],
            observedAt: '2026-05-13T14:30:00Z',
        });

        assert.strictEqual(triggers.length, 0);
    });
});
