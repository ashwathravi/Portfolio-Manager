export type SecFilingType = '13F-HR' | '13F-HR/A';

export type SecEdgarErrorCode =
    | 'configuration'
    | 'http'
    | 'malformed_response'
    | 'network'
    | 'not_found'
    | 'rate_limited';

export class SecEdgarError extends Error {
    readonly code: SecEdgarErrorCode;
    readonly status?: number;
    readonly retryAfterMs?: number;
    readonly cause?: unknown;

    constructor(
        code: SecEdgarErrorCode,
        message: string,
        options: { status?: number; retryAfterMs?: number; cause?: unknown } = {},
    ) {
        super(message);
        this.name = 'SecEdgarError';
        this.code = code;
        this.status = options.status;
        this.retryAfterMs = options.retryAfterMs;
        this.cause = options.cause;
    }
}

export interface SecTrackedFilerRef {
    id: string;
    name: string;
    cik?: string | null;
}

export interface SecCompanyMatch {
    cik: string;
    name: string;
    ticker?: string;
}

export interface SecFilingMetadata {
    trackedFilerId: string;
    cik: string;
    accessionNumber: string;
    filingType: SecFilingType;
    reportPeriod: string;
    filedAt?: string;
    acceptedAt?: string;
    primaryDocumentUrl?: string;
    informationTableUrl?: string;
    status: 'discovered';
    rawSubmission: Record<string, unknown>;
}

export interface StoredSecFiling {
    id?: string;
    trackedFilerId: string;
    accessionNumber: string;
    reportPeriod: string;
    filingType: SecFilingType;
    primaryDocumentUrl?: string | null;
    informationTableUrl?: string | null;
    created: boolean;
}

export interface SecFilingRepository {
    listEnabledTrackedFilers(): Promise<SecTrackedFilerRef[]>;
    upsertFiling(filing: SecFilingMetadata): Promise<StoredSecFiling>;
}

export interface SecRefreshFilerResult {
    trackedFilerId: string;
    cik: string;
    fetched: number;
    stored: number;
    created: number;
    unchanged: number;
    filings: StoredSecFiling[];
}

export interface SecRefreshAllResult {
    totalFilers: number;
    succeeded: SecRefreshFilerResult[];
    failed: Array<{
        trackedFilerId: string;
        message: string;
        code?: SecEdgarErrorCode;
    }>;
}
