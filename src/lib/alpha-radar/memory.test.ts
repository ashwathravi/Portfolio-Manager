import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
    DisabledAlphaRadarEmbeddingProvider,
    InMemoryAlphaRadarSemanticMemoryRepository,
    buildAlphaRadarFilingMemoryChunks,
    buildAlphaRadarReportMemoryChunks,
    chunkAlphaRadarText,
    embedAlphaRadarSemanticChunks,
    searchAlphaRadarMemoryChunks,
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
        assert.strictEqual(result.provider, 'embeddings');
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

    test('regression: two sources with the same text get chunks of their own', () => {
        const chunk = (sourceId: string) => chunkAlphaRadarText({
            sourceKind: 'memo-section',
            sourceId,
            title: 'Summary',
            text: 'No material changes this quarter.',
            citation: { kind: 'memo-section', id: sourceId, title: 'Summary' },
        })[0];

        assert.notStrictEqual(chunk('report-a:summary').id, chunk('report-b:summary').id);
        assert.strictEqual(chunk('report-a:summary').contentHash, chunk('report-a:summary').contentHash);
    });

    test('a filing\'s holdings are chunked with the information table as their source', () => {
        const chunks = buildAlphaRadarFilingMemoryChunks({
            filing: {
                id: REPORT.filingId!,
                trackedFilerId: FILER.id,
                accessionNumber: '0001193125-26-352200',
                filingType: '13F-HR',
                reportPeriod: '2026-Q2',
                primaryDocumentUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000119312526352200/xslForm13F_X02/primary_doc.xml',
                informationTableUrl: 'https://www.sec.gov/Archives/edgar/data/1067983/000119312526352200/56757.xml',
                status: 'parsed',
            },
            holdings: [{ filingId: REPORT.filingId!, issuerName: 'CHUBB LIMITED', cusip: 'H1467J104', valueUsd: 7_800_000_000, shares: 27_000_000 }],
            filer: FILER,
        });

        assert.strictEqual(chunks.length, 1);
        assert.strictEqual(chunks[0].filingId, REPORT.filingId);
        assert.match(chunks[0].text, /CHUBB LIMITED CUSIP H1467J104 \$7,800,000,000/);
        assert.strictEqual(chunks[0].citation.url, 'https://www.sec.gov/Archives/edgar/data/1067983/000119312526352200/56757.xml');
    });
});

describe('Alpha Radar memory search with embeddings (launch item i62)', () => {
    // Two directions: insurers, and everything else.
    const insurance = [1, 0];
    const other = [0, 1];
    const memo = (id: string, text: string, embedding?: number[], embeddingModel = 'test/embed') => ({
        ...chunkAlphaRadarText({
            sourceKind: 'memo-section',
            sourceId: id,
            reportPeriod: '2026-Q2',
            title: id,
            text,
            citation: { kind: 'memo-section', id, title: id },
        })[0],
        ...(embedding ? { embedding, embeddingModel, embeddingDimensions: embedding.length } : {}),
    });
    const chunks = [
        memo('chubb', 'Added to Chubb, a property and casualty underwriter.', insurance),
        memo('apple', 'Trimmed Apple again; still the largest position.', other),
        memo('insurance-word', 'Insurance float funds the portfolio.', insurance),
        memo('oxy', 'Occidental Petroleum stake unchanged.', other),
    ];

    test('finds what the query means as well as what it says, with both first', () => {
        const result = searchAlphaRadarMemoryChunks({ query: 'insurance', chunks, queryEmbedding: insurance, embeddingModel: 'test/embed', limit: 3 });

        assert.strictEqual(result.provider, 'embeddings');
        // The keyword match that is also nearest, then the underwriter that
        // never says "insurance"; the rest share neither words nor meaning.
        assert.deepStrictEqual(result.matches.map((match) => match.sourceId), ['insurance-word', 'chubb']);
        assert.ok(result.matches[0].score > 1, 'its keyword score with its similarity');
        assert.strictEqual(result.matches[1].score, 1);
    });

    test('keyword search alone without a query embedding, or with chunks embedded by another model', () => {
        const keyword = searchAlphaRadarMemoryChunks({ query: 'insurance', chunks });
        assert.strictEqual(keyword.provider, 'keyword-fallback');
        assert.deepStrictEqual(keyword.matches.map((match) => match.sourceId), ['insurance-word']);

        const otherModel = searchAlphaRadarMemoryChunks({ query: 'insurance', chunks, queryEmbedding: insurance, embeddingModel: 'other/embed' });
        assert.deepStrictEqual(otherModel, keyword);

        const otherSize = searchAlphaRadarMemoryChunks({ query: 'insurance', chunks, queryEmbedding: [1, 0, 0], embeddingModel: 'test/embed' });
        assert.deepStrictEqual(otherSize, keyword);
    });

    test('a chunk the provider returns no embedding for is stored without one', async () => {
        const provider: AlphaRadarEmbeddingProvider = {
            name: 'partial', model: 'test/embed', dimensions: 0,
            isEnabled: () => true,
            embedTexts: async (texts) => texts.map((text, index) => (index === 0 ? [0.6, 0.8] : [])),
        };
        const embedded = await embedAlphaRadarSemanticChunks([memo('a', 'first'), memo('b', 'second')], provider);

        assert.deepStrictEqual([embedded[0].embedding, embedded[0].embeddingModel, embedded[0].embeddingDimensions], [[0.6, 0.8], 'test/embed', 2]);
        assert.strictEqual(embedded[1].embedding, undefined);
        assert.strictEqual(embedded[1].embeddingModel, undefined);
    });

    test('a filing\'s memory replaces what was stored for it and its report, and reads come newest first', async () => {
        const repository = new InMemoryAlphaRadarSemanticMemoryRepository();
        const at = (sourceId: string, reportPeriod: string, ids: { filingId?: string; reportId?: string }) => ({ ...memo(sourceId, sourceId), reportPeriod, ...ids });
        await repository.replaceFilingMemory({ filingId: 'f-old', chunks: [at('old', '2025-Q4', { filingId: 'f-old' })] });
        await repository.replaceFilingMemory({
            filingId: 'f-new',
            reportId: 'r-new',
            chunks: [at('first', '2026-Q1', { filingId: 'f-new' }), at('memo', '2026-Q1', { filingId: 'f-new', reportId: 'r-new' })],
        });
        await repository.replaceFilingMemory({ filingId: 'f-new', reportId: 'r-new', chunks: [at('again', '2026-Q1', { filingId: 'f-new' })] });

        assert.deepStrictEqual((await repository.listChunks()).map((chunk) => chunk.sourceId), ['again', 'old']);
    });
});
