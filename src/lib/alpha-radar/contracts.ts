import type { AlphaRadarReportInput } from '@/lib/validators/alpha-radar';
import type { SecFilingType } from '@/lib/sec';

export interface AlphaRadarTrackedFilerRecord {
    id: string;
    name: string;
    slug: string;
    cik: string;
    secEntityName?: string | null;
    managerName?: string | null;
    fundStyle?: string | null;
    enabled: boolean;
    notes?: string | null;
    createdAt?: string;
    updatedAt?: string;
}

export interface AlphaRadarFilingRecord {
    id: string;
    trackedFilerId: string;
    accessionNumber: string;
    filingType: SecFilingType;
    reportPeriod: string;
    filedAt?: string | null;
    acceptedAt?: string | null;
    primaryDocumentUrl?: string | null;
    informationTableUrl?: string | null;
    status: string;
    parseError?: string | null;
}

export interface AlphaRadarHoldingRecord {
    id?: string;
    filingId: string;
    issuerName: string;
    cusip: string;
    ticker?: string;
    valueUsd: number;
    shares: number;
    putCall?: 'put' | 'call';
    securityType?: string;
    investmentDiscretion?: string;
    votingAuthoritySole?: number;
    votingAuthorityShared?: number;
    votingAuthorityNone?: number;
    positionRank?: number;
    rawHolding?: Record<string, unknown>;
}

export interface AlphaRadarReportRecord extends AlphaRadarReportInput {
    id: string;
    generatedAt?: string;
    updatedAt?: string;
}
