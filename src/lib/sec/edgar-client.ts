import {
    alphaRadarAccessionSchema,
    alphaRadarCikSchema,
    alphaRadarFilingTypeSchema,
} from '@/lib/validators/alpha-radar';
import { createRequestTimeout, readResponseTextWithLimit } from './fetch-limits';
import { SecEdgarError, type SecCompanyMatch, type SecFilingMetadata, type SecFilingType } from './types';

export type SecFetch = (url: string, init: RequestInit) => Promise<Response>;
export type SecSleep = (ms: number) => Promise<void>;

export interface SecEdgarClientOptions {
    userAgent?: string;
    fetcher?: SecFetch;
    sleep?: SecSleep;
    minRequestIntervalMs?: number;
    maxRetries?: number;
    retryBaseDelayMs?: number;
    requestTimeoutMs?: number;
    maxJsonResponseBytes?: number;
    dataBaseUrl?: string;
    archivesBaseUrl?: string;
    companyTickersUrl?: string;
}

interface SecCompanyTickerRow {
    cik_str: number;
    ticker: string;
    title: string;
}

interface SecRecentFilings {
    accessionNumber: string[];
    filingDate: string[];
    reportDate: string[];
    acceptanceDateTime: string[];
    form: string[];
    primaryDocument: string[];
    primaryDocDescription?: string[];
}

interface SecSubmissionsResponse {
    cik: string | number;
    name?: string;
    filings?: {
        recent?: Partial<SecRecentFilings>;
    };
}

interface SecArchiveIndexItem {
    name?: unknown;
    type?: unknown;
    description?: unknown;
}

interface SecArchiveIndexResponse {
    directory?: {
        item?: unknown;
    };
}

const DEFAULT_USER_AGENT = 'Portfolio-Manager Alpha Radar local-dev contact@example.invalid';
const DEFAULT_DATA_BASE_URL = 'https://data.sec.gov';
const DEFAULT_ARCHIVES_BASE_URL = 'https://www.sec.gov/Archives';
const DEFAULT_COMPANY_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_JSON_RESPONSE_BYTES = 10 * 1024 * 1024;

export class SecEdgarClient {
    private readonly userAgent: string;
    private readonly fetcher: SecFetch;
    private readonly sleep: SecSleep;
    private readonly minRequestIntervalMs: number;
    private readonly maxRetries: number;
    private readonly retryBaseDelayMs: number;
    private readonly requestTimeoutMs: number;
    private readonly maxJsonResponseBytes: number;
    private readonly dataBaseUrl: string;
    private readonly archivesBaseUrl: string;
    private readonly companyTickersUrl: string;
    private lastRequestAt = 0;
    private companyCache: SecCompanyMatch[] | null = null;

    constructor(options: SecEdgarClientOptions = {}) {
        const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis);
        if (!fetcher) {
            throw new SecEdgarError('configuration', 'No fetch implementation is available for SEC EDGAR requests.');
        }

        this.userAgent = (options.userAgent ?? process.env.SEC_EDGAR_USER_AGENT ?? DEFAULT_USER_AGENT).trim();
        if (!this.userAgent) {
            throw new SecEdgarError('configuration', 'SEC EDGAR user-agent cannot be empty.');
        }

        this.fetcher = fetcher;
        this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        this.minRequestIntervalMs = options.minRequestIntervalMs ?? 125;
        this.maxRetries = options.maxRetries ?? 2;
        this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        this.maxJsonResponseBytes = options.maxJsonResponseBytes ?? DEFAULT_MAX_JSON_RESPONSE_BYTES;
        this.dataBaseUrl = trimTrailingSlash(options.dataBaseUrl ?? DEFAULT_DATA_BASE_URL);
        this.archivesBaseUrl = trimTrailingSlash(options.archivesBaseUrl ?? DEFAULT_ARCHIVES_BASE_URL);
        this.companyTickersUrl = options.companyTickersUrl ?? DEFAULT_COMPANY_TICKERS_URL;
    }

    async resolveCik(query: string): Promise<SecCompanyMatch> {
        const normalizedQuery = query.trim();
        const numericResult = alphaRadarCikSchema.safeParse(normalizedQuery);
        if (numericResult.success) {
            return { cik: numericResult.data, name: normalizedQuery };
        }

        const companies = await this.fetchCompanyTickers();
        const normalizedName = normalizeSearchText(normalizedQuery);
        const upperQuery = normalizedQuery.toUpperCase();
        const match = companies.find((company) => company.ticker === upperQuery)
            ?? companies.find((company) => normalizeSearchText(company.name) === normalizedName)
            ?? companies.find((company) => normalizeSearchText(company.name).includes(normalizedName));

        if (!match) {
            throw new SecEdgarError(
                'not_found',
                `No SEC CIK match found for "${query}". Add a tracked filer CIK or refine the SEC entity name.`,
            );
        }

        return match;
    }

    async fetchRecent13FFilings(input: {
        trackedFilerId: string;
        cik: string;
        limit?: number;
    }): Promise<SecFilingMetadata[]> {
        const cik = alphaRadarCikSchema.parse(input.cik);
        const submissions = await this.fetchSubmissions(cik);
        const recent = submissions.filings?.recent;
        if (!isValidRecentFilings(recent)) {
            throw new SecEdgarError('malformed_response', `SEC submissions response for CIK ${cik} is missing recent filing arrays.`);
        }

        const filings: SecFilingMetadata[] = [];
        const max = Math.min(recent.accessionNumber.length, input.limit ?? recent.accessionNumber.length);

        for (let index = 0; index < max; index += 1) {
            const parsedType = alphaRadarFilingTypeSchema.safeParse(recent.form[index]);
            if (!parsedType.success) continue;

            const accessionResult = alphaRadarAccessionSchema.safeParse(recent.accessionNumber[index]);
            if (!accessionResult.success) continue;

            const reportPeriod = reportDateToQuarter(recent.reportDate[index] || recent.filingDate[index]);
            if (!reportPeriod) continue;

            const accessionNumber = accessionResult.data;
            const primaryDocument = recent.primaryDocument[index];
            const primaryDocumentUrl = primaryDocument
                ? this.buildArchiveDocumentUrl(cik, accessionNumber, primaryDocument)
                : this.buildArchiveTextUrl(cik, accessionNumber);
            const informationTableUrl = await this.resolveInformationTableUrl({
                cik,
                accessionNumber,
                primaryDocumentUrl,
                primaryDocument,
                primaryDocDescription: recent.primaryDocDescription?.[index],
            });

            filings.push({
                trackedFilerId: input.trackedFilerId,
                cik,
                accessionNumber,
                filingType: parsedType.data,
                reportPeriod,
                filedAt: dateToIso(recent.filingDate[index]),
                acceptedAt: acceptanceDateToIso(recent.acceptanceDateTime[index]),
                primaryDocumentUrl,
                informationTableUrl,
                status: 'discovered',
                rawSubmission: buildRawSubmission(submissions, recent, index, parsedType.data),
            });
        }

        return filings;
    }

    private async fetchCompanyTickers(): Promise<SecCompanyMatch[]> {
        if (this.companyCache) return this.companyCache;

        const response = await this.requestJson<Record<string, SecCompanyTickerRow>>(this.companyTickersUrl);
        const companies = Object.values(response).map((row) => ({
            cik: alphaRadarCikSchema.parse(String(row.cik_str)),
            name: row.title,
            ticker: row.ticker?.toUpperCase(),
        }));

        this.companyCache = companies;
        return companies;
    }

    private async fetchSubmissions(cik: string): Promise<SecSubmissionsResponse> {
        return this.requestJson<SecSubmissionsResponse>(`${this.dataBaseUrl}/submissions/CIK${cik}.json`);
    }

    private async resolveInformationTableUrl(input: {
        cik: string;
        accessionNumber: string;
        primaryDocumentUrl: string | undefined;
        primaryDocument: string | undefined;
        primaryDocDescription: string | undefined;
    }): Promise<string | undefined> {
        const inferredUrl = inferInformationTableUrl(
            input.primaryDocumentUrl,
            input.primaryDocument,
            input.primaryDocDescription,
        );
        if (inferredUrl) return inferredUrl;

        try {
            const index = await this.requestJson<SecArchiveIndexResponse>(
                this.buildArchiveIndexUrl(input.cik, input.accessionNumber),
            );
            const attachment = findInformationTableAttachment(index, input.primaryDocument);
            return attachment
                ? this.buildArchiveDocumentUrl(input.cik, input.accessionNumber, attachment.name)
                : undefined;
        } catch {
            return undefined;
        }
    }

    private async requestJson<T>(url: string): Promise<T> {
        const response = await this.request(url);
        const text = await this.readJsonResponseText(response, url);
        try {
            return JSON.parse(text) as T;
        } catch (error) {
            throw new SecEdgarError('malformed_response', `SEC returned malformed JSON for ${url}.`, { cause: error });
        }
    }

    private async readJsonResponseText(response: Response, url: string): Promise<string> {
        try {
            return await readResponseTextWithLimit(response, {
                url,
                maxBytes: this.maxJsonResponseBytes,
                label: 'SEC JSON',
            });
        } catch (error) {
            throw new SecEdgarError('malformed_response', `SEC JSON response for ${url} exceeded configured safety limits.`, {
                cause: error,
            });
        }
    }

    private async request(url: string): Promise<Response> {
        let lastError: SecEdgarError | null = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
            if (attempt > 0 && lastError) {
                await this.sleep(lastError.retryAfterMs ?? this.retryBaseDelayMs * attempt);
            }

            await this.paceRequest();

            let response: Response;
            const timeout = createRequestTimeout(this.requestTimeoutMs);
            try {
                response = await this.fetcher(url, {
                    headers: {
                        'User-Agent': this.userAgent,
                        'Accept-Encoding': 'gzip, deflate',
                        Accept: 'application/json',
                    },
                    signal: timeout.signal,
                });
            } catch (error) {
                lastError = new SecEdgarError('network', `SEC EDGAR request failed for ${url}.`, { cause: error });
                continue;
            } finally {
                timeout.clear();
            }

            if (response.ok) return response;

            lastError = responseToError(url, response);
            if (!isRetryable(lastError) || attempt === this.maxRetries) {
                throw lastError;
            }
        }

        throw lastError ?? new SecEdgarError('network', `SEC EDGAR request failed for ${url}.`);
    }

    private async paceRequest(): Promise<void> {
        if (this.minRequestIntervalMs <= 0) return;

        const elapsed = Date.now() - this.lastRequestAt;
        if (this.lastRequestAt > 0 && elapsed < this.minRequestIntervalMs) {
            await this.sleep(this.minRequestIntervalMs - elapsed);
        }
        this.lastRequestAt = Date.now();
    }

    private buildArchiveDocumentUrl(cik: string, accessionNumber: string, documentName: string): string {
        return `${this.archivesBaseUrl}/edgar/data/${Number(cik)}/${accessionNumber.replaceAll('-', '')}/${documentName}`;
    }

    private buildArchiveTextUrl(cik: string, accessionNumber: string): string {
        return `${this.archivesBaseUrl}/edgar/data/${Number(cik)}/${accessionNumber.replaceAll('-', '')}/${accessionNumber}.txt`;
    }

    private buildArchiveIndexUrl(cik: string, accessionNumber: string): string {
        return `${this.archivesBaseUrl}/edgar/data/${Number(cik)}/${accessionNumber.replaceAll('-', '')}/index.json`;
    }
}

function responseToError(url: string, response: Response): SecEdgarError {
    const retryAfterMs = retryAfterToMs(response.headers.get('retry-after'));
    if (response.status === 429) {
        return new SecEdgarError('rate_limited', `SEC EDGAR rate limit hit for ${url}. Retry later.`, {
            status: response.status,
            retryAfterMs,
        });
    }

    return new SecEdgarError('http', `SEC EDGAR request failed for ${url}: ${response.status} ${response.statusText}`, {
        status: response.status,
        retryAfterMs,
    });
}

function isRetryable(error: SecEdgarError): boolean {
    return error.code === 'network'
        || error.code === 'rate_limited'
        || error.status === 500
        || error.status === 502
        || error.status === 503
        || error.status === 504;
}

function retryAfterToMs(value: string | null): number | undefined {
    if (!value) return undefined;

    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

    return undefined;
}

function trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
}

function normalizeSearchText(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function isValidRecentFilings(value: Partial<SecRecentFilings> | undefined): value is SecRecentFilings {
    if (!value) return false;

    const requiredArrays = [
        value.accessionNumber,
        value.filingDate,
        value.reportDate,
        value.acceptanceDateTime,
        value.form,
        value.primaryDocument,
    ];

    return requiredArrays.every(Array.isArray)
        && requiredArrays.every((arr) => arr.length === value.accessionNumber?.length);
}

function reportDateToQuarter(value: string | undefined): string | null {
    if (!value) return null;

    const parsed = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
    if (!parsed) return null;

    const month = Number(parsed[2]);
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;

    return `${parsed[1]}-Q${Math.ceil(month / 3)}`;
}

function dateToIso(value: string | undefined): string | undefined {
    if (!value) return undefined;

    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function acceptanceDateToIso(value: string | undefined): string | undefined {
    if (!value) return undefined;

    const timestamp = Date.parse(value.endsWith('Z') ? value : `${value}Z`);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function inferInformationTableUrl(
    primaryDocumentUrl: string | undefined,
    primaryDocument: string | undefined,
    description: string | undefined,
): string | undefined {
    if (!primaryDocumentUrl || !primaryDocument) return undefined;

    const lowerName = primaryDocument.toLowerCase();
    const lowerDescription = description?.toLowerCase() ?? '';
    if (lowerName.endsWith('.xml') || lowerDescription.includes('information table')) {
        return primaryDocumentUrl;
    }

    return undefined;
}

function findInformationTableAttachment(
    index: SecArchiveIndexResponse,
    primaryDocument: string | undefined,
): { name: string; score: number } | undefined {
    const items = normalizeArchiveItems(index.directory?.item);
    const candidates = items
        .map((item) => ({
            name: item.name,
            score: scoreInformationTableAttachment(item, primaryDocument),
        }))
        .filter((candidate): candidate is { name: string; score: number } => candidate.score > 0)
        .sort((left, right) => right.score - left.score);

    return candidates[0];
}

function normalizeArchiveItems(value: unknown): Array<{ name: string; type?: string; description?: string }> {
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];

        const archiveItem = item as SecArchiveIndexItem;
        if (typeof archiveItem.name !== 'string' || archiveItem.name.trim() === '') return [];

        return [{
            name: archiveItem.name.trim(),
            type: typeof archiveItem.type === 'string' ? archiveItem.type : undefined,
            description: typeof archiveItem.description === 'string' ? archiveItem.description : undefined,
        }];
    });
}

function scoreInformationTableAttachment(
    item: { name: string; type?: string; description?: string },
    primaryDocument: string | undefined,
): number {
    const lowerName = item.name.toLowerCase();
    if (primaryDocument && lowerName === primaryDocument.toLowerCase()) return 0;
    if (!lowerName.endsWith('.xml')) return 0;

    const lowerText = `${item.name} ${item.type ?? ''} ${item.description ?? ''}`.toLowerCase();
    let score = 0;

    if (lowerText.includes('information table') || lowerText.includes('informationtable')) score += 100;
    if (lowerText.includes('infotable') || lowerText.includes('info_table') || lowerText.includes('info-table')) score += 90;
    if (lowerText.includes('13f')) score += 20;
    if (lowerName.endsWith('.xml')) score += 1;

    return score >= 80 ? score : 0;
}

function buildRawSubmission(
    submissions: SecSubmissionsResponse,
    recent: SecRecentFilings,
    index: number,
    filingType: SecFilingType,
): Record<string, unknown> {
    return {
        secName: submissions.name,
        secCik: submissions.cik,
        accessionNumber: recent.accessionNumber[index],
        filingDate: recent.filingDate[index],
        reportDate: recent.reportDate[index],
        acceptanceDateTime: recent.acceptanceDateTime[index],
        form: filingType,
        primaryDocument: recent.primaryDocument[index],
        primaryDocDescription: recent.primaryDocDescription?.[index],
    };
}
