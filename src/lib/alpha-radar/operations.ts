import type {
    AlphaRadarAgentName,
    AlphaRadarAgentScope,
    AlphaRadarAgentWarning,
    AlphaRadarJobOperation,
} from './agent-contracts';
import type { AlphaRadarRefreshRunResult } from './refresh';
import type { AlphaRadarScheduledRunRecord } from './scheduler';

export const ALPHA_RADAR_OPERATIONS_VERSION = 'alpha-radar-operations-v1';

export type AlphaRadarDeploymentTarget = 'local' | 'preview' | 'production';

export type AlphaRadarProviderKey =
    | 'sec-edgar'
    | 'semantic-embedding'
    | 'external-overlay'
    | 'thesis-generation'
    | 'notification-delivery';

export type AlphaRadarProviderBudgetWindow = 'minute' | 'hour' | 'day' | 'run';

export type AlphaRadarProviderBudgetStatus = 'allowed' | 'warn' | 'throttled' | 'circuit-open';

export interface AlphaRadarProviderCircuitBreaker {
    failureThreshold: number;
    cooldownMs: number;
}

export interface AlphaRadarProviderBudget {
    provider: AlphaRadarProviderKey;
    label: string;
    limit: number;
    window: AlphaRadarProviderBudgetWindow;
    resetAt: string;
    warnAtPercent: number;
    circuitBreaker: AlphaRadarProviderCircuitBreaker;
}

export interface AlphaRadarProviderUsage {
    provider: AlphaRadarProviderKey;
    used: number;
    failures: number;
    consecutiveFailures: number;
    lastFailureAt?: string;
    lastStatus?: 'succeeded' | 'failed' | 'skipped';
    averageLatencyMs?: number;
}

export interface AlphaRadarProviderBudgetDecision {
    provider: AlphaRadarProviderKey;
    label: string;
    status: AlphaRadarProviderBudgetStatus;
    used: number;
    limit: number;
    remaining: number;
    window: AlphaRadarProviderBudgetWindow;
    resetAt: string;
    reasons: string[];
    nextRetryAt?: string;
    averageLatencyMs?: number;
}

export class AlphaRadarProviderBudgetError extends Error {
    constructor(public readonly decision: AlphaRadarProviderBudgetDecision) {
        super(`${decision.label} is ${decision.status}: ${decision.reasons.join('; ')}`);
        this.name = 'AlphaRadarProviderBudgetError';
    }
}

export type AlphaRadarOperationalComponent =
    | 'ingestion'
    | 'parser'
    | 'diff'
    | 'memo'
    | 'notifier'
    | 'scheduler'
    | 'semantic-memory'
    | 'provider';

export interface AlphaRadarOperationalEvent {
    id: string;
    component: AlphaRadarOperationalComponent;
    status: 'succeeded' | 'failed' | 'skipped';
    occurredAt: string;
    count?: number;
    durationMs?: number;
    retryable?: boolean;
    message?: string;
    warning?: AlphaRadarAgentWarning;
}

export interface AlphaRadarRetryAction {
    id: string;
    label: string;
    reason: string;
    retryable: boolean;
    source: 'scheduled-run' | 'event' | 'provider-budget';
    nextRetryAt?: string;
}

export interface AlphaRadarOperationalHealthSummary {
    generatedAt: string;
    status: 'healthy' | 'degraded' | 'blocked';
    lastRun?: {
        id: string;
        label: string;
        status: string;
        requestedAt: string;
        completedAt?: string;
        source: 'scheduled-run' | 'refresh-run';
    };
    counts: {
        ingestionFetched: number;
        filingsParsed: number;
        parseFailures: number;
        memoGenerated: number;
        memoFailures: number;
        notificationFailures: number;
    };
    providerStatus: {
        totalProviders: number;
        warnedProviders: number;
        blockedProviders: number;
        averageLatencyMs?: number;
    };
    retryActions: AlphaRadarRetryAction[];
    actionableItems: string[];
}

export type AlphaRadarMaintenanceAction =
    | 'reprocess-filer-period'
    | 'delete-parsed-output'
    | 'replay-memo-generation';

export interface AlphaRadarMaintenancePlanInput {
    action: AlphaRadarMaintenanceAction;
    scope: Extract<AlphaRadarAgentScope, { kind: 'tracked-filer' | 'filing' | 'report' }>;
    reportPeriod?: string;
    requestedBy: string;
    reason: string;
    dryRun?: boolean;
    confirmationToken?: string;
}

export interface AlphaRadarMaintenancePlan {
    id: string;
    action: AlphaRadarMaintenanceAction;
    status: 'ready' | 'blocked';
    dryRun: boolean;
    destructive: boolean;
    requiresConfirmation: boolean;
    confirmationToken?: string;
    steps: string[];
    warnings: string[];
}

export interface AlphaRadarDeploymentRequirement {
    key: string;
    label: string;
    required: boolean;
    notes: string;
}

export function createDefaultAlphaRadarProviderBudgets(input: {
    target?: AlphaRadarDeploymentTarget;
    now?: Date | string;
} = {}): AlphaRadarProviderBudget[] {
    const target = input.target ?? 'local';
    const now = coerceDate(input.now);
    const scale = target === 'production'
        ? { sec: 900, embeddings: 400, overlays: 250, thesis: 160, notifications: 500 }
        : target === 'preview'
          ? { sec: 120, embeddings: 40, overlays: 30, thesis: 20, notifications: 80 }
          : { sec: 40, embeddings: 5, overlays: 5, thesis: 3, notifications: 20 };

    return [
        {
            provider: 'sec-edgar',
            label: 'SEC EDGAR',
            limit: scale.sec,
            window: 'day',
            resetAt: nextResetAt('day', now),
            warnAtPercent: 0.75,
            circuitBreaker: { failureThreshold: 3, cooldownMs: 15 * 60 * 1000 },
        },
        {
            provider: 'semantic-embedding',
            label: 'Semantic embedding provider',
            limit: scale.embeddings,
            window: 'day',
            resetAt: nextResetAt('day', now),
            warnAtPercent: 0.7,
            circuitBreaker: { failureThreshold: 2, cooldownMs: 30 * 60 * 1000 },
        },
        {
            provider: 'external-overlay',
            label: 'External overlay providers',
            limit: scale.overlays,
            window: 'day',
            resetAt: nextResetAt('day', now),
            warnAtPercent: 0.7,
            circuitBreaker: { failureThreshold: 2, cooldownMs: 30 * 60 * 1000 },
        },
        {
            provider: 'thesis-generation',
            label: 'Thesis generation provider',
            limit: scale.thesis,
            window: 'day',
            resetAt: nextResetAt('day', now),
            warnAtPercent: 0.7,
            circuitBreaker: { failureThreshold: 2, cooldownMs: 30 * 60 * 1000 },
        },
        {
            provider: 'notification-delivery',
            label: 'Notification delivery',
            limit: scale.notifications,
            window: 'day',
            resetAt: nextResetAt('day', now),
            warnAtPercent: 0.8,
            circuitBreaker: { failureThreshold: 4, cooldownMs: 10 * 60 * 1000 },
        },
    ];
}

export function evaluateAlphaRadarProviderBudget(input: {
    budget: AlphaRadarProviderBudget;
    usage?: AlphaRadarProviderUsage;
    now?: Date | string;
}): AlphaRadarProviderBudgetDecision {
    const now = coerceDate(input.now);
    const usage = input.usage;
    const used = Math.max(0, usage?.used ?? 0);
    const remaining = Math.max(0, input.budget.limit - used);
    const reasons: string[] = [];
    const nextCircuitRetryAt = getCircuitRetryAt(input.budget, usage);
    let status: AlphaRadarProviderBudgetStatus = 'allowed';

    if (nextCircuitRetryAt && now.getTime() < Date.parse(nextCircuitRetryAt)) {
        status = 'circuit-open';
        reasons.push(`Circuit opened after ${usage?.consecutiveFailures ?? 0} consecutive failures.`);
    } else if (used >= input.budget.limit) {
        status = 'throttled';
        reasons.push(`${used}/${input.budget.limit} ${input.budget.window} budget used.`);
    } else if (used >= Math.ceil(input.budget.limit * input.budget.warnAtPercent)) {
        status = 'warn';
        reasons.push(`${used}/${input.budget.limit} ${input.budget.window} budget used.`);
    }

    if (reasons.length === 0) {
        reasons.push(`${remaining}/${input.budget.limit} ${input.budget.window} budget remaining.`);
    }

    return {
        provider: input.budget.provider,
        label: input.budget.label,
        status,
        used,
        limit: input.budget.limit,
        remaining,
        window: input.budget.window,
        resetAt: input.budget.resetAt,
        reasons,
        nextRetryAt: status === 'circuit-open' ? nextCircuitRetryAt : status === 'throttled' ? input.budget.resetAt : undefined,
        averageLatencyMs: usage?.averageLatencyMs,
    };
}

export function enforceAlphaRadarProviderBudget(input: {
    budget: AlphaRadarProviderBudget;
    usage?: AlphaRadarProviderUsage;
    now?: Date | string;
}): AlphaRadarProviderBudgetDecision {
    const decision = evaluateAlphaRadarProviderBudget(input);
    if (decision.status === 'throttled' || decision.status === 'circuit-open') {
        throw new AlphaRadarProviderBudgetError(decision);
    }
    return decision;
}

export function recordAlphaRadarProviderOutcome(input: {
    provider: AlphaRadarProviderKey;
    previous?: AlphaRadarProviderUsage;
    status: 'succeeded' | 'failed' | 'skipped';
    latencyMs?: number;
    occurredAt?: Date | string;
}): AlphaRadarProviderUsage {
    const previous = input.previous;
    const used = (previous?.used ?? 0) + (input.status === 'skipped' ? 0 : 1);
    const failures = (previous?.failures ?? 0) + (input.status === 'failed' ? 1 : 0);
    const consecutiveFailures = input.status === 'failed'
        ? (previous?.consecutiveFailures ?? 0) + 1
        : 0;
    const previousLatency = previous?.averageLatencyMs;
    const averageLatencyMs = input.latencyMs === undefined
        ? previousLatency
        : previousLatency === undefined || used <= 1
          ? input.latencyMs
          : Math.round(((previousLatency * (used - 1)) + input.latencyMs) / used);

    return {
        provider: input.provider,
        used,
        failures,
        consecutiveFailures,
        lastFailureAt: input.status === 'failed'
            ? coerceDate(input.occurredAt).toISOString()
            : previous?.lastFailureAt,
        lastStatus: input.status,
        averageLatencyMs,
    };
}

export function summarizeAlphaRadarOperationalHealth(input: {
    generatedAt?: Date | string;
    refreshRuns?: readonly AlphaRadarRefreshRunResult[];
    scheduledRuns?: readonly AlphaRadarScheduledRunRecord[];
    providerDecisions?: readonly AlphaRadarProviderBudgetDecision[];
    events?: readonly AlphaRadarOperationalEvent[];
}): AlphaRadarOperationalHealthSummary {
    const generatedAt = coerceDate(input.generatedAt).toISOString();
    const refreshRuns = input.refreshRuns ?? [];
    const scheduledRuns = input.scheduledRuns ?? [];
    const providerDecisions = input.providerDecisions ?? [];
    const events = input.events ?? [];
    const retryActions = collectRetryActions(scheduledRuns, events, providerDecisions);
    const blockedProviders = providerDecisions.filter((decision) => decision.status === 'throttled' || decision.status === 'circuit-open');
    const warnedProviders = providerDecisions.filter((decision) => decision.status === 'warn');
    const eventFailures = events.filter((event) => event.status === 'failed');
    const counts = {
        ingestionFetched: refreshRuns.reduce((sum, run) => sum + run.fetched, 0) + sumEvents(events, 'ingestion', 'succeeded'),
        filingsParsed: refreshRuns.reduce((sum, run) => sum + run.parsed, 0) + sumEvents(events, 'parser', 'succeeded'),
        parseFailures: refreshRuns.reduce((sum, run) => sum + run.filers.reduce(
            (filerSum, filer) => filerSum + filer.filings.filter((filing) => filing.status === 'failed').length,
            0,
        ), 0) + sumEvents(events, 'parser', 'failed'),
        memoGenerated: refreshRuns.reduce((sum, run) => sum + run.memoGenerated, 0) + sumEvents(events, 'memo', 'succeeded'),
        memoFailures: sumEvents(events, 'memo', 'failed'),
        notificationFailures: sumEvents(events, 'notifier', 'failed'),
    };
    const status: AlphaRadarOperationalHealthSummary['status'] = blockedProviders.length > 0
        ? 'blocked'
        : retryActions.length > 0 || warnedProviders.length > 0 || eventFailures.length > 0 || counts.parseFailures > 0
          ? 'degraded'
          : 'healthy';
    const actionableItems = buildActionableItems({
        retryActions,
        blockedProviders,
        warnedProviders,
        counts,
    });

    return {
        generatedAt,
        status,
        lastRun: getLastOperationalRun(refreshRuns, scheduledRuns),
        counts,
        providerStatus: {
            totalProviders: providerDecisions.length,
            warnedProviders: warnedProviders.length,
            blockedProviders: blockedProviders.length,
            averageLatencyMs: averageLatency(providerDecisions),
        },
        retryActions,
        actionableItems,
    };
}

export function planAlphaRadarMaintenanceAction(input: AlphaRadarMaintenancePlanInput): AlphaRadarMaintenancePlan {
    const dryRun = input.dryRun ?? true;
    const destructive = input.action === 'delete-parsed-output';
    const confirmationToken = createMaintenanceConfirmationToken(input.action, input.scope, input.reportPeriod);
    const requiresConfirmation = destructive && !dryRun;
    const confirmed = !requiresConfirmation || input.confirmationToken === confirmationToken;
    const scopeLabel = describeScope(input.scope, input.reportPeriod);
    const warnings: string[] = [];

    if (destructive) {
        warnings.push('Deletes parsed holdings, changes, semantic chunks, and generated memos for the selected scope.');
    }
    if (!dryRun && !input.reason.trim()) {
        warnings.push('A production maintenance action should include an operator-visible reason.');
    }

    return {
        id: `alpha-radar-maintenance-${shortHash(`${input.action}:${scopeLabel}:${input.requestedBy}:${ALPHA_RADAR_OPERATIONS_VERSION}`)}`,
        action: input.action,
        status: confirmed ? 'ready' : 'blocked',
        dryRun,
        destructive,
        requiresConfirmation,
        confirmationToken: requiresConfirmation ? confirmationToken : undefined,
        steps: maintenanceSteps(input.action, scopeLabel, dryRun),
        warnings,
    };
}

export function getAlphaRadarDeploymentRequirements(target: AlphaRadarDeploymentTarget): AlphaRadarDeploymentRequirement[] {
    const requirements: Record<AlphaRadarDeploymentTarget, AlphaRadarDeploymentRequirement[]> = {
        local: [
            requirement('DATABASE_URL', true, 'Local Postgres connection string for persistence; fallback UI still renders without it.'),
            requirement('SEC_EDGAR_USER_AGENT', false, 'Required only when local development calls live SEC EDGAR.'),
            requirement('pgvector extension', false, 'Optional locally; keyword fallback covers semantic search when unavailable.'),
            requirement('Scheduler runtime', false, 'Use manual refresh or a one-off cron runner locally.'),
        ],
        preview: [
            requirement('DATABASE_URL', true, 'Preview database with Alpha Radar migrations applied.'),
            requirement('SEC_EDGAR_USER_AGENT', true, 'Descriptive contact string for SEC fair-use compliance.'),
            requirement('Provider keys', false, 'External overlays and LLM/embedding providers stay disabled unless preview budgets are configured.'),
            requirement('Scheduler runtime', true, 'One preview-safe scheduled job source with provider budgets enforced before calls.'),
        ],
        production: [
            requirement('DATABASE_URL', true, 'Production Postgres with Alpha Radar migrations and backup policy.'),
            requirement('pgvector extension', true, 'Required for production semantic recall; keyword fallback remains a degraded mode.'),
            requirement('SEC_EDGAR_USER_AGENT', true, 'Descriptive contact string for all SEC EDGAR calls.'),
            requirement('Provider keys', true, 'Provider credentials must be paired with daily budgets and circuit breakers.'),
            requirement('Scheduler runtime', true, 'Cron/worker runtime must preserve idempotency keys and retry history.'),
            requirement('Notification destinations', true, 'External email, Slack, or Telegram destinations require dry-run validation before enabling.'),
        ],
    };

    return requirements[target];
}

export function mapOperationToProvider(operation: AlphaRadarJobOperation, agent?: AlphaRadarAgentName): AlphaRadarProviderKey | undefined {
    if (operation === 'refresh-filings' || agent === 'ingestion-agent') return 'sec-edgar';
    if (operation === 'parse-information-table' || agent === 'sec-parser-agent') return 'sec-edgar';
    if (operation === 'semantic-search' || agent === 'semantic-search-agent') return 'semantic-embedding';
    if (operation === 'generate-thesis-draft' || agent === 'thesis-agent') return 'thesis-generation';
    if (operation === 'notify-material-change' || agent === 'notifier-agent') return 'notification-delivery';
    return undefined;
}

function collectRetryActions(
    scheduledRuns: readonly AlphaRadarScheduledRunRecord[],
    events: readonly AlphaRadarOperationalEvent[],
    providerDecisions: readonly AlphaRadarProviderBudgetDecision[],
): AlphaRadarRetryAction[] {
    const scheduled = scheduledRuns
        .filter((run) => run.status === 'failed')
        .map((run) => ({
            id: `retry-${run.id}`,
            label: run.scheduleName,
            reason: run.failureSummary ?? run.error?.message ?? 'Scheduled run failed.',
            retryable: run.error?.retryable ?? false,
            source: 'scheduled-run' as const,
        }));
    const eventRetries = events
        .filter((event) => event.status === 'failed')
        .map((event) => ({
            id: `retry-${event.id}`,
            label: event.component,
            reason: event.message ?? event.warning?.message ?? `${event.component} failed.`,
            retryable: event.retryable ?? false,
            source: 'event' as const,
        }));
    const providerRetries = providerDecisions
        .filter((decision) => decision.status === 'throttled' || decision.status === 'circuit-open')
        .map((decision) => ({
            id: `retry-${decision.provider}`,
            label: decision.label,
            reason: decision.reasons.join(' '),
            retryable: true,
            source: 'provider-budget' as const,
            nextRetryAt: decision.nextRetryAt,
        }));

    return [...scheduled, ...eventRetries, ...providerRetries];
}

function getLastOperationalRun(
    refreshRuns: readonly AlphaRadarRefreshRunResult[],
    scheduledRuns: readonly AlphaRadarScheduledRunRecord[],
): AlphaRadarOperationalHealthSummary['lastRun'] {
    const refresh = refreshRuns.map((run) => ({
        id: `refresh-${run.completedAt}`,
        label: run.scope === 'all' ? 'Manual refresh' : 'Filer refresh',
        status: run.errors.length > 0 ? 'failed' : 'succeeded',
        requestedAt: run.startedAt,
        completedAt: run.completedAt,
        source: 'refresh-run' as const,
    }));
    const scheduled = scheduledRuns.map((run) => ({
        id: run.id,
        label: run.scheduleName,
        status: run.status,
        requestedAt: run.requestedAt,
        completedAt: run.completedAt,
        source: 'scheduled-run' as const,
    }));

    return [...refresh, ...scheduled].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))[0];
}

function buildActionableItems(input: {
    retryActions: readonly AlphaRadarRetryAction[];
    blockedProviders: readonly AlphaRadarProviderBudgetDecision[];
    warnedProviders: readonly AlphaRadarProviderBudgetDecision[];
    counts: AlphaRadarOperationalHealthSummary['counts'];
}): string[] {
    const items: string[] = [];
    if (input.blockedProviders.length > 0) {
        items.push(`${input.blockedProviders.length} provider budget${input.blockedProviders.length === 1 ? '' : 's'} blocked.`);
    }
    if (input.retryActions.length > 0) {
        items.push(`${input.retryActions.length} retry action${input.retryActions.length === 1 ? '' : 's'} need review.`);
    }
    if (input.counts.parseFailures > 0) {
        items.push(`${input.counts.parseFailures} filing parse failure${input.counts.parseFailures === 1 ? '' : 's'} need inspection.`);
    }
    if (input.counts.memoFailures > 0) {
        items.push(`${input.counts.memoFailures} memo generation failure${input.counts.memoFailures === 1 ? '' : 's'} need replay.`);
    }
    if (input.warnedProviders.length > 0) {
        items.push(`${input.warnedProviders.length} provider budget${input.warnedProviders.length === 1 ? '' : 's'} near limit.`);
    }
    if (items.length === 0) {
        items.push('No operator action needed.');
    }
    return items;
}

function sumEvents(
    events: readonly AlphaRadarOperationalEvent[],
    component: AlphaRadarOperationalComponent,
    status: AlphaRadarOperationalEvent['status'],
): number {
    return events
        .filter((event) => event.component === component && event.status === status)
        .reduce((sum, event) => sum + (event.count ?? 1), 0);
}

function averageLatency(decisions: readonly AlphaRadarProviderBudgetDecision[]): number | undefined {
    const latencies = decisions
        .map((decision) => decision.averageLatencyMs)
        .filter((value): value is number => typeof value === 'number');
    if (latencies.length === 0) return undefined;
    return Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length);
}

function getCircuitRetryAt(
    budget: AlphaRadarProviderBudget,
    usage: AlphaRadarProviderUsage | undefined,
): string | undefined {
    if (!usage?.lastFailureAt || usage.consecutiveFailures < budget.circuitBreaker.failureThreshold) {
        return undefined;
    }
    return new Date(Date.parse(usage.lastFailureAt) + budget.circuitBreaker.cooldownMs).toISOString();
}

function createMaintenanceConfirmationToken(
    action: AlphaRadarMaintenanceAction,
    scope: AlphaRadarMaintenancePlanInput['scope'],
    reportPeriod?: string,
): string {
    const scopeId = scope.kind === 'tracked-filer'
        ? scope.trackedFilerId
        : scope.kind === 'filing'
          ? scope.filingId
          : scope.reportId;

    return [
        action.toUpperCase().replaceAll('-', '_'),
        scope.kind,
        scopeId,
        reportPeriod ?? 'all-periods',
    ].join(':');
}

function maintenanceSteps(action: AlphaRadarMaintenanceAction, scopeLabel: string, dryRun: boolean): string[] {
    const suffix = dryRun ? 'dry-run only' : 'write enabled after confirmation';
    if (action === 'reprocess-filer-period') {
        return [
            `Load source filings and holdings for ${scopeLabel}.`,
            'Re-run parser, diff, semantic chunking, and deterministic memo generation.',
            `Report inserted, updated, and skipped rows (${suffix}).`,
        ];
    }
    if (action === 'delete-parsed-output') {
        return [
            `Select parsed holdings, changes, semantic chunks, and memos for ${scopeLabel}.`,
            'Verify no unrelated report periods or filers are selected.',
            `Delete selected derived output and preserve source filing records (${suffix}).`,
        ];
    }
    return [
        `Load stored changes and source citations for ${scopeLabel}.`,
        'Replay deterministic memo/thesis generation without re-fetching SEC data.',
        `Report generated, skipped, and warning counts (${suffix}).`,
    ];
}

function describeScope(scope: AlphaRadarMaintenancePlanInput['scope'], reportPeriod?: string): string {
    if (scope.kind === 'tracked-filer') {
        return `${scope.trackedFilerId}${reportPeriod ? ` ${reportPeriod}` : ''}`;
    }
    if (scope.kind === 'filing') {
        return `${scope.trackedFilerId} filing ${scope.filingId}${reportPeriod ? ` ${reportPeriod}` : ''}`;
    }
    return `report ${scope.reportId}`;
}

function requirement(key: string, required: boolean, notes: string): AlphaRadarDeploymentRequirement {
    return {
        key,
        label: key,
        required,
        notes,
    };
}

function nextResetAt(window: AlphaRadarProviderBudgetWindow, now: Date): string {
    const reset = new Date(now);
    if (window === 'minute') {
        reset.setUTCSeconds(60, 0);
    } else if (window === 'hour') {
        reset.setUTCMinutes(60, 0, 0);
    } else if (window === 'day') {
        reset.setUTCHours(24, 0, 0, 0);
    } else {
        reset.setTime(now.getTime());
    }
    return reset.toISOString();
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
