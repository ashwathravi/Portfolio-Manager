import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    AlphaRadarProviderBudgetError,
    createDefaultAlphaRadarProviderBudgets,
    enforceAlphaRadarProviderBudget,
    evaluateAlphaRadarProviderBudget,
    getAlphaRadarDeploymentRequirements,
    mapOperationToProvider,
    planAlphaRadarMaintenanceAction,
    recordAlphaRadarProviderOutcome,
    summarizeAlphaRadarOperationalHealth,
    type AlphaRadarOperationalEvent,
    type AlphaRadarProviderUsage,
} from './operations';
import type { AlphaRadarRefreshRunResult } from './refresh';
import type { AlphaRadarScheduledRunRecord } from './scheduler';

describe('Alpha Radar operations', () => {
    test('warns and throttles provider budgets before external calls', () => {
        const [secBudget] = createDefaultAlphaRadarProviderBudgets({
            target: 'local',
            now: '2026-05-13T10:00:00.000Z',
        });

        const warning = evaluateAlphaRadarProviderBudget({
            budget: secBudget,
            usage: usage({ provider: 'sec-edgar', used: 30 }),
            now: '2026-05-13T10:01:00.000Z',
        });
        assert.equal(warning.status, 'warn');
        assert.equal(warning.remaining, 10);

        const blocked = evaluateAlphaRadarProviderBudget({
            budget: secBudget,
            usage: usage({ provider: 'sec-edgar', used: 40 }),
            now: '2026-05-13T10:02:00.000Z',
        });
        assert.equal(blocked.status, 'throttled');
        assert.equal(blocked.nextRetryAt, '2026-05-14T00:00:00.000Z');

        assert.throws(
            () => enforceAlphaRadarProviderBudget({ budget: secBudget, usage: usage({ provider: 'sec-edgar', used: 41 }) }),
            AlphaRadarProviderBudgetError,
        );
    });

    test('opens circuit breakers and resets consecutive failures after success', () => {
        const [secBudget] = createDefaultAlphaRadarProviderBudgets({
            now: '2026-05-13T10:00:00.000Z',
        });
        let state = usage({ provider: 'sec-edgar', used: 0 });
        state = recordAlphaRadarProviderOutcome({
            provider: 'sec-edgar',
            previous: state,
            status: 'failed',
            latencyMs: 900,
            occurredAt: '2026-05-13T10:00:00.000Z',
        });
        state = recordAlphaRadarProviderOutcome({
            provider: 'sec-edgar',
            previous: state,
            status: 'failed',
            latencyMs: 1_100,
            occurredAt: '2026-05-13T10:01:00.000Z',
        });
        state = recordAlphaRadarProviderOutcome({
            provider: 'sec-edgar',
            previous: state,
            status: 'failed',
            latencyMs: 1_300,
            occurredAt: '2026-05-13T10:02:00.000Z',
        });

        const open = evaluateAlphaRadarProviderBudget({
            budget: secBudget,
            usage: state,
            now: '2026-05-13T10:03:00.000Z',
        });

        assert.equal(open.status, 'circuit-open');
        assert.equal(open.nextRetryAt, '2026-05-13T10:17:00.000Z');
        assert.equal(state.averageLatencyMs, 1_100);

        const recovered = recordAlphaRadarProviderOutcome({
            provider: 'sec-edgar',
            previous: state,
            status: 'succeeded',
            latencyMs: 500,
            occurredAt: '2026-05-13T10:20:00.000Z',
        });
        assert.equal(recovered.consecutiveFailures, 0);
        assert.equal(recovered.failures, 3);
    });

    test('summarizes operator health with failures, retries, and provider status', () => {
        const health = summarizeAlphaRadarOperationalHealth({
            generatedAt: '2026-05-13T12:00:00.000Z',
            refreshRuns: [refreshRun()],
            scheduledRuns: [failedScheduledRun()],
            events: [
                event({ id: 'memo-failure', component: 'memo', status: 'failed', retryable: true }),
                event({ id: 'notifier-failure', component: 'notifier', status: 'failed', retryable: false }),
            ],
            providerDecisions: [{
                provider: 'sec-edgar',
                label: 'SEC EDGAR',
                status: 'warn',
                used: 32,
                limit: 40,
                remaining: 8,
                window: 'day',
                resetAt: '2026-05-14T00:00:00.000Z',
                reasons: ['32/40 day budget used.'],
                averageLatencyMs: 900,
            }],
        });

        assert.equal(health.status, 'degraded');
        assert.equal(health.lastRun?.id, 'scheduled-failure');
        assert.equal(health.counts.ingestionFetched, 3);
        assert.equal(health.counts.filingsParsed, 1);
        assert.equal(health.counts.parseFailures, 1);
        assert.equal(health.counts.memoFailures, 1);
        assert.equal(health.counts.notificationFailures, 1);
        assert.equal(health.providerStatus.warnedProviders, 1);
        assert.ok(health.retryActions.some((action) => action.source === 'scheduled-run' && action.retryable));
        assert.ok(health.retryActions.some((action) => action.id === 'retry-memo-failure'));
        assert.ok(health.actionableItems.some((item) => /retry action/i.test(item)));
    });

    test('requires confirmation for destructive maintenance but allows dry runs', () => {
        const dryRun = planAlphaRadarMaintenanceAction({
            action: 'delete-parsed-output',
            scope: { kind: 'tracked-filer', trackedFilerId: 'filer-berkshire' },
            reportPeriod: '2026-Q1',
            requestedBy: 'operator',
            reason: 'Bad information table parse',
        });

        assert.equal(dryRun.status, 'ready');
        assert.equal(dryRun.dryRun, true);
        assert.equal(dryRun.destructive, true);
        assert.equal(dryRun.requiresConfirmation, false);

        const blocked = planAlphaRadarMaintenanceAction({
            action: 'delete-parsed-output',
            scope: { kind: 'tracked-filer', trackedFilerId: 'filer-berkshire' },
            reportPeriod: '2026-Q1',
            requestedBy: 'operator',
            reason: 'Bad information table parse',
            dryRun: false,
        });

        assert.equal(blocked.status, 'blocked');
        assert.equal(blocked.requiresConfirmation, true);
        assert.equal(blocked.confirmationToken, 'DELETE_PARSED_OUTPUT:tracked-filer:filer-berkshire:2026-Q1');

        const confirmed = planAlphaRadarMaintenanceAction({
            action: 'delete-parsed-output',
            scope: { kind: 'tracked-filer', trackedFilerId: 'filer-berkshire' },
            reportPeriod: '2026-Q1',
            requestedBy: 'operator',
            reason: 'Bad information table parse',
            dryRun: false,
            confirmationToken: blocked.confirmationToken,
        });

        assert.equal(confirmed.status, 'ready');
    });

    test('captures deployment requirements and provider mapping', () => {
        const productionRequirements = getAlphaRadarDeploymentRequirements('production');
        assert.ok(productionRequirements.some((requirement) => requirement.key === 'DATABASE_URL' && requirement.required));
        assert.ok(productionRequirements.some((requirement) => requirement.key === 'pgvector extension' && requirement.required));
        assert.ok(productionRequirements.some((requirement) => requirement.key === 'SEC_EDGAR_USER_AGENT' && requirement.required));

        const localRequirements = getAlphaRadarDeploymentRequirements('local');
        assert.ok(localRequirements.some((requirement) => requirement.key === 'SEC_EDGAR_USER_AGENT' && !requirement.required));

        assert.equal(mapOperationToProvider('refresh-filings'), 'sec-edgar');
        assert.equal(mapOperationToProvider('semantic-search'), 'semantic-embedding');
        assert.equal(mapOperationToProvider('compute-quarterly-diff'), undefined);
    });
});

function usage(overrides: Partial<AlphaRadarProviderUsage> & { provider: AlphaRadarProviderUsage['provider'] }): AlphaRadarProviderUsage {
    const { provider, ...rest } = overrides;
    return {
        provider,
        used: 0,
        failures: 0,
        consecutiveFailures: 0,
        ...rest,
    };
}

function refreshRun(): AlphaRadarRefreshRunResult {
    return {
        scope: 'all',
        startedAt: '2026-05-13T11:00:00.000Z',
        completedAt: '2026-05-13T11:03:00.000Z',
        totalFilers: 1,
        fetched: 3,
        skipped: 1,
        parsed: 1,
        changed: 4,
        memoGenerated: 1,
        filers: [{
            trackedFilerId: 'filer-berkshire',
            filerName: 'Berkshire Hathaway',
            cik: '0001067983',
            fetched: 3,
            skipped: 1,
            parsed: 1,
            changed: 4,
            memoGenerated: 1,
            filings: [
                {
                    filingId: 'filing-1',
                    accessionNumber: '0000950123-26-000001',
                    reportPeriod: '2026-Q1',
                    status: 'parsed',
                    created: true,
                    holdingsParsed: 42,
                    changesGenerated: 4,
                    memoGenerated: true,
                    reportId: 'report-1',
                },
                {
                    filingId: 'filing-2',
                    accessionNumber: '0000950123-26-000002',
                    reportPeriod: '2025-Q4',
                    status: 'failed',
                    created: true,
                    holdingsParsed: 0,
                    changesGenerated: 0,
                    memoGenerated: false,
                    message: 'Malformed information table XML',
                },
            ],
            errors: [{ accessionNumber: '0000950123-26-000002', message: 'Malformed information table XML' }],
        }],
        errors: [{ accessionNumber: '0000950123-26-000002', message: 'Malformed information table XML' }],
    };
}

function failedScheduledRun(): AlphaRadarScheduledRunRecord {
    return {
        id: 'scheduled-failure',
        scheduleId: 'alpha-radar-quarterly-refresh',
        scheduleName: 'Quarterly 13F availability sweep',
        cadence: 'quarterly',
        windowKey: '2026-Q1',
        status: 'failed',
        idempotencyKey: 'alpha-radar-demo-failure',
        requestedAt: '2026-05-13T11:30:00.000Z',
        completedAt: '2026-05-13T11:31:00.000Z',
        attempt: 1,
        queuedJobs: [],
        failureSummary: 'SEC provider timed out.',
        error: {
            code: 'timeout',
            message: 'SEC provider timed out.',
            retryable: true,
        },
    };
}

function event(overrides: Partial<AlphaRadarOperationalEvent> & {
    id: string;
    component: AlphaRadarOperationalEvent['component'];
    status: AlphaRadarOperationalEvent['status'];
}): AlphaRadarOperationalEvent {
    return {
        occurredAt: '2026-05-13T11:15:00.000Z',
        count: 1,
        ...overrides,
    };
}
