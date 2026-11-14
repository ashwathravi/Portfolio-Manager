import type {
    AlphaRadarEvidenceLink,
    AlphaRadarSemanticContextSnippet,
    AlphaRadarSemanticSearchResult,
    AlphaRadarSemanticSourceKind,
} from './agent-contracts';
import type {
    AlphaRadarFilingRecord,
    AlphaRadarHoldingRecord,
    AlphaRadarReportRecord,
    AlphaRadarTrackedFilerRecord,
} from './contracts';

export interface AlphaRadarSemanticChunkMetadata {
    filerName?: string;
    issuerNames?: string[];
    tickers?: string[];
    cusips?: string[];
    themes?: string[];
    sectionKind?: string;
}

export interface AlphaRadarSemanticChunkInput {
    sourceKind: AlphaRadarSemanticSourceKind;
    sourceId: string;
    trackedFilerId?: string;
    filingId?: string;
    reportId?: string;
    reportPeriod?: string;
    title: string;
    text: string;
    chunkIndex: number;
    citation: AlphaRadarEvidenceLink;
    metadata?: AlphaRadarSemanticChunkMetadata;
}

export interface AlphaRadarSemanticChunk extends AlphaRadarSemanticChunkInput {
    id: string;
    contentHash: string;
    keywords: string[];
    embedding?: number[];
    embeddingProvider?: string;
    embeddingModel?: string;
    embeddingDimensions?: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface AlphaRadarChunkTextOptions {
    maxChars?: number;
}

export interface AlphaRadarSemanticSearchOptions {
    query: string;
    chunks: readonly AlphaRadarSemanticChunk[];
    limit?: number;
    includeRawText?: boolean;
    provider?: AlphaRadarSemanticSearchResult['provider'];
}

export interface AlphaRadarEmbeddingProvider {
    readonly name: string;
    readonly model: string;
    readonly dimensions: number;
    isEnabled(): boolean;
    embedTexts(texts: readonly string[]): Promise<number[][]>;
}

export class DisabledAlphaRadarEmbeddingProvider implements AlphaRadarEmbeddingProvider {
    readonly name = 'disabled';
    readonly model = 'none';
    readonly dimensions = 0;

    isEnabled(): boolean {
        return false;
    }

    async embedTexts(texts: readonly string[]): Promise<number[][]> {
        return texts.map(() => []);
    }
}

export async function embedAlphaRadarSemanticChunks(
    chunks: readonly AlphaRadarSemanticChunk[],
    provider: AlphaRadarEmbeddingProvider = new DisabledAlphaRadarEmbeddingProvider(),
): Promise<AlphaRadarSemanticChunk[]> {
    if (!provider.isEnabled() || chunks.length === 0) return [...chunks];

    const embeddings = await provider.embedTexts(chunks.map((chunk) => `${chunk.title}\n${chunk.text}`));
    return chunks.map((chunk, index) => {
        const embedding = embeddings[index] ?? [];
        return embedding.length === 0 ? chunk : {
            ...chunk,
            embedding,
            embeddingProvider: provider.name,
            embeddingModel: provider.model,
            embeddingDimensions: embedding.length,
        };
    });
}

export function chunkAlphaRadarText(
    input: Omit<AlphaRadarSemanticChunkInput, 'chunkIndex' | 'text'> & { text: string },
    options: AlphaRadarChunkTextOptions = {},
): AlphaRadarSemanticChunk[] {
    const maxChars = options.maxChars ?? 900;
    const pieces = splitText(input.text, maxChars);

    return pieces.map((text, index) => createSemanticChunk({
        ...input,
        text,
        chunkIndex: index,
    }));
}

export function buildAlphaRadarReportMemoryChunks(input: {
    report: AlphaRadarReportRecord;
    filer?: AlphaRadarTrackedFilerRecord;
    maxChars?: number;
}): AlphaRadarSemanticChunk[] {
    const filerName = input.filer?.name;
    return input.report.sections.flatMap((section) => chunkAlphaRadarText({
        sourceKind: 'memo-section',
        sourceId: `${input.report.id}:${section.id}`,
        trackedFilerId: input.report.trackedFilerId,
        filingId: input.report.filingId,
        reportId: input.report.id,
        reportPeriod: input.report.reportPeriod,
        title: `${input.report.title} — ${section.title}`,
        text: `${section.title}\n${section.markdown}`,
        citation: {
            kind: 'memo-section',
            id: `${input.report.id}:${section.id}`,
            title: section.title,
            url: `/research?tab=alpha-radar&reportId=${encodeURIComponent(input.report.id)}#${encodeURIComponent(section.id)}`,
        },
        metadata: {
            filerName,
            sectionKind: section.kind,
            themes: themesForSection(section.title, section.markdown, section.kind),
            tickers: extractTickers(section.markdown),
        },
    }, { maxChars: input.maxChars }));
}

export function buildAlphaRadarFilingMemoryChunks(input: {
    filing: AlphaRadarFilingRecord;
    holdings: readonly AlphaRadarHoldingRecord[];
    filer?: AlphaRadarTrackedFilerRecord;
    rawText?: string;
    maxChars?: number;
}): AlphaRadarSemanticChunk[] {
    const holdingText = input.rawText ?? input.holdings
        .map((holding) => [
            holding.issuerName,
            holding.ticker ? `(${holding.ticker})` : '',
            `CUSIP ${holding.cusip}`,
            `$${Math.round(holding.valueUsd).toLocaleString('en-US')}`,
        ].filter(Boolean).join(' '))
        .join('\n');

    return chunkAlphaRadarText({
        sourceKind: 'filing-text',
        sourceId: input.filing.id,
        trackedFilerId: input.filing.trackedFilerId,
        filingId: input.filing.id,
        reportPeriod: input.filing.reportPeriod,
        title: `${input.filer?.name ?? 'Tracked filer'} ${input.filing.reportPeriod} 13F information table`,
        text: holdingText,
        citation: {
            kind: 'filing',
            id: input.filing.id,
            title: `${input.filing.accessionNumber} information table`,
            url: input.filing.informationTableUrl ?? input.filing.primaryDocumentUrl ?? undefined,
        },
        metadata: {
            filerName: input.filer?.name,
            issuerNames: input.holdings.map((holding) => holding.issuerName),
            tickers: input.holdings.map((holding) => holding.ticker).filter(isDefined),
            cusips: input.holdings.map((holding) => holding.cusip),
            themes: ['13f filing', 'holdings'],
        },
    }, { maxChars: input.maxChars });
}

export function searchAlphaRadarSemanticChunks(options: AlphaRadarSemanticSearchOptions): AlphaRadarSemanticSearchResult {
    return {
        provider: options.provider ?? 'keyword-fallback',
        matches: keywordMatches(options.query, options.chunks)
            .slice(0, options.limit ?? 5)
            .map(({ chunk, score }) => toContextSnippet(chunk, score, options.includeRawText)),
    };
}

/** How far down the similarity ranking a chunk without the query's words can come from. */
const SIMILAR_CANDIDATES_PER_RESULT = 2;
// Reciprocal rank fusion's usual constant: ranks matter, not the scores' scales.
const RRF_K = 60;

/**
 * Keyword matches and the chunks most similar to the query (launch item
 * i62), ranked together by reciprocal rank fusion, so a chunk that shares
 * the query's meaning but not its words can be found, and one with both
 * comes first. Only chunks embedded by the query's model are compared.
 * Without a query embedding, or no chunk embedded by that model, this is
 * the keyword search. A match's score is its keyword score plus its
 * similarity to the query.
 */
export function searchAlphaRadarMemoryChunks(options: AlphaRadarSemanticSearchOptions & {
    queryEmbedding?: readonly number[];
    embeddingModel?: string;
}): AlphaRadarSemanticSearchResult {
    const queryEmbedding = options.queryEmbedding ?? [];
    const embedded = queryEmbedding.length === 0 ? [] : options.chunks.filter((chunk) =>
        chunk.embeddingModel === options.embeddingModel && chunk.embedding?.length === queryEmbedding.length);
    if (embedded.length === 0) return searchAlphaRadarSemanticChunks(options);

    const limit = options.limit ?? 5;
    const keyword = keywordMatches(options.query, options.chunks);
    const similar = embedded
        .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding ?? []) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.chunk.title.localeCompare(b.chunk.title))
        .slice(0, limit * SIMILAR_CANDIDATES_PER_RESULT);

    const fused = new Map<string, { chunk: AlphaRadarSemanticChunk; rank: number; score: number }>();
    for (const list of [keyword, similar]) {
        list.forEach(({ chunk, score }, index) => {
            const entry = fused.get(chunk.id) ?? { chunk, rank: 0, score: 0 };
            entry.rank += 1 / (RRF_K + index + 1);
            entry.score += score;
            fused.set(chunk.id, entry);
        });
    }

    return {
        provider: 'embeddings',
        matches: [...fused.values()]
            .sort((a, b) => b.rank - a.rank || b.score - a.score || a.chunk.title.localeCompare(b.chunk.title))
            .slice(0, limit)
            .map(({ chunk, score }) => toContextSnippet(chunk, score, options.includeRawText)),
    };
}

function keywordMatches(rawQuery: string, chunks: readonly AlphaRadarSemanticChunk[]) {
    const query = rawQuery.trim();
    if (!query) return [];
    return chunks
        .map((chunk) => ({ chunk, score: scoreKeywordMatch(chunk, query) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => {
            const scoreDelta = b.score - a.score;
            if (scoreDelta !== 0) return scoreDelta;
            return a.chunk.title.localeCompare(b.chunk.title);
        });
}

export function searchAlphaRadarVectorChunks(options: {
    queryEmbedding: readonly number[];
    chunks: readonly AlphaRadarSemanticChunk[];
    limit?: number;
    includeRawText?: boolean;
}): AlphaRadarSemanticSearchResult {
    if (options.queryEmbedding.length === 0) {
        return { provider: 'disabled', matches: [] };
    }

    const scored = options.chunks
        .map((chunk) => ({ chunk, score: cosineSimilarity(options.queryEmbedding, chunk.embedding ?? []) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);

    return {
        provider: 'embeddings',
        matches: scored.slice(0, options.limit ?? 5).map(({ chunk, score }) => toContextSnippet(chunk, score, options.includeRawText)),
    };
}

export function createSemanticChunk(input: AlphaRadarSemanticChunkInput): AlphaRadarSemanticChunk {
    const keywords = extractKeywords(input);
    const contentHash = hashString([
        input.sourceKind,
        input.sourceId,
        input.chunkIndex,
        input.title,
        input.text,
    ].join('\n'));

    return {
        ...input,
        // One per source and position (as the table's unique index has it),
        // so two sources whose text hashes alike can't clash.
        id: `ar-memory:${input.sourceKind}:${input.sourceId}:${input.chunkIndex}`,
        contentHash,
        keywords,
    };
}

function splitText(text: string, maxChars: number): string[] {
    const paragraphs = text
        .split(/\n{2,}|\r?\n/)
        .map((part) => part.trim())
        .filter(Boolean);
    const chunks: string[] = [];
    let current = '';

    for (const paragraph of paragraphs.length > 0 ? paragraphs : [text.trim()]) {
        if (paragraph.length > maxChars) {
            if (current) {
                chunks.push(current);
                current = '';
            }
            chunks.push(...splitLongParagraph(paragraph, maxChars));
            continue;
        }

        const next = current ? `${current}\n${paragraph}` : paragraph;
        if (next.length > maxChars && current) {
            chunks.push(current);
            current = paragraph;
        } else {
            current = next;
        }
    }

    if (current) chunks.push(current);
    return chunks.length > 0 ? chunks : [];
}

function splitLongParagraph(paragraph: string, maxChars: number): string[] {
    const chunks: string[] = [];
    let remaining = paragraph.trim();
    while (remaining.length > maxChars) {
        const boundary = Math.max(
            remaining.lastIndexOf('. ', maxChars),
            remaining.lastIndexOf(' ', maxChars),
        );
        const cut = boundary > maxChars * 0.5 ? boundary + 1 : maxChars;
        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

function scoreKeywordMatch(chunk: AlphaRadarSemanticChunk, query: string): number {
    const terms = tokenize(query);
    if (terms.length === 0) return 0;

    const title = normalize(chunk.title);
    const text = normalize(chunk.text);
    const metadata = normalize([
        chunk.metadata?.filerName,
        chunk.reportPeriod,
        ...(chunk.metadata?.issuerNames ?? []),
        ...(chunk.metadata?.tickers ?? []),
        ...(chunk.metadata?.cusips ?? []),
        ...(chunk.metadata?.themes ?? []),
        chunk.metadata?.sectionKind,
    ].filter(Boolean).join(' '));
    const keywordSet = new Set(chunk.keywords);

    return terms.reduce((score, term) => {
        if (metadata.includes(term)) score += 4;
        if (title.includes(term)) score += 3;
        if (keywordSet.has(term)) score += 2;
        if (text.includes(term)) score += 1;
        return score;
    }, normalize(query).length > 3 && text.includes(normalize(query)) ? 5 : 0);
}

function toContextSnippet(
    chunk: AlphaRadarSemanticChunk,
    score: number,
    includeRawText = false,
): AlphaRadarSemanticContextSnippet {
    return {
        chunkId: chunk.id,
        sourceId: chunk.sourceId,
        sourceKind: chunk.sourceKind,
        text: includeRawText ? chunk.text : summarizeText(chunk.text),
        score: round(score),
        citation: chunk.citation,
    };
}

function summarizeText(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.length <= 260 ? normalized : `${normalized.slice(0, 257).trim()}...`;
}

function extractKeywords(input: AlphaRadarSemanticChunkInput): string[] {
    const raw = [
        input.title,
        input.text,
        input.reportPeriod,
        input.metadata?.filerName,
        ...(input.metadata?.issuerNames ?? []),
        ...(input.metadata?.tickers ?? []),
        ...(input.metadata?.cusips ?? []),
        ...(input.metadata?.themes ?? []),
    ].filter(Boolean).join(' ');

    return [...new Set(tokenize(raw))].slice(0, 80);
}

function themesForSection(title: string, markdown: string, kind: string): string[] {
    const haystack = `${title} ${markdown}`.toLowerCase();
    const themes = new Set([kind.replace(/_/g, ' ')]);
    if (/\bai|nvidia|semiconductor|cloud|software\b/.test(haystack)) themes.add('ai infrastructure');
    if (/\benergy|oil|gas|utility|utilities\b/.test(haystack)) themes.add('energy');
    if (/\bbank|insurance|financial|visa|mastercard\b/.test(haystack)) themes.add('financials');
    if (/\bconsumer|retail|ecommerce\b/.test(haystack)) themes.add('consumer');
    if (/\bportfolio|overlap|watchlist|thesis\b/.test(haystack)) themes.add('portfolio overlap');
    return [...themes];
}

function extractTickers(text: string): string[] {
    const matches = text.match(/\b[A-Z]{2,5}\b/g) ?? [];
    return [...new Set(matches.filter((ticker) => !COMMON_UPPERCASE_WORDS.has(ticker)))];
}

function tokenize(text: string): string[] {
    return normalize(text)
        .split(/\s+/)
        .filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function normalize(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
    if (a.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let index = 0; index < a.length; index += 1) {
        const av = a[index] ?? 0;
        const bv = b[index] ?? 0;
        dot += av * bv;
        magA += av * av;
        magB += bv * bv;
    }
    if (magA === 0 || magB === 0) return 0;
    return round(dot / (Math.sqrt(magA) * Math.sqrt(magB)), 6);
}

function round(value: number, digits = 4): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function hashString(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function isDefined<T>(value: T | undefined): value is T {
    return value !== undefined;
}

const STOP_WORDS = new Set([
    'and',
    'are',
    'for',
    'from',
    'has',
    'have',
    'into',
    'the',
    'this',
    'that',
    'with',
    'what',
    'when',
    'where',
    'which',
    'why',
]);

const COMMON_UPPERCASE_WORDS = new Set(['CUSIP', 'SEC', 'USD']);
