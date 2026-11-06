/**
 * Embeddings for Alpha Radar's evidence memory (launch item i62). Optional:
 *
 * - On when ALPHA_RADAR_EMBEDDING_MODEL names an AI Gateway embedding model
 *   (`openai/text-embedding-3-small`, say). The gateway authenticates with
 *   Vercel's OIDC token, or AI_GATEWAY_API_KEY outside Vercel, and routes
 *   only to providers that keep nothing and don't train on what they're sent.
 * - The daily SEC job embeds a filing's chunks as it stores them (at most
 *   MAX_EMBEDDED_CHUNKS a filing), and a search embeds its query, so chunks
 *   that mean what the query does are found as well as those with its words
 *   (./memory.ts, searchAlphaRadarMemoryChunks).
 * - Off, or when the gateway fails or takes too long, chunks are stored
 *   without embeddings and search is by keyword. Embeddings are stored with
 *   their chunks as JSON, so this needs no Postgres extension.
 */

import { embedMany, type EmbeddingModel } from 'ai';

import { reportError as reportToSentry } from '@/lib/observability/report-error';

import type { AlphaRadarEmbeddingProvider, AlphaRadarSemanticChunk } from './memory';

/** A filing's chunks, all embedded in one go. */
export const EMBEDDING_TIMEOUT_MS = 20_000;
/** A search's query; past it the search is by keyword. */
export const QUERY_EMBEDDING_TIMEOUT_MS = 5_000;
/** The most chunks a filing has embedded; the rest are found by keyword. */
export const MAX_EMBEDDED_CHUNKS = 200;

/** The AI Gateway model chunks are embedded by, or null for none. */
export function alphaRadarEmbeddingModel(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
    return env.ALPHA_RADAR_EMBEDDING_MODEL?.trim() || null;
}

export interface GatewayEmbeddingOptions {
    /** An AI Gateway model ID, or a model object (tests). */
    model: EmbeddingModel;
    timeoutMs?: number;
}

export class GatewayAlphaRadarEmbeddingProvider implements AlphaRadarEmbeddingProvider {
    readonly name = 'ai-gateway';
    readonly model: string;
    /** Whatever the model returns; each chunk stores its own. */
    readonly dimensions = 0;
    private readonly embedder: EmbeddingModel;
    private readonly timeoutMs: number;

    constructor({ model, timeoutMs = EMBEDDING_TIMEOUT_MS }: GatewayEmbeddingOptions) {
        this.embedder = model;
        this.model = typeof model === 'string' ? model : model.modelId;
        this.timeoutMs = timeoutMs;
    }

    isEnabled(): boolean {
        return true;
    }

    async embedTexts(texts: readonly string[]): Promise<number[][]> {
        if (texts.length === 0) return [];
        const { embeddings } = await embedMany({
            model: this.embedder,
            values: [...texts],
            maxRetries: 1,
            abortSignal: AbortSignal.timeout(this.timeoutMs),
            providerOptions: { gateway: { zeroDataRetention: true, disallowPromptTraining: true } },
        });
        return embeddings;
    }
}

/** The configured provider, or null when embeddings are off. */
export function alphaRadarEmbeddingProvider(
    options: { timeoutMs?: number; env?: Readonly<Record<string, string | undefined>> } = {},
): GatewayAlphaRadarEmbeddingProvider | null {
    const model = alphaRadarEmbeddingModel(options.env);
    return model ? new GatewayAlphaRadarEmbeddingProvider({ model, timeoutMs: options.timeoutMs }) : null;
}

/**
 * The query embedded for a search of chunks embedded by the same model, or
 * nothing when embeddings are off, no chunk was embedded by that model, or
 * the gateway fails or takes longer than QUERY_EMBEDDING_TIMEOUT_MS: the
 * search is then by keyword.
 */
export async function embedAlphaRadarQuery(
    query: string,
    chunks: readonly AlphaRadarSemanticChunk[],
    {
        provider = alphaRadarEmbeddingProvider({ timeoutMs: QUERY_EMBEDDING_TIMEOUT_MS }),
        reportError = (error: unknown) => reportToSentry(error, { tags: { route: 'alpha-radar-memory-search', step: 'embedding' } }),
    }: { provider?: AlphaRadarEmbeddingProvider | null; reportError?: (error: unknown) => void } = {},
): Promise<{ queryEmbedding?: number[]; embeddingModel?: string }> {
    if (!provider?.isEnabled() || !query.trim() || !chunks.some((chunk) => chunk.embeddingModel === provider.model)) return {};
    try {
        const [embedding] = await provider.embedTexts([query.trim()]);
        return embedding?.length ? { queryEmbedding: embedding, embeddingModel: provider.model } : {};
    } catch (error) {
        reportError(error);
        return {};
    }
}
