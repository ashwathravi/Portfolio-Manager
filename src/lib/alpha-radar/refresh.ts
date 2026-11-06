import {
    DeterministicAlphaRadarMemoAdapter,
    type AlphaRadarMemoAdapter,
    type AlphaRadarMemoChange,
} from './memo';
import {
    computeQuarterlyHoldingChanges,
    type AlphaRadarHoldingChange,
} from './diff';
import {
    configuredSecUserAgent,
    parseThirteenFInformationTable,
    SEC_USER_AGENT_MISSING,
    SecEdgarError,
    type SecRefreshFilerResult,
    type SecTrackedFilerRef,
    type StoredSecFiling,
} from '@/lib/sec';
import { createRequestTimeout, readResponseTextWithLimit } from '@/lib/sec/fetch-limits';
import type { ParsedThirteenFHolding } from '@/lib/sec/thirteenf-parser';
import { reportError as reportToSentry } from '@/lib/observability/report-error';
import type { AlphaRadarFilingRecord, AlphaRadarHoldingRecord, AlphaRadarTrackedFilerRecord } from './contracts';
import { MAX_EMBEDDED_CHUNKS } from './embeddings';
import {
    buildAlphaRadarFilingMemoryChunks,
    buildAlphaRadarReportMemoryChunks,
    embedAlphaRadarSemanticChunks,
    type AlphaRadarEmbeddingProvider,
    type AlphaRadarSemanticChunk,
} from './memory';
import type { AlphaRadarFilingMemoryInput } from './memory-repository';
import type { StoredAlphaRadarReport } from './report-repository';
import type { AlphaRadarReportInput } from '@/lib/validators/alpha-radar';

const SEC_INFORMATION_TABLE_TIMEOUT_MS = 10_000;
const SEC_INFORMATION_TABLE_MAX_BYTES = 25 * 1024 * 1024;

export interface AlphaRadarRefreshRepository {
    listEnabledTrackedFilers(): Promise<AlphaRadarTrackedFilerRecord[]>;
    getTrackedFiler(idOrSlug: string): Promise<AlphaRadarTrackedFilerRecord | null>;
    findPriorFiling(input: { trackedFilerId: string; reportPeriod: string }): Promise<AlphaRadarFilingRecord | null>;
    listHoldingsForFiling(filingId: string): Promise<AlphaRadarHoldingRecord[]>;
    replaceFilingHoldings(filingId: string, holdings: readonly ParsedThirteenFHolding[]): Promise<{ inserted: number }>;
    markFilingParseFailed(filingId: string, message: string): Promise<void>;
    upsertHoldingChanges(changes: readonly AlphaRadarHoldingChange[]): Promise<AlphaRadarMemoChange[]>;
}

export interface AlphaRadarReportWriter {
    upsertReport(report: AlphaRadarReportInput): Promise<StoredAlphaRadarReport>;
}

export interface AlphaRadarSecRefreshService {
    refreshFiler(filer: SecTrackedFilerRef, options?: { filingLimit?: number }): Promise<SecRefreshFilerResult>;
}

export type AlphaRadarInformationTableFetcher = (filing: StoredSecFiling) => Promise<string>;

export interface AlphaRadarMemoryWriter {
    replaceFilingMemory(input: AlphaRadarFilingMemoryInput): Promise<{ inserted: number }>;
}

export interface AlphaRadarRefreshServiceOptions {
    secIngestion: AlphaRadarSecRefreshService;
    repository: AlphaRadarRefreshRepository;
    reportRepository: AlphaRadarReportWriter;
    memoAdapter?: AlphaRadarMemoAdapter;
    fetchInformationTableXml?: AlphaRadarInformationTableFetcher;
    filingLimit?: number;
    /** Where a parsed filing's evidence memory is stored (launch item i62); none without it. */
    memory?: AlphaRadarMemoryWriter;
    /** Embeds that memory; without one it's found by keyword. */
    embeddings?: AlphaRadarEmbeddingProvider | null;
    /** Where a memory that couldn't be stored or embedded is reported; Sentry by default. */
    reportError?: (error: unknown) => void;
}

export interface AlphaRadarRefreshOptions {
    force?: boolean;
    filingLimit?: number;
}

export interface AlphaRadarFilingRefreshResult {
    filingId?: string;
    accessionNumber: string;
    reportPeriod: string;
    status: 'parsed' | 'skipped' | 'failed';
    created: boolean;
    holdingsParsed: number;
    changesGenerated: number;
    memoGenerated: boolean;
    reportId?: string;
    /** Chunks of the filing and its report stored in evidence memory, and how many were embedded. */
    memoryChunks?: number;
    embeddedChunks?: number;
    message?: string;
}

export interface AlphaRadarFilerRefreshResult {
    trackedFilerId: string;
    filerName: string;
    cik?: string;
    fetched: number;
    skipped: number;
    parsed: number;
    changed: number;
    memoGenerated: number;
    filings: AlphaRadarFilingRefreshResult[];
    errors: Array<{
        accessionNumber?: string;
        message: string;
        code?: string;
    }>;
}

export interface AlphaRadarRefreshRunResult {
    scope: 'all' | 'filer';
    startedAt: string;
    completedAt: string;
    totalFilers: number;
    fetched: number;
    skipped: number;
    parsed: number;
    changed: number;
    memoGenerated: number;
    filers: AlphaRadarFilerRefreshResult[];
    errors: AlphaRadarFilerRefreshResult['errors'];
}

export class AlphaRadarRefreshService {
    private readonly memoAdapter: AlphaRadarMemoAdapter;
    private readonly fetchInformationTableXml: AlphaRadarInformationTableFetcher;
    private readonly filingLimit?: number;

    constructor(private readonly options: AlphaRadarRefreshServiceOptions) {
        this.memoAdapter = options.memoAdapter ?? new DeterministicAlphaRadarMemoAdapter();
        this.fetchInformationTableXml = options.fetchInformationTableXml ?? defaultFetchInformationTableXml;
        this.filingLimit = options.filingLimit;
    }

    async refreshAll(options: AlphaRadarRefreshOptions = {}): Promise<AlphaRadarRefreshRunResult> {
        const startedAt = new Date().toISOString();
        const filers = await this.options.repository.listEnabledTrackedFilers();
        const results: AlphaRadarFilerRefreshResult[] = [];

        for (const filer of filers) {
            results.push(await this.refreshFilerRecord(filer, options));
        }

        return summarizeRun('all', startedAt, results);
    }

    async refreshFiler(idOrSlug: string, options: AlphaRadarRefreshOptions = {}): Promise<AlphaRadarRefreshRunResult> {
        const startedAt = new Date().toISOString();
        const filer = await this.options.repository.getTrackedFiler(idOrSlug);
        if (!filer) {
            const completedAt = new Date().toISOString();
            return {
                scope: 'filer',
                startedAt,
                completedAt,
                totalFilers: 0,
                fetched: 0,
                skipped: 0,
                parsed: 0,
                changed: 0,
                memoGenerated: 0,
                filers: [],
                errors: [{ message: `Tracked filer not found: ${idOrSlug}` }],
            };
        }

        return summarizeRun('filer', startedAt, [await this.refreshFilerRecord(filer, options)]);
    }

    private async refreshFilerRecord(
        filer: AlphaRadarTrackedFilerRecord,
        options: AlphaRadarRefreshOptions,
    ): Promise<AlphaRadarFilerRefreshResult> {
        const result: AlphaRadarFilerRefreshResult = {
            trackedFilerId: filer.id,
            filerName: filer.name,
            cik: filer.cik,
            fetched: 0,
            skipped: 0,
            parsed: 0,
            changed: 0,
            memoGenerated: 0,
            filings: [],
            errors: [],
        };

        let secResult: SecRefreshFilerResult;
        try {
            secResult = await this.options.secIngestion.refreshFiler(filer, {
                filingLimit: options.filingLimit ?? this.filingLimit,
            });
        } catch (error) {
            result.errors.push(toRefreshError(error));
            return result;
        }

        result.cik = secResult.cik;
        result.fetched = secResult.fetched;

        // Oldest quarter first, so each quarter's changes are counted from the
        // one before it, parsed by then: SEC lists the newest first.
        const oldestFirst = [...secResult.filings].sort((a, b) => a.reportPeriod.localeCompare(b.reportPeriod));
        for (const filing of oldestFirst) {
            // A filing seen before is parsed again only while it's waiting
            // to be: never tried, or SEC now lists another table for it.
            if (!filing.created && filing.status !== 'discovered' && !options.force) {
                result.skipped += 1;
                result.filings.push({
                    filingId: filing.id,
                    accessionNumber: filing.accessionNumber,
                    reportPeriod: filing.reportPeriod,
                    status: 'skipped',
                    created: false,
                    holdingsParsed: 0,
                    changesGenerated: 0,
                    memoGenerated: false,
                    message: 'Filing already known; use force to re-parse.',
                });
                continue;
            }

            const filingResult = await this.parseFiling(filer, filing);
            result.filings.push(filingResult);
            if (filingResult.status === 'parsed') {
                result.parsed += 1;
                result.changed += filingResult.changesGenerated;
                if (filingResult.memoGenerated) result.memoGenerated += 1;
            } else if (filingResult.status === 'failed') {
                result.errors.push({
                    accessionNumber: filing.accessionNumber,
                    message: filingResult.message ?? 'Unknown Alpha Radar filing parse error',
                });
            }
        }

        return result;
    }

    private async parseFiling(
        filer: AlphaRadarTrackedFilerRecord,
        filing: StoredSecFiling,
    ): Promise<AlphaRadarFilingRefreshResult> {
        const base = {
            filingId: filing.id,
            accessionNumber: filing.accessionNumber,
            reportPeriod: filing.reportPeriod,
            created: filing.created,
        };

        if (!filing.id) {
            return {
                ...base,
                status: 'failed',
                holdingsParsed: 0,
                changesGenerated: 0,
                memoGenerated: false,
                message: 'Stored SEC filing did not include a database id.',
            };
        }

        try {
            const xml = await this.fetchInformationTableXml(filing);
            const parsed = parseThirteenFInformationTable(xml, {
                filingId: filing.id,
                accessionNumber: filing.accessionNumber,
                filerName: filer.name,
                reportPeriod: filing.reportPeriod,
            });
            await this.options.repository.replaceFilingHoldings(filing.id, parsed.holdings);

            const priorFiling = await this.options.repository.findPriorFiling({
                trackedFilerId: filer.id,
                reportPeriod: filing.reportPeriod,
            });
            const priorHoldings = priorFiling ? await this.options.repository.listHoldingsForFiling(priorFiling.id) : [];
            const changes = computeQuarterlyHoldingChanges({
                trackedFilerId: filer.id,
                currentFilingId: filing.id,
                priorFilingId: priorFiling?.id,
                reportPeriod: filing.reportPeriod,
                currentHoldings: parsed.holdings,
                priorHoldings,
            });
            const storedChanges = await this.options.repository.upsertHoldingChanges(changes);
            const report = await this.memoAdapter.generate({
                trackedFilerId: filer.id,
                filingId: filing.id,
                filerName: filer.name,
                reportPeriod: filing.reportPeriod,
                sourceFilingIds: priorFiling ? [filing.id, priorFiling.id] : [filing.id],
                changes: storedChanges,
            });
            const storedReport = await this.options.reportRepository.upsertReport(report);
            const memory = await this.storeMemory(filer, { ...filing, id: filing.id }, parsed.holdings, { ...report, id: storedReport.id });

            return {
                ...base,
                status: 'parsed',
                holdingsParsed: parsed.holdings.length,
                changesGenerated: storedChanges.filter((change) => change.changeType !== 'unchanged').length,
                memoGenerated: true,
                reportId: storedReport.id,
                ...memory,
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown Alpha Radar parse error';
            await this.options.repository.markFilingParseFailed(filing.id, message);
            return {
                ...base,
                status: 'failed',
                holdingsParsed: 0,
                changesGenerated: 0,
                memoGenerated: false,
                message,
            };
        }
    }

    /**
     * The filing's holdings and its report, chunked into evidence memory
     * (launch item i62) and embedded when embeddings are on. The report is
     * stored either way: a memory that can't be stored is reported, and is
     * stored the next time the filing is parsed; one that can't be embedded
     * is stored without embeddings.
     */
    private async storeMemory(
        filer: AlphaRadarTrackedFilerRecord,
        filing: StoredSecFiling & { id: string },
        holdings: readonly ParsedThirteenFHolding[],
        report: AlphaRadarReportInput & { id: string },
    ): Promise<Pick<AlphaRadarFilingRefreshResult, 'memoryChunks' | 'embeddedChunks'>> {
        const memory = this.options.memory;
        if (!memory) return {};
        const record: AlphaRadarFilingRecord = {
            id: filing.id,
            trackedFilerId: filing.trackedFilerId,
            accessionNumber: filing.accessionNumber,
            filingType: filing.filingType,
            reportPeriod: filing.reportPeriod,
            primaryDocumentUrl: filing.primaryDocumentUrl,
            informationTableUrl: filing.informationTableUrl,
            status: 'parsed',
        };
        const chunks = [
            ...buildAlphaRadarFilingMemoryChunks({ filing: record, holdings, filer }),
            ...buildAlphaRadarReportMemoryChunks({ report, filer }),
        ];
        const embedded = await this.embed(chunks);
        try {
            await memory.replaceFilingMemory({ filingId: filing.id, reportId: report.id, chunks: embedded });
        } catch (error) {
            this.report(error);
            return { memoryChunks: 0, embeddedChunks: 0 };
        }
        return { memoryChunks: embedded.length, embeddedChunks: embedded.filter((chunk) => chunk.embedding?.length).length };
    }

    private async embed(chunks: AlphaRadarSemanticChunk[]): Promise<AlphaRadarSemanticChunk[]> {
        const provider = this.options.embeddings;
        if (!provider?.isEnabled() || chunks.length === 0) return chunks;
        try {
            const embedded = await embedAlphaRadarSemanticChunks(chunks.slice(0, MAX_EMBEDDED_CHUNKS), provider);
            return [...embedded, ...chunks.slice(MAX_EMBEDDED_CHUNKS)];
        } catch (error) {
            this.report(error);
            return chunks;
        }
    }

    private report(error: unknown): void {
        (this.options.reportError ?? ((cause) => reportToSentry(cause, { tags: { job: 'alpha-radar', step: 'memory' } })))(error);
    }
}

export async function defaultFetchInformationTableXml(filing: StoredSecFiling, stop?: AbortSignal): Promise<string> {
    // The primary document is the cover page, never the table (launch item i62).
    const url = filing.informationTableUrl;
    if (!url) {
        throw new Error(`SEC lists no information table among the documents of filing ${filing.accessionNumber}.`);
    }

    const userAgent = configuredSecUserAgent();
    if (!userAgent) throw new SecEdgarError('configuration', SEC_USER_AGENT_MISSING);
    const timeout = createRequestTimeout(SEC_INFORMATION_TABLE_TIMEOUT_MS, stop);
    let response: Response;
    try {
        response = await fetch(url, {
            headers: {
                'User-Agent': userAgent,
                Accept: 'application/xml,text/xml,text/plain,*/*',
            },
            signal: timeout.signal,
        });
    } finally {
        timeout.clear();
    }

    if (!response.ok) {
        throw new Error(`SEC information table fetch failed for ${filing.accessionNumber}: HTTP ${response.status}`);
    }
    return readResponseTextWithLimit(response, {
        url,
        maxBytes: SEC_INFORMATION_TABLE_MAX_BYTES,
        label: 'SEC information table XML',
    });
}

function summarizeRun(
    scope: AlphaRadarRefreshRunResult['scope'],
    startedAt: string,
    filers: AlphaRadarFilerRefreshResult[],
): AlphaRadarRefreshRunResult {
    const errors = filers.flatMap((filer) => filer.errors);
    return {
        scope,
        startedAt,
        completedAt: new Date().toISOString(),
        totalFilers: filers.length,
        fetched: sum(filers, (filer) => filer.fetched),
        skipped: sum(filers, (filer) => filer.skipped),
        parsed: sum(filers, (filer) => filer.parsed),
        changed: sum(filers, (filer) => filer.changed),
        memoGenerated: sum(filers, (filer) => filer.memoGenerated),
        filers,
        errors,
    };
}

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
    return items.reduce((total, item) => total + pick(item), 0);
}

function toRefreshError(error: unknown): AlphaRadarFilerRefreshResult['errors'][number] {
    return {
        message: error instanceof Error ? error.message : 'Unknown Alpha Radar refresh error',
        code: error instanceof SecEdgarError ? error.code : undefined,
    };
}
