import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AlertTrigger } from '@/lib/alerts/types';
import {
    createDefaultAlphaRadarDeliveryPreferences,
    createDefaultAlphaRadarSchedules,
    createAlphaRadarSchedulerJob,
    getAlphaRadarScheduleWindowKey,
    isAlphaRadarScheduleDue,
    planAlphaRadarDeliveries,
    planAlphaRadarScheduledRuns,
    summarizeAlphaRadarRunHistory,
    type AlphaRadarScheduledRunRecord,
} from './scheduler';

describe('Alpha Radar scheduler', () => {
    test('queues weekly and quarterly refresh operations with stable idempotency keys', () => {
        const schedules = createDefaultAlphaRadarSchedules();
        const plan = planAlphaRadarScheduledRuns({
            schedules,
            now: '2026-05-15T16:00:00.000Z',
        });

        assert.equal(plan.dueRuns.length, 2);
        assert.equal(plan.result.enqueuedJobs.length, 10);
        assert.ok(plan.dueRuns.every((run) => run.status === 'queued'));

        const duplicate = planAlphaRadarScheduledRuns({
            schedules,
            now: '2026-05-15T17:00:00.000Z',
            existingIdempotencyKeys: new Set(plan.dueRuns.map((run) => run.idempotencyKey)),
        });

        assert.equal(duplicate.dueRuns.length, 0);
        assert.equal(duplicate.skippedRuns.length, 2);
        assert.ok(duplicate.result.skippedJobs.every((job) => job.reason === 'deduped-window'));
    });

    test('does not mark a scheduled run due before its configured clock', () => {
        const [weekly] = createDefaultAlphaRadarSchedules();

        assert.equal(isAlphaRadarScheduleDue(weekly, '2026-05-15T13:59:00.000Z'), false);
        assert.equal(isAlphaRadarScheduleDue(weekly, '2026-05-15T14:30:00.000Z'), true);
    });

    test('uses 13F availability lag for quarterly schedule windows', () => {
        assert.equal(getAlphaRadarScheduleWindowKey('quarterly', '2026-05-14T16:00:00.000Z'), '2025-Q4');
        assert.equal(getAlphaRadarScheduleWindowKey('quarterly', '2026-05-16T16:00:00.000Z'), '2026-Q1');
        assert.equal(getAlphaRadarScheduleWindowKey('quarterly', '2026-04-10T16:00:00.000Z'), '2025-Q4');

        const [weekly] = createDefaultAlphaRadarSchedules();
        const schedulerJob = createAlphaRadarSchedulerJob(
            { ...weekly, cadence: 'quarterly', id: 'quarterly-test' },
            '2026-05-16T16:00:00.000Z',
        );

        assert.equal(schedulerJob.agent, 'scheduler-agent');
        assert.equal(schedulerJob.operation, 'schedule-refresh');
        assert.equal(schedulerJob.payload.cadence, 'quarterly');
        assert.match(schedulerJob.idempotencyKey, /2026-q1/);
    });

    test('plans in-app delivery and suppresses unconfigured external channels', () => {
        const trigger = createTrigger({
            id: 'trigger-aapl',
            ticker: 'AAPL',
            materialityScore: 92,
            relevanceReasons: ['portfolio overlap'],
        });
        const preferences = createDefaultAlphaRadarDeliveryPreferences();

        const plan = planAlphaRadarDeliveries({
            preferences,
            triggers: [trigger],
        });

        assert.equal(plan.deliveries.length, 1);
        assert.equal(plan.deliveries[0].channel, 'in-app');
        assert.equal(plan.deliveries[0].status, 'planned');
        assert.ok(plan.suppressed.some((item) => item.channel === 'email' && item.reason === 'channel-disabled'));
    });

    test('applies ticker, overlap, materiality, destination, and delivery dedupe filters', () => {
        const triggers = [
            createTrigger({
                id: 'trigger-aapl',
                ticker: 'AAPL',
                materialityScore: 92,
                relevanceReasons: ['active thesis'],
            }),
            createTrigger({
                id: 'trigger-dpz',
                ticker: 'DPZ',
                materialityScore: 72,
                relevanceReasons: [],
            }),
        ];
        const plan = planAlphaRadarDeliveries({
            preferences: [
                {
                    channel: 'slack',
                    enabled: true,
                    destination: '#alpha-radar',
                    failureSummaries: true,
                    filter: {
                        tickers: ['AAPL'],
                        overlapOnly: true,
                        minMaterialityScore: 80,
                    },
                },
                {
                    channel: 'email',
                    enabled: true,
                    failureSummaries: true,
                    filter: {
                        minMaterialityScore: 80,
                    },
                },
            ],
            triggers,
            existingDeliveryKeys: new Set(['alpha-radar-delivery:slack:trigger-aapl']),
        });

        assert.equal(plan.deliveries.length, 0);
        assert.ok(plan.suppressed.some((item) => item.channel === 'slack' && item.reason === 'delivery-deduped'));
        assert.ok(plan.suppressed.some((item) => item.channel === 'slack' && item.reason === 'below-materiality-threshold'));
        assert.ok(plan.suppressed.some((item) => item.channel === 'email' && item.reason === 'missing-destination'));
    });

    test('summarizes failed run history into one actionable status without duplicate spam', () => {
        const schedules = createDefaultAlphaRadarSchedules();
        const failure: AlphaRadarScheduledRunRecord = {
            id: 'failed-weekly',
            scheduleId: schedules[0].id,
            scheduleName: schedules[0].name,
            cadence: 'weekly',
            windowKey: '2026-W20',
            status: 'failed',
            idempotencyKey: 'failed-key',
            requestedAt: '2026-05-13T14:30:00.000Z',
            attempt: 1,
            queuedJobs: [],
            failureSummary: 'SEC provider timed out.',
            error: {
                code: 'timeout',
                message: 'SEC provider timed out.',
                retryable: true,
            },
        };

        const summary = summarizeAlphaRadarRunHistory([failure]);

        assert.equal(summary.openFailures.length, 1);
        assert.equal(summary.retryableFailureCount, 1);
        assert.equal(summary.actionableStatus, '1 scheduled Alpha Radar run need review.');
    });
});

function createTrigger(input: {
    id: string;
    ticker: string;
    materialityScore: number;
    relevanceReasons: string[];
}): AlertTrigger {
    return {
        id: input.id,
        ruleId: 'rule-alpha-radar',
        ruleName: 'Alpha Radar signal',
        metric: 'alpha_radar_user_overlap',
        comparator: 'gte',
        threshold: 75,
        observedValue: input.materialityScore,
        triggeredAt: '2026-05-13T16:00:00.000Z',
        acknowledged: false,
        source: 'alpha_radar',
        message: `${input.ticker} Alpha Radar signal`,
        alphaRadar: {
            trackedFilerId: 'filer-berkshire',
            filerName: 'Berkshire Hathaway',
            reportPeriod: '2026-Q1',
            issuerName: `${input.ticker} issuer`,
            ticker: input.ticker,
            cusip: '000000000',
            changeType: 'increased',
            materialityScore: input.materialityScore,
            relevanceReasons: input.relevanceReasons,
        },
    };
}
