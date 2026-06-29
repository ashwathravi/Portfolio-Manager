import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
    ALPHA_RADAR_AGENT_CONTRACT_VERSION,
    ALPHA_RADAR_DEFAULT_RETRY_POLICY,
    ALPHA_RADAR_V2_BOUNDARIES,
    createAlphaRadarIdempotencyKey,
    createAlphaRadarJobEnvelope,
    getAlphaRadarBoundary,
    shouldRetryAlphaRadarAgentError,
    type AlphaRadarAgentError,
    type AlphaRadarAgentName,
    type AlphaRadarDiffJobPayload,
    type AlphaRadarParserJobPayload,
    type AlphaRadarThesisJobPayload,
} from './agent-contracts';
import type { AlphaRadarFilingRecord } from './contracts';
import type { AlphaRadarMemoChange } from './memo';

const FILING: AlphaRadarFilingRecord = {
    id: '33333333-3333-4333-8333-333333333333',
    trackedFilerId: '11111111-1111-4111-8111-111111111111',
    accessionNumber: '0000950123-26-000001',
    filingType: '13F-HR',
    reportPeriod: '2025-Q4',
    informationTableUrl: 'https://example.test/info.xml',
    status: 'stored',
};

const CHANGE: AlphaRadarMemoChange = {
    id: '44444444-4444-4444-8444-444444444444',
    trackedFilerId: FILING.trackedFilerId,
    currentFilingId: FILING.id,
    reportPeriod: FILING.reportPeriod,
    changeType: 'new',
    issuerName: 'Apple Inc',
    cusip: '037833100',
    ticker: 'AAPL',
    currentValueUsd: 125_000_000,
    valueDeltaUsd: 125_000_000,
    currentShares: 1_000_000,
    shareDelta: 1_000_000,
    currentWeight: 0.5,
    materialityScore: 92,
    userRelevance: {
        portfolio: true,
        watchlist: false,
        thesis: false,
        reasons: ['held in portfolio'],
        matchedTickers: ['AAPL'],
        matchedCusips: ['037833100'],
    },
    displayReason: 'New position in Apple Inc (AAPL), held in portfolio.',
    firstSeenReportPeriod: '2025-Q4',
};

describe('Alpha Radar v2 agent contracts', () => {
    test('defines one boundary for every approved v2 agent surface', () => {
        const agents = ALPHA_RADAR_V2_BOUNDARIES.map((boundary) => boundary.agent);
        const expected: AlphaRadarAgentName[] = [
            'scheduler-agent',
            'ingestion-agent',
            'sec-parser-agent',
            'portfolio-diff-agent',
            'semantic-search-agent',
            'thesis-agent',
            'notifier-agent',
            'ui-query-service',
        ];

        assert.deepStrictEqual(agents, expected);
        assert.ok(ALPHA_RADAR_V2_BOUNDARIES.every((boundary) => boundary.v1Adapter.length > 0));
        assert.strictEqual(getAlphaRadarBoundary('portfolio-diff-agent').operation, 'compute-quarterly-diff');
    });

    test('builds stable idempotency keys independent of object key insertion order', () => {
        const first = createAlphaRadarIdempotencyKey({
            agent: 'portfolio-diff-agent',
            operation: 'compute-quarterly-diff',
            scope: { kind: 'tracked-filer', trackedFilerId: FILING.trackedFilerId },
            reportPeriod: '2025-Q4',
            fingerprint: { b: 2, a: 1 },
        });
        const second = createAlphaRadarIdempotencyKey({
            agent: 'portfolio-diff-agent',
            operation: 'compute-quarterly-diff',
            scope: { trackedFilerId: FILING.trackedFilerId, kind: 'tracked-filer' },
            reportPeriod: '2025-Q4',
            fingerprint: { a: 1, b: 2 },
        });

        assert.strictEqual(first, second);
        assert.match(first, /^alpha-radar:alpha-radar-agent-contract-v1:portfolio-diff-agent:/);
    });

    test('creates a parser job envelope with default retry and trace semantics', () => {
        const payload: AlphaRadarParserJobPayload = {
            filing: FILING,
            informationTableXml: '<informationTable />',
            tickerByCusip: { '037833100': 'AAPL' },
        };

        const job = createAlphaRadarJobEnvelope({
            agent: 'sec-parser-agent',
            operation: 'parse-information-table',
            payload,
            scope: { kind: 'filing', trackedFilerId: FILING.trackedFilerId, filingId: FILING.id },
            reportPeriod: FILING.reportPeriod,
            requestedAt: '2026-05-13T17:00:00.000Z',
            trace: { traceId: 'trace-alpha-radar-v2', requestedBy: 'user' },
        });

        assert.strictEqual(job.contractVersion, ALPHA_RADAR_AGENT_CONTRACT_VERSION);
        assert.strictEqual(job.priority, 'normal');
        assert.strictEqual(job.attempt, 1);
        assert.strictEqual(job.retryPolicy, ALPHA_RADAR_DEFAULT_RETRY_POLICY);
        assert.strictEqual(job.trace?.requestedBy, 'user');
        assert.match(job.jobId, /^ar-job-/);
    });

    test('models the approved ingestion to parser to diff to thesis sequence', () => {
        const diffPayload: AlphaRadarDiffJobPayload = {
            trackedFilerId: FILING.trackedFilerId,
            reportPeriod: FILING.reportPeriod,
            currentFiling: FILING,
            currentHoldings: [{
                issuerName: 'Apple Inc',
                cusip: '037833100',
                ticker: 'AAPL',
                valueUsd: 125_000_000,
                shares: 1_000_000,
            }],
            priorHoldings: [],
            userRelevance: { portfolioTickers: ['AAPL'] },
        };
        const thesisPayload: AlphaRadarThesisJobPayload = {
            trackedFilerId: FILING.trackedFilerId,
            filerName: 'Berkshire Hathaway Inc',
            filingId: FILING.id,
            reportPeriod: FILING.reportPeriod,
            sourceFilingIds: [FILING.id],
            changes: [CHANGE],
            semanticContext: [{
                chunkId: 'chunk-apple-2025q4',
                sourceId: FILING.id,
                sourceKind: 'filing-text',
                text: 'Apple Inc was added as a reportable 13F holding.',
                score: 0.82,
                citation: {
                    kind: 'filing',
                    id: FILING.id,
                    title: 'Berkshire Hathaway 2025-Q4 13F',
                },
            }],
        };
        const pipeline = [
            createAlphaRadarJobEnvelope({
                agent: 'ingestion-agent',
                operation: 'refresh-filings',
                scope: { kind: 'tracked-filer', trackedFilerId: FILING.trackedFilerId, cik: '0001067983' },
                reportPeriod: FILING.reportPeriod,
                payload: { scope: { kind: 'tracked-filer', trackedFilerId: FILING.trackedFilerId }, filingLimit: 1 },
            }),
            createAlphaRadarJobEnvelope({
                agent: 'sec-parser-agent',
                operation: 'parse-information-table',
                scope: { kind: 'filing', trackedFilerId: FILING.trackedFilerId, filingId: FILING.id },
                reportPeriod: FILING.reportPeriod,
                payload: { filing: FILING, informationTableUrl: FILING.informationTableUrl },
            }),
            createAlphaRadarJobEnvelope({
                agent: 'portfolio-diff-agent',
                operation: 'compute-quarterly-diff',
                scope: { kind: 'filing', trackedFilerId: FILING.trackedFilerId, filingId: FILING.id },
                reportPeriod: FILING.reportPeriod,
                payload: diffPayload,
            }),
            createAlphaRadarJobEnvelope({
                agent: 'thesis-agent',
                operation: 'generate-thesis-draft',
                scope: { kind: 'filing', trackedFilerId: FILING.trackedFilerId, filingId: FILING.id },
                reportPeriod: FILING.reportPeriod,
                payload: thesisPayload,
            }),
        ];

        assert.deepStrictEqual(
            pipeline.map((job) => job.operation),
            ['refresh-filings', 'parse-information-table', 'compute-quarterly-diff', 'generate-thesis-draft'],
        );
        assert.ok(pipeline.every((job) => job.idempotencyKey.includes(FILING.reportPeriod.toLowerCase())));
    });

    test('retries only retryable errors within the attempt budget', () => {
        const rateLimit: AlphaRadarAgentError = {
            code: 'rate_limited',
            message: 'SEC returned a fair-use throttle response.',
            retryable: true,
        };
        const invalidInput: AlphaRadarAgentError = {
            code: 'invalid_input',
            message: 'Missing filing id.',
            retryable: false,
        };

        assert.strictEqual(shouldRetryAlphaRadarAgentError(rateLimit, 1), true);
        assert.strictEqual(shouldRetryAlphaRadarAgentError(rateLimit, 3), false);
        assert.strictEqual(shouldRetryAlphaRadarAgentError(invalidInput, 1), false);
    });
});
