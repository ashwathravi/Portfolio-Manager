import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { MockEmbeddingModelV4 } from 'ai/test';

import {
    alphaRadarEmbeddingModel,
    alphaRadarEmbeddingProvider,
    embedAlphaRadarQuery,
    GatewayAlphaRadarEmbeddingProvider,
} from './embeddings';
import { chunkAlphaRadarText, type AlphaRadarSemanticChunk } from './memory';

function model(embed: (values: string[]) => number[][] = (values) => values.map(() => [0.6, 0.8])) {
    return new MockEmbeddingModelV4({
        provider: 'gateway',
        modelId: 'openai/text-embedding-3-small',
        maxEmbeddingsPerCall: 100,
        doEmbed: async ({ values }) => ({ embeddings: embed(values as string[]), warnings: [] }),
    });
}

const CHUNK: AlphaRadarSemanticChunk = {
    ...chunkAlphaRadarText({
        sourceKind: 'memo-section',
        sourceId: 'r-1:summary',
        title: 'Summary',
        text: 'Added to Chubb.',
        citation: { kind: 'memo-section', id: 'r-1:summary', title: 'Summary' },
    })[0],
    embedding: [1, 0],
    embeddingModel: 'openai/text-embedding-3-small',
};

describe('Alpha Radar embeddings (launch item i62)', () => {
    test('off unless ALPHA_RADAR_EMBEDDING_MODEL names a model', () => {
        assert.equal(alphaRadarEmbeddingModel({}), null);
        assert.equal(alphaRadarEmbeddingModel({ ALPHA_RADAR_EMBEDDING_MODEL: '  ' }), null);
        assert.equal(alphaRadarEmbeddingProvider({ env: {} }), null);
        assert.equal(alphaRadarEmbeddingModel({ ALPHA_RADAR_EMBEDDING_MODEL: ' openai/text-embedding-3-small ' }), 'openai/text-embedding-3-small');
        assert.equal(alphaRadarEmbeddingProvider({ env: { ALPHA_RADAR_EMBEDDING_MODEL: 'openai/text-embedding-3-small' } })?.model, 'openai/text-embedding-3-small');
    });

    test('embeds through the gateway only with providers that keep nothing and train on nothing', async () => {
        const embedder = model();
        const provider = new GatewayAlphaRadarEmbeddingProvider({ model: embedder });

        assert.deepEqual(await provider.embedTexts(['a', 'b']), [[0.6, 0.8], [0.6, 0.8]]);
        assert.equal(provider.model, 'openai/text-embedding-3-small');
        assert.deepEqual(embedder.doEmbedCalls.map((call) => call.values), [['a', 'b']]);
        assert.deepEqual(embedder.doEmbedCalls[0].providerOptions, { gateway: { zeroDataRetention: true, disallowPromptTraining: true } });
        assert.ok(embedder.doEmbedCalls[0].abortSignal, 'with a timeout');
        assert.deepEqual(await provider.embedTexts([]), []);
        assert.equal(embedder.doEmbedCalls.length, 1, 'nothing to embed asks nothing');
    });

    test('a search embeds its query only when chunks were embedded by the same model', async () => {
        const embedder = model();
        const provider = new GatewayAlphaRadarEmbeddingProvider({ model: embedder });

        assert.deepEqual(await embedAlphaRadarQuery('insurers', [CHUNK], { provider: null }), {});
        assert.deepEqual(await embedAlphaRadarQuery('insurers', [{ ...CHUNK, embeddingModel: 'voyage/voyage-4' }], { provider }), {});
        assert.deepEqual(await embedAlphaRadarQuery('  ', [CHUNK], { provider }), {});
        assert.equal(embedder.doEmbedCalls.length, 0);

        assert.deepEqual(await embedAlphaRadarQuery(' insurers ', [CHUNK], { provider }), {
            queryEmbedding: [0.6, 0.8],
            embeddingModel: 'openai/text-embedding-3-small',
        });
        assert.deepEqual(embedder.doEmbedCalls.map((call) => call.values), [['insurers']]);
    });

    test('when the gateway fails, the search goes on by keyword and the failure is reported', async () => {
        const failing = new MockEmbeddingModelV4({
            modelId: 'openai/text-embedding-3-small',
            doEmbed: async () => { throw new Error('gateway down'); },
        });
        const reported: unknown[] = [];

        const result = await embedAlphaRadarQuery('insurers', [CHUNK], {
            provider: new GatewayAlphaRadarEmbeddingProvider({ model: failing }),
            reportError: (error) => reported.push(error),
        });

        assert.deepEqual(result, {});
        assert.equal(reported.length, 1);
        assert.match(String(reported[0]), /gateway down/);
    });
});
