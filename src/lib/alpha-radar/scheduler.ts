import type { AlertTrigger } from '@/lib/alerts/types';
import {
    ALPHA_RADAR_DEFAULT_RETRY_POLICY,
    createAlphaRadarIdempotencyKey,
    createAlphaRadarJobEnvelope,
    shouldRetryAlphaRadarAgentError,
    type AlphaRadarAgentError,
    type AlphaRadarAgentName,
    type AlphaRadarAgentScope,
    type AlphaRadarJobOperation,
    type AlphaRadarNotificationChannel,
    type AlphaRadarRetryPolicy,
    type AlphaRadarScheduledJobRef,
    type AlphaRadarSchedulerJobPayload,
    type AlphaRadarSchedulerResult,
} from './agent-contracts';

export const ALPHA_RADAR_SCHEDULER_VERSION = 'alpha-radar-scheduler-v1';

export type AlphaRadarScheduleCadence = 'weekly' | 'quarterly' | 'adhoc';
export type AlphaRadarScheduledRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'deduped';

export interface AlphaRadarScheduleDefinition {
    id: string;
    name: string;
    cadence: AlphaRadarScheduleCadence;
    enabled: boolean;
    scope: AlphaRadarAgentScope;
    timezone: string;
    hourUtc: number;
    minuteUtc: number;
    downstreamOperations: readonly AlphaRadarJobOperation[];
}

export interface AlphaRadarScheduledRunRecord {
    id: string;
    scheduleId: string;
    scheduleName: string;
    cadence: AlphaRadarScheduleCadence;
    windowKey: string;
    status: AlphaRadarScheduledRunStatus;
    idempotencyKey: string;
    requestedAt: string;
    attempt: number;
    queuedJobs: readonly AlphaRadarScheduledJobRef[];
    completedAt?: string;
    failureSummary?: string;
    error?: AlphaRadarAgentError;
}

export interface AlphaRadarDeliveryFilter {
    trackedFilerIds?: readonly string[];
    fundStyles?: readonly string[];
    tickers?: readonly string[];
    overlapOnly?: boolean;
    minMaterialityScore?: number;
}

export interface AlphaRadarDeliveryPreference {
    channel: AlphaRadarNotificationChannel;
    enabled: boolean;
    destination?: string;
    filter?: AlphaRadarDeliveryFilter;
    failureSummaries: boolean;
}

export interface AlphaRadarPlannedDelivery {
    id: string;
    channel: AlphaRadarNotificationChannel;
    triggerId: string;
    destination?: string;
    idempotencyKey: string;
    status: 'planned' | 'dry-run';
}

export interface AlphaRadarSuppressedDelivery {
    channel: AlphaRadarNotificationChannel;
    triggerId?: string;
    reason: string;
}

export interface AlphaRadarDeliveryPlan {
    deliveries: AlphaRadarPlannedDelivery[];
    suppressed: AlphaRadarSuppressedDelivery[];
}

export interface AlphaRadarSchedulerPlan {
    requestedAt: string;
    dueRuns: AlphaRadarScheduledRunRecord[];
    skippedRuns: AlphaRadarScheduledRunRecord[];
    result: AlphaRadarSchedulerResult;
    summary: AlphaRadarRunHistorySummary;
}

export interface AlphaRadarRunHistorySummary {
    lastRun?: AlphaRadarScheduledRunRecord;
    lastSuccessfulRun?: AlphaRadarScheduledRunRecord;
    openFailures: AlphaRadarScheduledRunRecord[];
    actionableStatus: string;
    retryableFailureCount: number;
}

export interface PlanAlphaRadarScheduledRunsInput {
    schedules: readonly AlphaRadarScheduleDefinition[];
    now?: Date | string;
    existingIdempotencyKeys?: ReadonlySet<string>;
    runHistory?: readonly AlphaRadarScheduledRunRecord[];
    retryPolicy?: AlphaRadarRetryPolicy;
}

export interface PlanAlphaRadarDeliveryInput {
    preferences: readonly AlphaRadarDeliveryPreference[];
    triggers: readonly AlertTrigger[];
    existingDeliveryKeys?: ReadonlySet<string>;
    filerStylesById?: ReadonlyMap<string, string>;
    dryRun?: boolean;
}

const OPERATION_AGENT: Record<AlphaRadarJobOperation, AlphaRadarAgentName> = {
    'refresh-filings': 'ingestion-agent',
    'parse-information-table': 'sec-parser-agent',
    'compute-quarterly-diff': 'portfolio-diff-agent',
    'generate-thesis-draft': 'thesis-agent',
    'notify-material-change': 'notifier-agent',
    'schedule-refresh': 'scheduler-agent',
    'semantic-search': 'semantic-search-agent',
    'read-ui-index': 'ui-query-service',
};

export const ALPHA_RADAR_REFRESH_PIPELINE_OPERATIONS: readonly AlphaRadarJobOperation[] = [
    'refresh-filings',
    'parse-information-table',
    'compute-quarterly-diff',
    'generate-thesis-draft',
    'notify-material-change',
];

export function createDefaultAlphaRadarSchedules(
    scope: AlphaRadarAgentScope = { kind: 'all-tracked-filers' },
): AlphaRadarScheduleDefinition[] {
    return [
        {
            id: 'alpha-radar-weekly-refresh',
            name: 'Weekly Alpha Radar refresh',
            cadence: 'weekly',
            enabled: true,
            scope,
            timezone: 'America/Los_Angeles',
            hourUtc: 14,
            minuteUtc: 30,
            downstreamOperations: ALPHA_RADAR_REFRESH_PIPELINE_OPERATIONS,
        },
        {
            id: 'alpha-radar-quarterly-refresh',
            name: 'Quarterly 13F availability sweep',
            cadence: 'quarterly',
            enabled: true,
            scope,
            timezone: 'America/Los_Angeles',
            hourUtc: 15,
            minuteUtc: 0,
            downstreamOperations: ALPHA_RADAR_REFRESH_PIPELINE_OPERATIONS,
        },
    ];
}

export function createDefaultAlphaRadarDeliveryPreferences(): AlphaRadarDeliveryPreference[] {
    return [
        {
            channel: 'in-app',
            enabled: true,
            failureSummaries: true,
            filter: {
                overlapOnly: false,
                minMaterialityScore: 75,
            },
        },
        {
            channel: 'email',
            enabled: false,
            failureSummaries: true,
            filter: {
                overlapOnly: true,
                minMaterialityScore: 80,
            },
        },
        {
            channel: 'slack',
            enabled: false,
            failureSummaries: true,
            filter: {
                overlapOnly: true,
                minMaterialityScore: 80,
            },
        },
        {
            channel: 'telegram',
            enabled: false,
            failureSummaries: false,
            filter: {
                overlapOnly: true,
                minMaterialityScore: 90,
            },
        },
    ];
}

export function planAlphaRadarScheduledRuns(input: PlanAlphaRadarScheduledRunsInput): AlphaRadarSchedulerPlan {
    const now = coerceDate(input.now);
    const requestedAt = now.toISOString();
    const existingKeys = input.existingIdempotencyKeys ?? new Set<string>();
    const runHistory = input.runHistory ?? [];
    const retryPolicy = input.retryPolicy ?? ALPHA_RADAR_DEFAULT_RETRY_POLICY;
    const dueRuns: AlphaRadarScheduledRunRecord[] = [];
    const skippedRuns: AlphaRadarScheduledRunRecord[] = [];
    const enqueuedJobs: AlphaRadarScheduledJobRef[] = [];
    const skippedJobs: AlphaRadarSchedulerResult['skippedJobs'] = [];

    for (const schedule of input.schedules) {
        const windowKey = getAlphaRadarScheduleWindowKey(schedule.cadence, now);
        const schedulerKey = createSchedulerIdempotencyKey(schedule, windowKey);
        const alreadyRan = existingKeys.has(schedulerKey) || hasActiveOrCompletedRun(runHistory, schedulerKey);

        if (!schedule.enabled) {
            const run = createScheduledRunRecord({
                schedule,
                windowKey,
                requestedAt,
                idempotencyKey: schedulerKey,
                status: 'skipped',
                queuedJobs: [],
                failureSummary: 'Schedule is disabled.',
            });
            skippedRuns.push(run);
            skippedJobs.push({ idempotencyKey: schedulerKey, reason: 'schedule-disabled' });
            continue;
        }

        if (alreadyRan) {
            const run = createScheduledRunRecord({
                schedule,
                windowKey,
                requestedAt,
                idempotencyKey: schedulerKey,
                status: 'deduped',
                queuedJobs: [],
                failureSummary: 'Equivalent scheduled run already exists for this window.',
            });
            skippedRuns.push(run);
            skippedJobs.push({ idempotencyKey: schedulerKey, reason: 'deduped-window' });
            continue;
        }

        if (!isAlphaRadarScheduleDue(schedule, now, runHistory)) {
            const run = createScheduledRunRecord({
                schedule,
                windowKey,
                requestedAt,
                idempotencyKey: schedulerKey,
                status: 'skipped',
                queuedJobs: [],
                failureSummary: `Not due for ${windowKey}.`,
            });
            skippedRuns.push(run);
            skippedJobs.push({ idempotencyKey: schedulerKey, reason: `not-due:${windowKey}` });
            continue;
        }

        const queuedJobs = schedule.downstreamOperations.map((operation) => createScheduledJobRef({
            schedule,
            operation,
            requestedAt,
            windowKey,
        }));
        enqueuedJobs.push(...queuedJobs);
        dueRuns.push(createScheduledRunRecord({
            schedule,
            windowKey,
            requestedAt,
            idempotencyKey: schedulerKey,
            status: 'queued',
            queuedJobs,
            attempt: nextAttemptForSchedule(runHistory, schedule.id, retryPolicy),
        }));
    }

    const summary = summarizeAlphaRadarRunHistory([...runHistory, ...dueRuns, ...skippedRuns]);

    return {
        requestedAt,
        dueRuns,
        skippedRuns,
        result: {
            enqueuedJobs,
            skippedJobs,
        },
        summary,
    };
}

export function createAlphaRadarSchedulerJob(
    schedule: AlphaRadarScheduleDefinition,
    requestedAt: string | Date,
) {
    const now = coerceDate(requestedAt);
    const windowKey = getAlphaRadarScheduleWindowKey(schedule.cadence, now);
    const payload: AlphaRadarSchedulerJobPayload = {
        trigger: schedule.cadence === 'adhoc' ? 'manual' : 'cron',
        scope: schedule.scope,
        scheduledFor: now.toISOString(),
        cadence: schedule.cadence,
        downstreamOperations: schedule.downstreamOperations,
    };

    return createAlphaRadarJobEnvelope({
        agent: 'scheduler-agent',
        operation: 'schedule-refresh',
        payload,
        scope: schedule.scope,
        reportPeriod: windowKey,
        requestedAt: now.toISOString(),
        idempotencyKey: createSchedulerIdempotencyKey(schedule, windowKey),
        trace: { requestedBy: schedule.cadence === 'adhoc' ? 'user' : 'scheduler' },
    });
}

export function isAlphaRadarScheduleDue(
    schedule: AlphaRadarScheduleDefinition,
    nowInput: Date | string,
    runHistory: readonly AlphaRadarScheduledRunRecord[] = [],
): boolean {
    if (!schedule.enabled) return false;
    if (schedule.cadence === 'adhoc') return true;

    const now = coerceDate(nowInput);
    if (!hasReachedScheduledClock(schedule, now)) return false;

    const windowKey = getAlphaRadarScheduleWindowKey(schedule.cadence, now);
    return !runHistory.some((run) =>
        run.scheduleId === schedule.id &&
        run.windowKey === windowKey &&
        ['queued', 'running', 'succeeded'].includes(run.status),
    );
}

export function planAlphaRadarDeliveries(input: PlanAlphaRadarDeliveryInput): AlphaRadarDeliveryPlan {
    const existingKeys = input.existingDeliveryKeys ?? new Set<string>();
    const filerStylesById = input.filerStylesById ?? new Map<string, string>();
    const deliveries: AlphaRadarPlannedDelivery[] = [];
    const suppressed: AlphaRadarSuppressedDelivery[] = [];

    for (const preference of input.preferences) {
        if (!preference.enabled) {
            suppressed.push({ channel: preference.channel, reason: 'channel-disabled' });
            continue;
        }

        if (preference.channel !== 'in-app' && !preference.destination?.trim()) {
            suppressed.push({ channel: preference.channel, reason: 'missing-destination' });
            continue;
        }

        for (const trigger of input.triggers) {
            const filterReason = getDeliveryFilterSuppressionReason(preference.filter, trigger, filerStylesById);
            if (filterReason) {
                suppressed.push({ channel: preference.channel, triggerId: trigger.id, reason: filterReason });
                continue;
            }

            const idempotencyKey = createDeliveryIdempotencyKey(preference.channel, trigger.id);
            if (existingKeys.has(idempotencyKey)) {
                suppressed.push({ channel: preference.channel, triggerId: trigger.id, reason: 'delivery-deduped' });
                continue;
            }

            deliveries.push({
                id: `alpha-radar-delivery-${shortHash(idempotencyKey)}`,
                channel: preference.channel,
                triggerId: trigger.id,
                destination: preference.destination,
                idempotencyKey,
                status: input.dryRun || preference.channel !== 'in-app' ? 'dry-run' : 'planned',
            });
        }
    }

    return { deliveries, suppressed };
}

export function summarizeAlphaRadarRunHistory(
    runHistory: readonly AlphaRadarScheduledRunRecord[],
): AlphaRadarRunHistorySummary {
    const sorted = [...runHistory].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    const lastRun = sorted[0];
    const lastSuccessfulRun = sorted.find((run) => run.status === 'succeeded');
    const openFailures = sorted.filter((run) => run.status === 'failed' && !hasLaterSuccess(sorted, run));
    const retryableFailureCount = openFailures.filter((run) =>
        run.error ? shouldRetryAlphaRadarAgentError(run.error, run.attempt) : false,
    ).length;
    const actionableStatus = openFailures.length > 0
        ? `${openFailures.length} scheduled Alpha Radar run${openFailures.length === 1 ? '' : 's'} need review.`
        : lastRun
          ? `Last scheduled Alpha Radar run is ${lastRun.status}.`
          : 'No scheduled Alpha Radar runs recorded yet.';

    return {
        lastRun,
        lastSuccessfulRun,
        openFailures,
        actionableStatus,
        retryableFailureCount,
    };
}

export function getAlphaRadarScheduleWindowKey(cadence: AlphaRadarScheduleCadence, nowInput: Date | string): string {
    const now = coerceDate(nowInput);
    if (cadence === 'weekly') return `${now.getUTCFullYear()}-W${getIsoWeek(now)}`;
    if (cadence === 'quarterly') return getLatestAvailableThirteenFQuarter(now);
    return now.toISOString().slice(0, 10);
}

function createScheduledJobRef(input: {
    schedule: AlphaRadarScheduleDefinition;
    operation: AlphaRadarJobOperation;
    requestedAt: string;
    windowKey: string;
}): AlphaRadarScheduledJobRef {
    const agent = OPERATION_AGENT[input.operation];
    const idempotencyKey = createAlphaRadarIdempotencyKey({
        agent,
        operation: input.operation,
        scope: input.schedule.scope,
        reportPeriod: input.windowKey,
        fingerprint: {
            scheduleId: input.schedule.id,
            schedulerVersion: ALPHA_RADAR_SCHEDULER_VERSION,
        },
    });

    return {
        jobId: `ar-job-${shortHash(`${idempotencyKey}:${input.requestedAt}`)}`,
        agent,
        operation: input.operation,
        idempotencyKey,
        status: 'queued',
    };
}

function createScheduledRunRecord(input: {
    schedule: AlphaRadarScheduleDefinition;
    windowKey: string;
    requestedAt: string;
    idempotencyKey: string;
    status: AlphaRadarScheduledRunStatus;
    queuedJobs: readonly AlphaRadarScheduledJobRef[];
    attempt?: number;
    failureSummary?: string;
    error?: AlphaRadarAgentError;
}): AlphaRadarScheduledRunRecord {
    return {
        id: `alpha-radar-run-${shortHash(`${input.schedule.id}:${input.windowKey}:${input.idempotencyKey}`)}`,
        scheduleId: input.schedule.id,
        scheduleName: input.schedule.name,
        cadence: input.schedule.cadence,
        windowKey: input.windowKey,
        status: input.status,
        idempotencyKey: input.idempotencyKey,
        requestedAt: input.requestedAt,
        attempt: input.attempt ?? 1,
        queuedJobs: input.queuedJobs,
        failureSummary: input.failureSummary,
        error: input.error,
    };
}

function createSchedulerIdempotencyKey(schedule: AlphaRadarScheduleDefinition, windowKey: string): string {
    return createAlphaRadarIdempotencyKey({
        agent: 'scheduler-agent',
        operation: 'schedule-refresh',
        scope: schedule.scope,
        reportPeriod: windowKey,
        fingerprint: {
            scheduleId: schedule.id,
            cadence: schedule.cadence,
            schedulerVersion: ALPHA_RADAR_SCHEDULER_VERSION,
            downstreamOperations: schedule.downstreamOperations,
        },
    });
}

function createDeliveryIdempotencyKey(channel: AlphaRadarNotificationChannel, triggerId: string): string {
    return `alpha-radar-delivery:${channel}:${triggerId}`;
}

function getDeliveryFilterSuppressionReason(
    filter: AlphaRadarDeliveryFilter | undefined,
    trigger: AlertTrigger,
    filerStylesById: ReadonlyMap<string, string>,
): string | undefined {
    if (!filter) return undefined;
    const alpha = trigger.alphaRadar;
    if (!alpha) return 'missing-alpha-radar-context';

    if (filter.minMaterialityScore !== undefined && alpha.materialityScore < filter.minMaterialityScore) {
        return 'below-materiality-threshold';
    }

    if (filter.overlapOnly && alpha.relevanceReasons.length === 0) {
        return 'no-user-overlap';
    }

    if (filter.trackedFilerIds?.length && !filter.trackedFilerIds.includes(alpha.trackedFilerId)) {
        return 'filer-filtered';
    }

    if (filter.tickers?.length) {
        const ticker = alpha.ticker?.toUpperCase();
        const acceptedTickers = filter.tickers.map((item) => item.toUpperCase());
        if (!ticker || !acceptedTickers.includes(ticker)) return 'ticker-filtered';
    }

    if (filter.fundStyles?.length) {
        const style = filerStylesById.get(alpha.trackedFilerId);
        if (!style || !filter.fundStyles.includes(style)) return 'fund-style-filtered';
    }

    return undefined;
}

function hasActiveOrCompletedRun(
    runHistory: readonly AlphaRadarScheduledRunRecord[],
    idempotencyKey: string,
): boolean {
    return runHistory.some((run) =>
        run.idempotencyKey === idempotencyKey &&
        ['queued', 'running', 'succeeded', 'deduped'].includes(run.status),
    );
}

function nextAttemptForSchedule(
    runHistory: readonly AlphaRadarScheduledRunRecord[],
    scheduleId: string,
    retryPolicy: AlphaRadarRetryPolicy,
): number {
    const lastFailure = [...runHistory]
        .reverse()
        .find((run) => run.scheduleId === scheduleId && run.status === 'failed');
    if (!lastFailure?.error) return 1;
    return shouldRetryAlphaRadarAgentError(lastFailure.error, lastFailure.attempt, retryPolicy)
        ? lastFailure.attempt + 1
        : 1;
}

function hasLaterSuccess(
    sortedNewestFirst: readonly AlphaRadarScheduledRunRecord[],
    failedRun: AlphaRadarScheduledRunRecord,
): boolean {
    return sortedNewestFirst.some((run) =>
        run.scheduleId === failedRun.scheduleId &&
        run.windowKey === failedRun.windowKey &&
        run.status === 'succeeded' &&
        run.requestedAt > failedRun.requestedAt,
    );
}

function hasReachedScheduledClock(schedule: AlphaRadarScheduleDefinition, now: Date): boolean {
    const minutesNow = now.getUTCHours() * 60 + now.getUTCMinutes();
    const scheduledMinutes = schedule.hourUtc * 60 + schedule.minuteUtc;
    return minutesNow >= scheduledMinutes;
}

function getLatestAvailableThirteenFQuarter(now: Date): string {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const completedQuarter = month < 3
        ? 4
        : Math.floor(month / 3);
    const completedYear = month < 3 ? year - 1 : year;
    const completedQuarterEnd = new Date(Date.UTC(completedYear, completedQuarter * 3, 0));
    const availabilityDate = new Date(completedQuarterEnd);
    availabilityDate.setUTCDate(availabilityDate.getUTCDate() + 45);

    if (now.getTime() >= availabilityDate.getTime()) {
        return `${completedYear}-Q${completedQuarter}`;
    }

    const previousQuarter = completedQuarter === 1 ? 4 : completedQuarter - 1;
    const previousYear = completedQuarter === 1 ? completedYear - 1 : completedYear;
    return `${previousYear}-Q${previousQuarter}`;
}

function getIsoWeek(date: Date): string {
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNumber = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((target.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
    return String(week).padStart(2, '0');
}

function coerceDate(input: Date | string | undefined): Date {
    if (input instanceof Date) return input;
    if (typeof input === 'string') return new Date(input);
    return new Date();
}

function shortHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}
