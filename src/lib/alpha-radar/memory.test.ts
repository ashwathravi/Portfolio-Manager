import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
    DisabledAlphaRadarEmbeddingProvider,
    InMemoryAlphaRadarSemanticMemoryRepository,
    buildAlphaRadarReportMemoryChunks,
    chunkAlphaRadarText,
    embedAlphaRadarSemanticChunks,
    searchAlphaRadarSemanticChunks,
    searchAlphaRadarVectorChunks,
    type AlphaRadarEmbeddingProvider,
} from './index';
import type { AlphaRadarReportRecord, AlphaRadarTrackedFilerRecord } from './contracts';

const FILER: AlphaRadarTrackedFilerRecord = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Berkshire Hathaway',
    slug: 'berkshire-hathaway',
    cik: '0001067983',
    enabled: true,
    fundStyle: 'Concentrated value',
};

const REPORT: AlphaRadarReportRecord = {
    id: '55555555-5555-4555-8555-555555555555',
    trackedFilerId: FILER.id,
    filingId: '33333333-3333-4333-8333-333333333333',
    reportPeriod: '2025-Q4',
    status: 'generated',
    title: 'Berkshire Hathaway Alpha Radar 2025-Q4',
    summary: 'AI infrastructure and portfolio overlap drove the highest-priority signals.',
    sections: [
        {
            id: 'summary',
            title: 'Summary',
            kind: 'summary',
            markdown: 'Berkshire added Nvidia (NVDA) and Apple (AAPL). AI infrastructure was the dominant theme.',
            changeIds: [],
        },
        {
            id: 'overlap',
            title: 'Portfolio Manager overlap',
            kind: 'overlap',
            markdown: '- Apple Inc (AAPL): held in portfolio.\n- Nvidia Corp (NVDA): active thesis.',
            changeIds: [],
        },
    ],
    markdown: '',
    sourceFilingIds: ['33333333-3333-4333-8333-333333333333'],
    generatorVersion: 'deterministic-v1',
};

class StaticEmbeddingProvider implements AlphaRadarEmbeddingProvider {
    readonly name = 'static-test';
    readonly model = 'static-3d';
    readonly dimensions = 3;

    isEnabled(): boolean {
        return true;
    }

    async embedTexts(texts: readonly string[]): Promise<number[][]> {
        return texts.map((text) => text.toLowerCase().includes('nvidia') ? [1, 0, 0] : [0, 1, 0]);
    }
}

describe('Alpha Radar semantic memory', () => {
    test('chunks report sections into cited semantic memory records', () => {
        const chunks = buildAlphaRadarReportMemoryChunks({ report: REPORT, filer: FILER });

        assert.strictEqual(chunks.length, 2);
        assert.strictEqual(chunks[0].sourceKind, 'memo-section');
        assert.strictEqual(chunks[0].reportPeriod, '2025-Q4');
        assert.strictEqual(chunks[0].metadata?.filerName, 'Berkshire Hathaway');
        assert.ok(chunks[0].keywords.includes('berkshire'));
        assert.ok(chunks[0].keywords.includes('nvda'));
        assert.match(chunks[0].citation.url ?? '', /research\?tab=alpha-radar/);
    });

    test('splits long filing text without losing source citation metadata', () => {
        const chunks = chunkAlphaRadarText({
            sourceKind: 'filing-text',
            sourceId: 'filing-1',
            trackedFilerId: FILER.id,
            reportPeriod: '2025-Q4',
            title: 'Berkshire 2025-Q4 filing',
            text: 'Nvidia position increased. '.repeat(80),
            citation: { kind: 'filing', id: 'filing-1', title: 'Berkshire filing' },
            metadata: { filerName: FILER.name, tickers: ['NVDA'], themes: ['ai infrastructure'] },
        }, { maxChars: 140 });

        assert.ok(chunks.length > 1);
        assert.ok(chunks.every((chunk) => chunk.citation.id === 'filing-1'));
        assert.ok(chunks.every((chunk) => chunk.text.length <= 140));
    });

    test('searches by theme, company, filer, and quarter with source links', () => {
        const chunks = buildAlphaRadarReportMemoryChunks({ report: REPORT, filer: FILER });
        const result = searchAlphaRadarSemanticChunks({
            query: 'Berkshire 2025 Q4 AI infrastructure NVDA evidence',
            chunks,
            limit: 3,
        });

        assert.strictEqual(result.provider, 'keyword-fallback');
        assert.ok(result.matches.length > 0);
        assert.match(result.matches[0].text, /Nvidia|AI infrastructure/i);
        assert.strictEqual(result.matches[0].citation.kind, 'memo-section');
        assert.match(result.matches[0].citation.url ?? '', /alpha-radar/);
    });

    test('disabled embedding provider leaves chunks searchable by keyword fallback', async () => {
        const chunks = buildAlphaRadarReportMemoryChunks({ report: REPORT, filer: FILER });
        const embedded = await embedAlphaRadarSemanticChunks(chunks, new DisabledAlphaRadarEmbeddingProvider());
        const result = searchAlphaRadarSemanticChunks({ query: 'Apple portfolio overlap', chunks: embedded });

        assert.strictEqual(embedded[0].embedding, undefined);
        assert.ok(result.matches.some((match) => match.text.includes('Apple')));
    });

    test('enabled embedding provider attaches metadata and supports vector ranking', async () => {
        const chunks = buildAlphaRadarReportMemoryChunks({ report: REPORT, filer: FILER });
        const embedded = await embedAlphaRadarSemanticChunks(chunks, new StaticEmbeddingProvider());
        const result = searchAlphaRadarVectorChunks({
            queryEmbedding: [1, 0, 0],
            chunks: embedded,
            limit: 1,
        });

        assert.strictEqual(embedded[0].embeddingProvider, 'static-test');
        assert.strictEqual(embedded[0].embeddingDimensions, 3);
        assert.strictEqual(result.provider, 'pgvector');
        assert.match(result.matches[0].text, /Nvidia/i);
    });

    test('persists metadata through the in-memory repository contract', async () => {
        const chunks = buildAlphaRadarReportMemoryChunks({ report: REPORT, filer: FILER });
        const repository = new InMemoryAlphaRadarSemanticMemoryRepository();

        const inserted = await repository.replaceSourceChunks({
            sourceKind: chunks[0].sourceKind,
            sourceId: chunks[0].sourceId,
            chunks: [chunks[0]],
        });
        const search = await repository.search({
            query: 'Berkshire NVDA',
            filters: { trackedFilerIds: [FILER.id], reportPeriods: ['2025-Q4'] },
        });

        assert.strictEqual(inserted.inserted, 1);
        assert.strictEqual((await repository.listChunks()).length, 1);
        assert.strictEqual(search.matches.length, 1);
        assert.strictEqual(search.matches[0].citation.id, chunks[0].citation.id);
    });
});
