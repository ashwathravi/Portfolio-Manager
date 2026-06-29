import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
    AlphaRadarRefreshService,
    defaultFetchInformationTableXml,
    type AlphaRadarRefreshRepository,
    type AlphaRadarSecRefreshService,
} from './refresh';
import type { AlphaRadarFilingRecord, AlphaRadarHoldingRecord, AlphaRadarTrackedFilerRecord } from './contracts';
import type { AlphaRadarHoldingChange, AlphaRadarMemoChange } from './index';
import type { AlphaRadarReportInput } from '@/lib/validators/alpha-radar';
import type { ParsedThirteenFHolding, SecRefreshFilerResult, SecTrackedFilerRef, StoredSecFiling } from '@/lib/sec';

const FILER: AlphaRadarTrackedFilerRecord = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Berkshire Hathaway Inc',
    slug: 'berkshire-hathaway',
    cik: '0001067983',
    enabled: true,
};

const SECOND_FILER: AlphaRadarTrackedFilerRecord = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Missing Capital',
    slug: 'missing-capital',
    cik: '0000000001',
    enabled: true,
};

const FILING: StoredSecFiling = {
    id: '33333333-3333-4333-8333-333333333333',
    trackedFilerId: FILER.id,
    accessionNumber: '0000950123-26-000001',
    filingType: '13F-HR',
    reportPeriod: '2025-Q4',
    informationTableUrl: 'https://example.test/info.xml',
    created: true,
};

const REPRESENTATIVE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<informationTable>
  <infoTable>
    <nameOfIssuer>APPLE INC</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>037833100</cusip>
    <value>174000000</value>
    <shrsOrPrnAmt><sshPrnamt>915600000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
    <investmentDiscretion>SOLE</investmentDiscretion>
    <votingAuthority><Sole>915600000</Sole><Shared>0</Shared><None>0</None></votingAuthority>
  </infoTable>
  <infoTable>
    <nameOfIssuer>CHEVRON CORP NEW</nameOfIssuer>
    <titleOfClass>COM</titleOfClass>
    <cusip>166764100</cusip>
    <value>18000000</value>
    <shrsOrPrnAmt><sshPrnamt>12609326</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
    <investmentDiscretion>SOLE</investmentDiscretion>
    <votingAuthority><Sole>12609326</Sole><Shared>0</Shared><None>0</None></votingAuthority>
  </infoTable>
</informationTable>`;

class FakeSecRefreshService implements AlphaRadarSecRefreshService {
    failures = new Set<string>();
    filingsByFiler = new Map<string, StoredSecFiling[]>([[FILER.id, [FILING]]]);
    calls: SecTrackedFilerRef[] = [];

    async refreshFiler(filer: SecTrackedFilerRef): Promise<SecRefreshFilerResult> {
        this.calls.push(filer);
        if (this.failures.has(filer.id)) throw new Error(`SEC failed for ${filer.name}`);
        const filings = this.filingsByFiler.get(filer.id) ?? [];
        return {
            trackedFilerId: filer.id,
            cik: filer.cik ?? '0001067983',
            fetched: filings.length,
            stored: filings.length,
            created: filings.filter((filing) => filing.created).length,
            unchanged: filings.filter((filing) => !filing.created).length,
            filings,
        };
    }
}

class FakeRepository implements AlphaRadarRefreshRepository {
    holdings = new Map<string, ParsedThirteenFHolding[]>();
    changes: AlphaRadarMemoChange[] = [];
    failedFilings: Array<{ filingId: string; message: string }> = [];

    constructor(private readonly filers: AlphaRadarTrackedFilerRecord[] = [FILER]) {}

    async listEnabledTrackedFilers() {
        return this.filers.filter((filer) => filer.enabled);
    }

    async getTrackedFiler(idOrSlug: string) {
        return this.filers.find((filer) => filer.id === idOrSlug || filer.slug === idOrSlug) ?? null;
    }

    async findPriorFiling(): Promise<AlphaRadarFilingRecord | null> {
        return null;
    }

    async listHoldingsForFiling(filingId: string): Promise<AlphaRadarHoldingRecord[]> {
        return (this.holdings.get(filingId) ?? []).map((holding) => ({ ...holding, id: `${holding.cusip}-id` }));
    }

    async replaceFilingHoldings(filingId: string, holdings: readonly ParsedThirteenFHolding[]) {
        this.holdings.set(filingId, [...holdings]);
        return { inserted: holdings.length };
    }

    async markFilingParseFailed(filingId: string, message: string) {
        this.failedFilings.push({ filingId, message });
    }

    async upsertHoldingChanges(changes: readonly AlphaRadarHoldingChange[]) {
        this.changes = changes.map((change, index) => ({ ...change, id: `44444444-4444-4444-8444-00000000000${index}` }));
        return this.changes;
    }
}

class FakeReportRepository {
    reports: AlphaRadarReportInput[] = [];

    async upsertReport(report: AlphaRadarReportInput) {
        this.reports.push(report);
        return {
            id: '55555555-5555-4555-8555-555555555555',
            reportPeriod: report.reportPeriod,
            generatorVersion: report.generatorVersion,
        };
    }
}

describe('AlphaRadarRefreshService', () => {
    test('refreshes a filer through ingestion, parse, diff, and memo generation', async () => {
        const secIngestion = new FakeSecRefreshService();
        const repository = new FakeRepository();
        const reportRepository = new FakeReportRepository();
        const service = new AlphaRadarRefreshService({
            secIngestion,
            repository,
            reportRepository,
            fetchInformationTableXml: async () => REPRESENTATIVE_XML,
        });

        const result = await service.refreshFiler(FILER.id);

        assert.strictEqual(result.totalFilers, 1);
        assert.strictEqual(result.fetched, 1);
        assert.strictEqual(result.parsed, 1);
        assert.strictEqual(result.skipped, 0);
        assert.strictEqual(result.changed, 2);
        assert.strictEqual(result.memoGenerated, 1);
        assert.strictEqual(result.errors.length, 0);
        assert.strictEqual(repository.holdings.get(FILING.id!)?.length, 2);
        assert.strictEqual(repository.changes.length, 2);
        assert.strictEqual(reportRepository.reports.length, 1);
        assert.deepStrictEqual(reportRepository.reports[0].sourceFilingIds, [FILING.id]);
    });

    test('skips known filings unless force is requested', async () => {
        const secIngestion = new FakeSecRefreshService();
        secIngestion.filingsByFiler.set(FILER.id, [{ ...FILING, created: false }]);
        const repository = new FakeRepository();
        const reportRepository = new FakeReportRepository();
        const service = new AlphaRadarRefreshService({
            secIngestion,
            repository,
            reportRepository,
            fetchInformationTableXml: async () => REPRESENTATIVE_XML,
        });

        const result = await service.refreshFiler(FILER.slug);

        assert.strictEqual(result.fetched, 1);
        assert.strictEqual(result.skipped, 1);
        assert.strictEqual(result.parsed, 0);
        assert.strictEqual(reportRepository.reports.length, 0);
        assert.strictEqual(result.filers[0].filings[0].status, 'skipped');
    });

    test('isolates per-filer failures in batch refresh', async () => {
        const secIngestion = new FakeSecRefreshService();
        secIngestion.failures.add(SECOND_FILER.id);
        const repository = new FakeRepository([FILER, SECOND_FILER]);
        const reportRepository = new FakeReportRepository();
        const service = new AlphaRadarRefreshService({
            secIngestion,
            repository,
            reportRepository,
            fetchInformationTableXml: async () => REPRESENTATIVE_XML,
        });

        const result = await service.refreshAll();

        assert.strictEqual(result.totalFilers, 2);
        assert.strictEqual(result.parsed, 1);
        assert.strictEqual(result.errors.length, 1);
        assert.match(result.errors[0].message, /SEC failed/);
        assert.strictEqual(result.filers[1].trackedFilerId, SECOND_FILER.id);
        assert.strictEqual(result.filers[1].filings.length, 0);
    });
});

describe('defaultFetchInformationTableXml', () => {
    test('uses an abort signal and rejects oversized SEC XML responses', async () => {
        const originalFetch = globalThis.fetch;
        let sawAbortSignal = false;
        globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
            sawAbortSignal = init?.signal instanceof AbortSignal;
            return new Response('<informationTable />', {
                headers: { 'content-length': String(26 * 1024 * 1024) },
            });
        };

        try {
            await assert.rejects(
                () => defaultFetchInformationTableXml(FILING),
                /SEC information table XML response for https:\/\/example\.test\/info\.xml exceeds 25 MiB/,
            );
            assert.strictEqual(sawAbortSignal, true);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
