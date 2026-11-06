import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { alphaRadarSemanticChunks } from '@/db/schema';
import { searchAlphaRadarMemoryChunks, type AlphaRadarSemanticChunk } from './memory';
import type { AlphaRadarSemanticSearchResult, AlphaRadarSemanticSourceKind } from './agent-contracts';

type AlphaRadarDb = typeof db;

export interface AlphaRadarSemanticMemoryFilters {
    trackedFilerIds?: readonly string[];
    reportPeriods?: readonly string[];
    sourceKinds?: readonly AlphaRadarSemanticSourceKind[];
}

export interface AlphaRadarSemanticMemorySearchInput {
    query: string;
    limit?: number;
    includeRawText?: boolean;
    filters?: AlphaRadarSemanticMemoryFilters;
    /** The query embedded by `embeddingModel`; chunks embedded by it are ranked by similarity too. */
    queryEmbedding?: readonly number[];
    embeddingModel?: string;
}

/** A parsed filing's memory: its holdings' chunks and its report's. */
export interface AlphaRadarFilingMemoryInput {
    filingId: string;
    reportId?: string;
    chunks: readonly AlphaRadarSemanticChunk[];
}

/** The most chunks a read returns, newest report period first. */
export const ALPHA_RADAR_MEMORY_READ_LIMIT = 500;

export interface AlphaRadarSemanticMemoryRepository {
    replaceSourceChunks(input: {
        sourceKind: AlphaRadarSemanticSourceKind;
        sourceId: string;
        chunks: readonly AlphaRadarSemanticChunk[];
    }): Promise<{ inserted: number }>;
    /** Replaces everything stored for the filing and its report (launch item i62). */
    replaceFilingMemory(input: AlphaRadarFilingMemoryInput): Promise<{ inserted: number }>;
    listChunks(filters?: AlphaRadarSemanticMemoryFilters): Promise<AlphaRadarSemanticChunk[]>;
    search(input: AlphaRadarSemanticMemorySearchInput): Promise<AlphaRadarSemanticSearchResult>;
}

export class InMemoryAlphaRadarSemanticMemoryRepository implements AlphaRadarSemanticMemoryRepository {
    private readonly chunks = new Map<string, AlphaRadarSemanticChunk>();

    async replaceSourceChunks(input: {
        sourceKind: AlphaRadarSemanticSourceKind;
        sourceId: string;
        chunks: readonly AlphaRadarSemanticChunk[];
    }): Promise<{ inserted: number }> {
        for (const [id, chunk] of this.chunks.entries()) {
            if (chunk.sourceKind === input.sourceKind && chunk.sourceId === input.sourceId) {
                this.chunks.delete(id);
            }
        }
        for (const chunk of input.chunks) {
            this.chunks.set(chunk.id, chunk);
        }
        return { inserted: input.chunks.length };
    }

    async replaceFilingMemory(input: AlphaRadarFilingMemoryInput): Promise<{ inserted: number }> {
        for (const [id, chunk] of this.chunks.entries()) {
            if (chunk.filingId === input.filingId || (input.reportId && chunk.reportId === input.reportId)) {
                this.chunks.delete(id);
            }
        }
        for (const chunk of input.chunks) {
            this.chunks.set(chunk.id, chunk);
        }
        return { inserted: input.chunks.length };
    }

    async listChunks(filters: AlphaRadarSemanticMemoryFilters = {}): Promise<AlphaRadarSemanticChunk[]> {
        return [...this.chunks.values()]
            .filter((chunk) => matchesFilters(chunk, filters))
            .sort((a, b) => (b.reportPeriod ?? '').localeCompare(a.reportPeriod ?? ''))
            .slice(0, ALPHA_RADAR_MEMORY_READ_LIMIT);
    }

    async search(input: AlphaRadarSemanticMemorySearchInput): Promise<AlphaRadarSemanticSearchResult> {
        return searchStoredChunks(await this.listChunks(input.filters), input);
    }
}

export class DrizzleAlphaRadarSemanticMemoryRepository implements AlphaRadarSemanticMemoryRepository {
    constructor(private readonly database: AlphaRadarDb = db) {}

    async replaceSourceChunks(input: {
        sourceKind: AlphaRadarSemanticSourceKind;
        sourceId: string;
        chunks: readonly AlphaRadarSemanticChunk[];
    }): Promise<{ inserted: number }> {
        await this.database
            .delete(alphaRadarSemanticChunks)
            .where(and(
                eq(alphaRadarSemanticChunks.sourceKind, input.sourceKind),
                eq(alphaRadarSemanticChunks.sourceId, input.sourceId),
            ));

        if (input.chunks.length > 0) {
            await this.database.insert(alphaRadarSemanticChunks).values(input.chunks.map(toChunkRow));
        }

        return { inserted: input.chunks.length };
    }

    async replaceFilingMemory(input: AlphaRadarFilingMemoryInput): Promise<{ inserted: number }> {
        await this.database.transaction(async (tx) => {
            await tx
                .delete(alphaRadarSemanticChunks)
                .where(input.reportId
                    ? or(eq(alphaRadarSemanticChunks.filingId, input.filingId), eq(alphaRadarSemanticChunks.reportId, input.reportId))
                    : eq(alphaRadarSemanticChunks.filingId, input.filingId));
            if (input.chunks.length > 0) {
                await tx.insert(alphaRadarSemanticChunks).values(input.chunks.map(toChunkRow));
            }
        });
        return { inserted: input.chunks.length };
    }

    async listChunks(filters: AlphaRadarSemanticMemoryFilters = {}): Promise<AlphaRadarSemanticChunk[]> {
        const conditions = [
            filters.trackedFilerIds?.length ? inArray(alphaRadarSemanticChunks.trackedFilerId, [...filters.trackedFilerIds]) : undefined,
            filters.reportPeriods?.length ? inArray(alphaRadarSemanticChunks.reportPeriod, [...filters.reportPeriods]) : undefined,
            filters.sourceKinds?.length ? inArray(alphaRadarSemanticChunks.sourceKind, [...filters.sourceKinds]) : undefined,
        ].filter(isDefined);

        const rows = await this.database
            .select()
            .from(alphaRadarSemanticChunks)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            // The newest quarters first, so a long history leaves out the oldest.
            .orderBy(
                sql`${alphaRadarSemanticChunks.reportPeriod} desc nulls last`,
                asc(alphaRadarSemanticChunks.sourceKind),
                asc(alphaRadarSemanticChunks.sourceId),
                asc(alphaRadarSemanticChunks.chunkIndex),
            )
            .limit(ALPHA_RADAR_MEMORY_READ_LIMIT);

        return rows.map(toSemanticChunk);
    }

    async search(input: AlphaRadarSemanticMemorySearchInput): Promise<AlphaRadarSemanticSearchResult> {
        return searchStoredChunks(await this.listChunks(input.filters), input);
    }
}

function searchStoredChunks(
    chunks: readonly AlphaRadarSemanticChunk[],
    input: AlphaRadarSemanticMemorySearchInput,
): AlphaRadarSemanticSearchResult {
    return searchAlphaRadarMemoryChunks({
        query: input.query,
        chunks,
        limit: input.limit,
        includeRawText: input.includeRawText,
        queryEmbedding: input.queryEmbedding,
        embeddingModel: input.embeddingModel,
    });
}

function toChunkRow(chunk: AlphaRadarSemanticChunk): typeof alphaRadarSemanticChunks.$inferInsert {
    return {
        id: chunk.id,
        sourceKind: chunk.sourceKind,
        sourceId: chunk.sourceId,
        trackedFilerId: chunk.trackedFilerId ?? null,
        filingId: chunk.filingId ?? null,
        reportId: chunk.reportId ?? null,
        reportPeriod: chunk.reportPeriod ?? null,
        title: chunk.title,
        body: chunk.text,
        chunkIndex: chunk.chunkIndex,
        citation: chunk.citation,
        metadata: chunk.metadata ?? {},
        keywords: chunk.keywords,
        embedding: chunk.embedding ?? null,
        embeddingProvider: chunk.embeddingProvider ?? null,
        embeddingModel: chunk.embeddingModel ?? null,
        embeddingDimensions: chunk.embeddingDimensions ?? null,
        contentHash: chunk.contentHash,
        updatedAt: new Date(),
    };
}

function toSemanticChunk(row: typeof alphaRadarSemanticChunks.$inferSelect): AlphaRadarSemanticChunk {
    return {
        id: row.id,
        sourceKind: row.sourceKind as AlphaRadarSemanticSourceKind,
        sourceId: row.sourceId,
        trackedFilerId: row.trackedFilerId ?? undefined,
        filingId: row.filingId ?? undefined,
        reportId: row.reportId ?? undefined,
        reportPeriod: row.reportPeriod ?? undefined,
        title: row.title,
        text: row.body,
        chunkIndex: row.chunkIndex,
        citation: row.citation as AlphaRadarSemanticChunk['citation'],
        metadata: isRecord(row.metadata) ? row.metadata as AlphaRadarSemanticChunk['metadata'] : undefined,
        keywords: Array.isArray(row.keywords) ? row.keywords as string[] : [],
        embedding: Array.isArray(row.embedding) ? row.embedding as number[] : undefined,
        embeddingProvider: row.embeddingProvider ?? undefined,
        embeddingModel: row.embeddingModel ?? undefined,
        embeddingDimensions: row.embeddingDimensions ?? undefined,
        contentHash: row.contentHash,
        createdAt: toIso(row.createdAt),
        updatedAt: toIso(row.updatedAt),
    };
}

function matchesFilters(chunk: AlphaRadarSemanticChunk, filters: AlphaRadarSemanticMemoryFilters): boolean {
    if (filters.trackedFilerIds?.length && (!chunk.trackedFilerId || !filters.trackedFilerIds.includes(chunk.trackedFilerId))) {
        return false;
    }
    if (filters.reportPeriods?.length && (!chunk.reportPeriod || !filters.reportPeriods.includes(chunk.reportPeriod))) {
        return false;
    }
    if (filters.sourceKinds?.length && !filters.sourceKinds.includes(chunk.sourceKind)) {
        return false;
    }
    return true;
}

function toIso(value: Date | null | undefined): string | undefined {
    return value ? value.toISOString() : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
    return value !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
