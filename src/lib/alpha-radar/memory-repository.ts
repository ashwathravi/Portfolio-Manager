import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { alphaRadarSemanticChunks } from '@/db/schema';
import {
    searchAlphaRadarSemanticChunks,
    searchAlphaRadarVectorChunks,
    type AlphaRadarSemanticChunk,
    type AlphaRadarSemanticSearchOptions,
} from './memory';
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
    queryEmbedding?: readonly number[];
}

export interface AlphaRadarSemanticMemoryRepository {
    replaceSourceChunks(input: {
        sourceKind: AlphaRadarSemanticSourceKind;
        sourceId: string;
        chunks: readonly AlphaRadarSemanticChunk[];
    }): Promise<{ inserted: number }>;
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

    async listChunks(filters: AlphaRadarSemanticMemoryFilters = {}): Promise<AlphaRadarSemanticChunk[]> {
        return [...this.chunks.values()].filter((chunk) => matchesFilters(chunk, filters));
    }

    async search(input: AlphaRadarSemanticMemorySearchInput): Promise<AlphaRadarSemanticSearchResult> {
        const chunks = await this.listChunks(input.filters);
        if (input.queryEmbedding?.length) {
            return searchAlphaRadarVectorChunks({
                queryEmbedding: input.queryEmbedding,
                chunks,
                limit: input.limit,
                includeRawText: input.includeRawText,
            });
        }
        return searchAlphaRadarSemanticChunks({
            query: input.query,
            chunks,
            limit: input.limit,
            includeRawText: input.includeRawText,
        });
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
            await this.database.insert(alphaRadarSemanticChunks).values(input.chunks.map((chunk) => ({
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
            })));
        }

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
            .orderBy(alphaRadarSemanticChunks.reportPeriod, alphaRadarSemanticChunks.chunkIndex)
            .limit(500);

        return rows.map(toSemanticChunk);
    }

    async search(input: AlphaRadarSemanticMemorySearchInput): Promise<AlphaRadarSemanticSearchResult> {
        const chunks = await this.listChunks(input.filters);
        const options: AlphaRadarSemanticSearchOptions = {
            query: input.query,
            chunks,
            limit: input.limit,
            includeRawText: input.includeRawText,
        };
        return searchAlphaRadarSemanticChunks(options);
    }
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
