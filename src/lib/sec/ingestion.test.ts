import { describe, test } from 'node:test';
import assert from 'node:assert';
import { AlphaRadarSecIngestionService, type SecIngestionClient } from './ingestion';
import { SecEdgarError, type SecFilingMetadata, type SecFilingRepository, type SecTrackedFilerRef } from './types';

const FILER_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_FILER_ID = '22222222-2222-4222-8222-222222222222';

function filing(accessionNumber = '0000950123-26-000001'): SecFilingMetadata {
    return {
        trackedFilerId: FILER_ID,
        cik: '0001067983',
        accessionNumber,
        filingType: '13F-HR',
        reportPeriod: '2025-Q4',
        filedAt: '2026-02-14T00:00:00.000Z',
        acceptedAt: '2026-02-14T20:12:05.000Z',
        primaryDocumentUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000095012326000001/primary.xml',
        informationTableUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000095012326000001/primary.xml',
        status: 'discovered',
        rawSubmission: { accessionNumber },
    };
}

class FakeClient implements SecIngestionClient {
    resolveCalls: string[] = [];
    fetchCalls: Array<{ trackedFilerId: string; cik: string; limit?: number }> = [];
    filingsByCik = new Map<string, SecFilingMetadata[]>();
    resolveError: Error | null = null;

    async resolveCik(query: string): Promise<{ cik: string }> {
        this.resolveCalls.push(query);
        if (this.resolveError) throw this.resolveError;
        return { cik: '0001067983' };
    }

    async fetchRecent13FFilings(input: {
        trackedFilerId: string;
        cik: string;
        limit?: number;
    }): Promise<SecFilingMetadata[]> {
        this.fetchCalls.push(input);
        return this.filingsByCik.get(input.cik) ?? [];
    }
}

class InMemoryRepository implements SecFilingRepository {
    private readonly filings = new Map<string, SecFilingMetadata>();

    constructor(private readonly filers: SecTrackedFilerRef[] = []) {}

    async listEnabledTrackedFilers(): Promise<SecTrackedFilerRef[]> {
        return this.filers;
    }

    async upsertFiling(filingMetadata: SecFilingMetadata) {
        const key = `${filingMetadata.trackedFilerId}:${filingMetadata.accessionNumber}:${filingMetadata.reportPeriod}`;
        const created = !this.filings.has(key);
        this.filings.set(key, filingMetadata);
        return {
            trackedFilerId: filingMetadata.trackedFilerId,
            accessionNumber: filingMetadata.accessionNumber,
            reportPeriod: filingMetadata.reportPeriod,
            filingType: filingMetadata.filingType,
            primaryDocumentUrl: filingMetadata.primaryDocumentUrl,
            informationTableUrl: filingMetadata.informationTableUrl,
            created,
        };
    }
}

describe('AlphaRadarSecIngestionService', () => {
    test('refreshes a manually selected filer and stores new filings idempotently', async () => {
        const client = new FakeClient();
        client.filingsByCik.set('0001067983', [filing()]);
        const repository = new InMemoryRepository();
        const service = new AlphaRadarSecIngestionService(client, repository);

        const first = await service.refreshFiler({ id: FILER_ID, name: 'Berkshire Hathaway Inc', cik: '1067983' });
        const second = await service.refreshFiler({ id: FILER_ID, name: 'Berkshire Hathaway Inc', cik: '1067983' });

        assert.strictEqual(client.resolveCalls.length, 0);
        assert.strictEqual(client.fetchCalls[0].cik, '0001067983');
        assert.strictEqual(first.fetched, 1);
        assert.strictEqual(first.created, 1);
        assert.strictEqual(first.unchanged, 0);
        assert.strictEqual(second.fetched, 1);
        assert.strictEqual(second.created, 0);
        assert.strictEqual(second.unchanged, 1);
    });

    test('resolves missing filer CIKs before fetching SEC submissions', async () => {
        const client = new FakeClient();
        client.filingsByCik.set('0001067983', [filing()]);
        const service = new AlphaRadarSecIngestionService(client, new InMemoryRepository());

        const result = await service.refreshFiler({ id: FILER_ID, name: 'Berkshire Hathaway Inc' }, { filingLimit: 5 });

        assert.deepStrictEqual(client.resolveCalls, ['Berkshire Hathaway Inc']);
        assert.deepStrictEqual(client.fetchCalls, [{ trackedFilerId: FILER_ID, cik: '0001067983', limit: 5 }]);
        assert.strictEqual(result.stored, 1);
    });

    test('batch refresh records per-filer failures without stopping the run', async () => {
        const client = new FakeClient();
        client.filingsByCik.set('0001067983', [filing()]);
        client.resolveError = new SecEdgarError('not_found', 'No SEC CIK match found.');
        const repository = new InMemoryRepository([
            { id: FILER_ID, name: 'Berkshire Hathaway Inc', cik: '0001067983' },
            { id: SECOND_FILER_ID, name: 'Missing Capital' },
        ]);
        const service = new AlphaRadarSecIngestionService(client, repository);

        const result = await service.refreshAllFilers();

        assert.strictEqual(result.totalFilers, 2);
        assert.strictEqual(result.succeeded.length, 1);
        assert.strictEqual(result.succeeded[0].trackedFilerId, FILER_ID);
        assert.strictEqual(result.failed.length, 1);
        assert.strictEqual(result.failed[0].trackedFilerId, SECOND_FILER_ID);
        assert.strictEqual(result.failed[0].code, 'not_found');
    });

    test('returns a no-new-filing shape when SEC has no recent 13F forms', async () => {
        const client = new FakeClient();
        client.filingsByCik.set('0001067983', []);
        const service = new AlphaRadarSecIngestionService(client, new InMemoryRepository());

        const result = await service.refreshFiler({ id: FILER_ID, name: 'Berkshire Hathaway Inc', cik: '0001067983' });

        assert.strictEqual(result.fetched, 0);
        assert.strictEqual(result.stored, 0);
        assert.deepStrictEqual(result.filings, []);
    });
});
