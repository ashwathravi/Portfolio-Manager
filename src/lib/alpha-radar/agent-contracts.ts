import type { AlertRule, AlertTrigger } from '@/lib/alerts/types';
import type { AlphaRadarReportInput } from '@/lib/validators/alpha-radar';
import type { ParsedThirteenFHolding } from '@/lib/sec/thirteenf-parser';
import type { AlphaRadarDiffHolding, AlphaRadarHoldingChange, AlphaRadarUserOverlapInput } from './diff';
import type { AlphaRadarMemoChange } from './memo';
import type {
    AlphaRadarFilingRecord,
    AlphaRadarHoldingRecord,
    AlphaRadarReportRecord,
    AlphaRadarTrackedFilerRecord,
} from './contracts';
import type { AlphaRadarRefreshRunResult } from './refresh';

export const ALPHA_RADAR_AGENT_CONTRACT_VERSION = 'alpha-radar-agent-contract-v1';

export type AlphaRadarAgentName =
    | 'ingestion-agent'
    | 'sec-parser-agent'
    | 'portfolio-diff-agent'
    | 'thesis-agent'
    | 'notifier-agent'
    | 'scheduler-agent'
    | 'semantic-search-agent'
    | 'ui-query-service';

export type AlphaRadarJobOperation =
    | 'refresh-filings'
    | 'parse-information-table'
    | 'compute-quarterly-diff'
    | 'generate-thesis-draft'
    | 'notify-material-change'
    | 'schedule-refresh'
    | 'semantic-search'
    | 'read-ui-index';

export type AlphaRadarJobPriority = 'low' | 'normal' | 'high';

export type AlphaRadarJobStatus = 'succeeded' | 'failed' | 'skipped';

export type AlphaRadarAgentErrorCode =
    | 'invalid_input'
    | 'not_found'
    | 'rate_limited'
    | 'timeout'
    | 'provider_unavailable'
    | 'parse_failed'
    | 'storage_conflict'
    | 'db_deadlock'
    | 'unknown';

export interface AlphaRadarTraceContext {
    traceId?: string;
    parentJobId?: string;
    correlationId?: string;
    requestedBy?: 'user' | 'scheduler' | 'system';
}

export interface AlphaRadarRetryPolicy {
    maxAttempts: number;
    initialBackoffMs: number;
    maxBackoffMs: number;
    backoffMultiplier: number;
    jitter: boolean;
    retryableErrorCodes: readonly AlphaRadarAgentErrorCode[];
}

export interface AlphaRadarAgentError {
    code: AlphaRadarAgentErrorCode;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
}

export interface AlphaRadarAgentWarning {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}

export interface AlphaRadarJobEnvelope<TPayload> {
    jobId: string;
    agent: AlphaRadarAgentName;
    operation: AlphaRadarJobOperation;
    contractVersion: string;
    idempotencyKey: string;
    requestedAt: string;
    priority: AlphaRadarJobPriority;
    attempt: number;
    payload: TPayload;
    retryPolicy: AlphaRadarRetryPolicy;
    trace?: AlphaRadarTraceContext;
}

export interface AlphaRadarAgentResultBase {
    jobId: string;
    agent: AlphaRadarAgentName;
    operation: AlphaRadarJobOperation;
    idempotencyKey: string;
    completedAt: string;
    durationMs?: number;
    warnings?: readonly AlphaRadarAgentWarning[];
}

export type AlphaRadarAgentResult<TOutput> =
    | (AlphaRadarAgentResultBase & {
        status: 'succeeded';
        output: TOutput;
    })
    | (AlphaRadarAgentResultBase & {
        status: 'skipped';
        skipReason: string;
        output?: TOutput;
    })
    | (AlphaRadarAgentResultBase & {
        status: 'failed';
        error: AlphaRadarAgentError;
    });

export type AlphaRadarAgentScope =
    | { kind: 'all-tracked-filers' }
    | { kind: 'tracked-filer'; trackedFilerId: string; cik?: string; slug?: string }
    | { kind: 'filing'; trackedFilerId: string; filingId: string; accessionNumber?: string }
    | { kind: 'report'; reportId: string; trackedFilerId?: string };

export interface AlphaRadarIngestionJobPayload {
    scope: AlphaRadarAgentScope;
    filingLimit?: number;
    force?: boolean;
    includeAmendments?: boolean;
    acceptedAfter?: string;
}

export interface AlphaRadarIngestionResult {
    filers: Array<{
        trackedFilerId: string;
        cik?: string;
        fetched: number;
        stored: number;
        created: number;
        unchanged: number;
        filings: AlphaRadarFilingRecord[];
    }>;
    fetched: number;
    stored: number;
    created: number;
    unchanged: number;
}

export interface AlphaRadarParserJobPayload {
    filing: AlphaRadarFilingRecord;
    informationTableXml?: string;
    informationTableUrl?: string;
    tickerByCusip?: Record<string, string>;
}

export interface AlphaRadarParserResult {
    filingId: string;
    accessionNumber: string;
    reportPeriod: string;
    holdings: ParsedThirteenFHolding[];
    totalValueUsd: number;
}

export interface AlphaRadarDiffJobPayload {
    trackedFilerId: string;
    reportPeriod: string;
    currentFiling: AlphaRadarFilingRecord;
    priorFiling?: AlphaRadarFilingRecord;
    currentHoldings: readonly AlphaRadarDiffHolding[];
    priorHoldings: readonly AlphaRadarDiffHolding[];
    amendedCusips?: readonly string[];
    userRelevance?: AlphaRadarUserOverlapInput;
}

export interface AlphaRadarDiffResult {
    trackedFilerId: string;
    reportPeriod: string;
    currentFilingId: string;
    priorFilingId?: string;
    changes: AlphaRadarHoldingChange[];
    materialChangeCount: number;
    unchangedCount: number;
    topMaterialityScore?: number;
}

export type AlphaRadarEvidenceKind =
    | 'filing'
    | 'holding-change'
    | 'memo-section'
    | 'semantic-chunk'
    | 'external-overlay';

export interface AlphaRadarEvidenceLink {
    kind: AlphaRadarEvidenceKind;
    id: string;
    title: string;
    url?: string;
    citation?: string;
}

export interface AlphaRadarThesisDraft {
    id?: string;
    title: string;
    hypothesis: string;
    whyNow: string;
    falsifyIf: string;
    supportingEvidence: AlphaRadarEvidenceLink[];
    risks: string[];
    nextWatchItems: string[];
    confidence: 'low' | 'medium' | 'high';
    sourceReportId?: string;
}

export interface AlphaRadarSemanticContextSnippet {
    chunkId: string;
    sourceId: string;
    sourceKind: AlphaRadarSemanticSourceKind;
    text: string;
    score: number;
    citation: AlphaRadarEvidenceLink;
}

export interface AlphaRadarExternalOverlay {
    provider: string;
    kind: 'insider-activity' | 'transcript-sentiment' | 'valuation' | 'theme-exposure';
    issuerName: string;
    ticker?: string;
    summary: string;
    asOf: string;
    evidence: AlphaRadarEvidenceLink[];
}

export interface AlphaRadarThesisJobPayload {
    trackedFilerId: string;
    filerName: string;
    filingId?: string;
    reportPeriod: string;
    sourceFilingIds: readonly string[];
    changes: readonly AlphaRadarMemoChange[];
    semanticContext?: readonly AlphaRadarSemanticContextSnippet[];
    externalOverlays?: readonly AlphaRadarExternalOverlay[];
    existingThesisIds?: readonly string[];
}

export interface AlphaRadarThesisResult {
    report: AlphaRadarReportInput;
    thesisDrafts: AlphaRadarThesisDraft[];
    evidenceLinks: AlphaRadarEvidenceLink[];
}

export type AlphaRadarNotificationChannel = 'in-app' | 'email' | 'slack' | 'telegram';

export interface AlphaRadarNotifierJobPayload {
    report?: AlphaRadarReportRecord | AlphaRadarReportInput;
    changes: readonly AlphaRadarMemoChange[];
    rules: readonly AlertRule[];
    channels: readonly AlphaRadarNotificationChannel[];
    dryRun?: boolean;
}

export interface AlphaRadarNotifierResult {
    createdTriggers: AlertTrigger[];
    delivered: Array<{
        channel: AlphaRadarNotificationChannel;
        triggerId: string;
        destination?: string;
    }>;
    suppressed: Array<{
        ruleId: string;
        changeId?: string;
        reason: string;
    }>;
}

export interface AlphaRadarSchedulerJobPayload {
    trigger: 'manual' | 'cron' | 'webhook';
    scope: AlphaRadarAgentScope;
    scheduledFor?: string;
    cadence?: 'weekly' | 'quarterly' | 'adhoc';
    downstreamOperations: readonly AlphaRadarJobOperation[];
}

export interface AlphaRadarScheduledJobRef {
    jobId: string;
    agent: AlphaRadarAgentName;
    operation: AlphaRadarJobOperation;
    idempotencyKey: string;
    status: 'queued' | 'deduped' | 'blocked';
}

export interface AlphaRadarSchedulerResult {
    enqueuedJobs: AlphaRadarScheduledJobRef[];
    skippedJobs: Array<{
        idempotencyKey: string;
        reason: string;
    }>;
}

export type AlphaRadarSemanticSourceKind =
    | 'filing-text'
    | 'memo-section'
    | 'thesis-draft'
    | 'external-overlay';

export interface AlphaRadarSemanticSearchPayload {
    query: string;
    filters?: {
        trackedFilerIds?: readonly string[];
        reportPeriods?: readonly string[];
        tickers?: readonly string[];
        sourceKinds?: readonly AlphaRadarSemanticSourceKind[];
    };
    topK?: number;
    includeRawText?: boolean;
}

export interface AlphaRadarSemanticSearchResult {
    provider: 'pgvector' | 'keyword-fallback' | 'disabled';
    matches: AlphaRadarSemanticContextSnippet[];
}

export type AlphaRadarUiQueryInclude =
    | 'filers'
    | 'filings'
    | 'holdings'
    | 'changes'
    | 'reports'
    | 'refresh-runs'
    | 'semantic-memory';

export interface AlphaRadarUiQueryPayload {
    trackedFilerId?: string;
    reportPeriod?: string;
    include: readonly AlphaRadarUiQueryInclude[];
    limit?: number;
}

export interface AlphaRadarUiQueryResult {
    generatedAt: string;
    filers?: AlphaRadarTrackedFilerRecord[];
    filings?: AlphaRadarFilingRecord[];
    holdings?: AlphaRadarHoldingRecord[];
    changes?: AlphaRadarMemoChange[];
    reports?: AlphaRadarReportRecord[];
    refreshRuns?: AlphaRadarRefreshRunResult[];
    semanticMemory?: AlphaRadarSemanticSearchResult;
}

export interface AlphaRadarIngestionAgent {
    refreshFilings(
        job: AlphaRadarJobEnvelope<AlphaRadarIngestionJobPayload>,
    ): Promise<AlphaRadarAgentResult<AlphaRadarIngestionResult>>;
}

export interface AlphaRadarParserAgent {
    parseInformationTable(
        job: AlphaRadarJobEnvelope<AlphaRadarParserJobPayload>,
    ): Promise<AlphaRadarAgentResult<AlphaRadarParserResult>>;
}

export interface AlphaRadarDiffAgent {
    computeQuarterlyDiff(
        job: AlphaRadarJobEnvelope<AlphaRadarDiffJobPayload>,
    ): Promise<AlphaRadarAgentResult<AlphaRadarDiffResult>>;
}

export interface AlphaRadarThesisAgent {
    generateThesisDraft(
        job: AlphaRadarJobEnvelope<AlphaRadarThesisJobPayload>,
    ): Promise<AlphaRadarAgentResult<AlphaRadarThesisResult>>;
}

export interface AlphaRadarNotifierAgent {
    notifyMaterialChange(
        job: AlphaRadarJobEnvelope<AlphaRadarNotifierJobPayload>,
    ): Promise<AlphaRadarAgentResult<AlphaRadarNotifierResult>>;
}

export interface AlphaRadarSchedulerAgent {
    scheduleRefresh(
        job: AlphaRadarJobEnvelope<AlphaRadarSchedulerJobPayload>,
    ): Promise<AlphaRadarAgentResult<AlphaRadarSchedulerResult>>;
}

export interface AlphaRadarSemanticSearchAgent {
    search(
        job: AlphaRadarJobEnvelope<AlphaRadarSemanticSearchPayload>,
    ): Promise<AlphaRadarAgentResult<AlphaRadarSemanticSearchResult>>;
}

export interface AlphaRadarUiQueryService {
    readUiIndex(
        job: AlphaRadarJobEnvelope<AlphaRadarUiQueryPayload>,
    ): Promise<AlphaRadarAgentResult<AlphaRadarUiQueryResult>>;
}

export interface AlphaRadarAgentBoundaryDefinition {
    agent: AlphaRadarAgentName;
    operation: AlphaRadarJobOperation;
    ownerModule: string;
    v1Adapter: string;
    downstreamIssues: readonly string[];
    notes: string;
}

export const ALPHA_RADAR_DEFAULT_RETRY_POLICY: AlphaRadarRetryPolicy = {
    maxAttempts: 3,
    initialBackoffMs: 1_000,
    maxBackoffMs: 30_000,
    backoffMultiplier: 2,
    jitter: true,
    retryableErrorCodes: ['rate_limited', 'timeout', 'provider_unavailable', 'storage_conflict', 'db_deadlock'],
};

export const ALPHA_RADAR_V2_BOUNDARIES: readonly AlphaRadarAgentBoundaryDefinition[] = [
    {
        agent: 'scheduler-agent',
        operation: 'schedule-refresh',
        ownerModule: 'src/lib/alpha-radar/scheduler',
        v1Adapter: 'Manual refresh actions from src/lib/alpha-radar/refresh.ts',
        downstreamIssues: ['AR-131', 'AR-133'],
        notes: 'Owns cadence, dedupe, and job history; it does not parse SEC data directly.',
    },
    {
        agent: 'ingestion-agent',
        operation: 'refresh-filings',
        ownerModule: 'src/lib/sec',
        v1Adapter: 'AlphaRadarSecIngestionService',
        downstreamIssues: ['AR-126', 'AR-131', 'AR-133'],
        notes: 'Fetches filing metadata and stores SEC filing rows; XML parsing stays in the parser boundary.',
    },
    {
        agent: 'sec-parser-agent',
        operation: 'parse-information-table',
        ownerModule: 'src/lib/sec',
        v1Adapter: 'parseThirteenFInformationTable',
        downstreamIssues: ['AR-126', 'AR-132'],
        notes: 'Normalizes information table XML into holdings with audit metadata.',
    },
    {
        agent: 'portfolio-diff-agent',
        operation: 'compute-quarterly-diff',
        ownerModule: 'src/lib/alpha-radar',
        v1Adapter: 'computeQuarterlyHoldingChanges',
        downstreamIssues: ['AR-127', 'AR-128', 'AR-132'],
        notes: 'Computes material deltas and user relevance; no external provider calls.',
    },
    {
        agent: 'semantic-search-agent',
        operation: 'semantic-search',
        ownerModule: 'src/lib/alpha-radar/memory',
        v1Adapter: 'No v1 adapter; starts with keyword-disabled fallback until pgvector is available.',
        downstreamIssues: ['AR-126', 'AR-130'],
        notes: 'Owns semantic recall over filing chunks, memo sections, and thesis drafts.',
    },
    {
        agent: 'thesis-agent',
        operation: 'generate-thesis-draft',
        ownerModule: 'src/lib/alpha-radar/thesis',
        v1Adapter: 'generateAlphaRadarMemo',
        downstreamIssues: ['AR-128', 'AR-129', 'AR-130'],
        notes: 'Turns deltas, overlays, and memory snippets into reviewable report/thesis drafts.',
    },
    {
        agent: 'notifier-agent',
        operation: 'notify-material-change',
        ownerModule: 'src/lib/alerts',
        v1Adapter: 'evaluateAlphaRadarAlerts',
        downstreamIssues: ['AR-131', 'AR-133'],
        notes: 'Maps material changes to configured delivery channels with per-rule suppression.',
    },
    {
        agent: 'ui-query-service',
        operation: 'read-ui-index',
        ownerModule: 'src/lib/api/alpha-radar',
        v1Adapter: 'src/lib/api/alpha-radar/queries.ts',
        downstreamIssues: ['AR-127', 'AR-130', 'AR-137'],
        notes: 'Provides read-optimized UI shapes without owning ingestion or generation side effects.',
    },
];

export interface CreateAlphaRadarJobEnvelopeInput<TPayload> {
    agent: AlphaRadarAgentName;
    operation: AlphaRadarJobOperation;
    payload: TPayload;
    scope: AlphaRadarAgentScope | string;
    reportPeriod?: string;
    requestedAt?: string;
    jobId?: string;
    contractVersion?: string;
    idempotencyKey?: string;
    priority?: AlphaRadarJobPriority;
    attempt?: number;
    retryPolicy?: AlphaRadarRetryPolicy;
    trace?: AlphaRadarTraceContext;
}

export function createAlphaRadarJobEnvelope<TPayload>(
    input: CreateAlphaRadarJobEnvelopeInput<TPayload>,
): AlphaRadarJobEnvelope<TPayload> {
    const requestedAt = input.requestedAt ?? new Date().toISOString();
    const contractVersion = input.contractVersion ?? ALPHA_RADAR_AGENT_CONTRACT_VERSION;
    const idempotencyKey = input.idempotencyKey ?? createAlphaRadarIdempotencyKey({
        agent: input.agent,
        operation: input.operation,
        scope: input.scope,
        reportPeriod: input.reportPeriod,
        fingerprint: input.payload,
        contractVersion,
    });

    return {
        jobId: input.jobId ?? `ar-job-${hashString(`${idempotencyKey}:${requestedAt}`)}`,
        agent: input.agent,
        operation: input.operation,
        contractVersion,
        idempotencyKey,
        requestedAt,
        priority: input.priority ?? 'normal',
        attempt: input.attempt ?? 1,
        payload: input.payload,
        retryPolicy: input.retryPolicy ?? ALPHA_RADAR_DEFAULT_RETRY_POLICY,
        trace: input.trace,
    };
}

export interface AlphaRadarIdempotencyKeyInput {
    agent: AlphaRadarAgentName;
    operation: AlphaRadarJobOperation;
    scope: AlphaRadarAgentScope | string;
    reportPeriod?: string;
    fingerprint?: unknown;
    contractVersion?: string;
}

export function createAlphaRadarIdempotencyKey(input: AlphaRadarIdempotencyKeyInput): string {
    const scope = typeof input.scope === 'string' ? input.scope : stableStringify(input.scope);
    const fingerprint = input.fingerprint === undefined ? 'none' : stableStringify(input.fingerprint);
    return [
        'alpha-radar',
        input.contractVersion ?? ALPHA_RADAR_AGENT_CONTRACT_VERSION,
        input.agent,
        input.operation,
        normalizeKeySegment(input.reportPeriod ?? 'any-period'),
        normalizeKeySegment(scope),
        hashString(fingerprint),
    ].join(':');
}

export function shouldRetryAlphaRadarAgentError(
    error: AlphaRadarAgentError,
    attempt: number,
    policy: AlphaRadarRetryPolicy = ALPHA_RADAR_DEFAULT_RETRY_POLICY,
): boolean {
    return error.retryable
        && attempt < policy.maxAttempts
        && policy.retryableErrorCodes.includes(error.code);
}

export function getAlphaRadarBoundary(agent: AlphaRadarAgentName): AlphaRadarAgentBoundaryDefinition {
    const boundary = ALPHA_RADAR_V2_BOUNDARIES.find((item) => item.agent === agent);
    if (!boundary) {
        throw new Error(`Unknown Alpha Radar agent boundary: ${agent}`);
    }
    return boundary;
}

function normalizeKeySegment(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._:-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'none';
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }

    if (value && typeof value === 'object') {
        const object = value as Record<string, unknown>;
        return `{${Object.keys(object)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
            .join(',')}}`;
    }

    return JSON.stringify(value) ?? 'undefined';
}

function hashString(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}
