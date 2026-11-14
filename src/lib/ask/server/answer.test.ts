import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { MockLanguageModelV4 } from 'ai/test';

import { EMPTY_POLICY_PORTFOLIO, type PolicyPortfolio } from '@/lib/risk-policy';
import type { PolicyData } from '@/lib/risk-policy/server';
import { storedRiskPolicy } from '@/lib/settings/risk-policy';

import { plan } from '../planner';
import { answerQuestion, answerQuestionWith, askContextLoader, loadAskContext, type AskSources } from './answer';

const NOW = new Date('2026-10-26T16:00:00.000Z');
const PORTFOLIO: PolicyPortfolio = {
    holdings: [
        { id: 'h1', symbol: 'NVDA', name: 'NVIDIA Corp', quantity: 10, avgCost: 100, currentPrice: 180, marketValue: 1_800, defaultBucket: 'active' },
        { id: 'h2', symbol: 'vti', name: 'Vanguard Total Stock Market ETF', quantity: 10, avgCost: 200, currentPrice: 250, marketValue: 2_500, defaultBucket: 'core' },
    ],
    cashTotal: 500,
    trades: [],
    theses: [],
};

function sources() {
    const calls: string[] = [];
    const fake: AskSources = {
        loadData: async (userId) => {
            calls.push(`data:${userId}`);
            return {
                portfolio: PORTFOLIO,
                activity: [],
                profiles: new Map([['NVDA', { symbol: 'NVDA', name: 'NVIDIA Corp', type: 'CS', sector: 'Tech', industry: null }]]),
            } satisfies PolicyData;
        },
        loadPolicy: async () => {
            calls.push('policy');
            return storedRiskPolicy({ status: 'unavailable' });
        },
        loadCloses: async (symbols, from, to) => {
            calls.push(`closes:${symbols.join(',')}:${from}:${to}`);
            return new Map();
        },
        loadEvidence: async () => {
            calls.push('evidence');
            return [];
        },
    };
    return { calls, fake };
}

describe('loadAskContext', () => {
    test('loads the user\'s portfolio and policy, and sectors from the securities master', async () => {
        const { calls, fake } = sources();
        const ctx = await loadAskContext('user-a', plan('Am I overexposed to AI?'), { now: NOW, databaseConfigured: true, sources: fake });
        assert.deepEqual(calls, ['data:user-a', 'policy']);
        assert.equal(ctx.portfolio, PORTFOLIO);
        assert.deepEqual(ctx.sectors, { NVDA: 'Tech' });
        assert.equal(ctx.closes, undefined);
        assert.equal(ctx.alphaRadarMemory, undefined);
        assert.equal(ctx.now, NOW.getTime());
    });

    test('stored closes only for a correlation, for the ticker asked about and the holdings', async () => {
        const { calls, fake } = sources();
        await loadAskContext('user-a', plan('How do my holdings correlate with SPY?'), { now: NOW, databaseConfigured: true, sources: fake });
        // About 144 calendar days hold the last 90 sessions.
        assert.ok(calls.includes('closes:SPY,NVDA,VTI:2026-06-04:2026-10-26'), calls.join(' | '));
    });

    test('Alpha Radar evidence only for an evidence question', async () => {
        const { calls, fake } = sources();
        await loadAskContext('user-a', plan('Find Alpha Radar evidence for Berkshire'), { now: NOW, databaseConfigured: true, sources: fake });
        assert.ok(calls.includes('evidence'));
    });

    test('without a database nothing is loaded and there is nothing to answer from', async () => {
        const { calls, fake } = sources();
        const ctx = await loadAskContext('user-a', plan('Am I overexposed to AI?'), { now: NOW, databaseConfigured: false, sources: fake });
        assert.deepEqual(calls, []);
        assert.equal(ctx.portfolio, EMPTY_POLICY_PORTFOLIO);
        assert.match((await answerQuestion('user-a', 'Am I overexposed to AI?', { now: NOW, databaseConfigured: false, sources: fake })).text, /no holdings to answer from yet/);
    });

    test('answers from what was loaded', async () => {
        const { fake } = sources();
        const answer = await answerQuestion('user-a', 'Am I overexposed to AI?', { now: NOW, databaseConfigured: true, sources: fake });
        // NVDA's sector from its profile; VTI has none, so the ticker map's.
        assert.deepEqual(answer.toolRuns[0].rows.map((row) => [row.label, row.value]), [['Other', '58.1%'], ['Tech', '41.9%']]);
    });

    test('a failed load is an error, not an empty portfolio', async () => {
        const { fake } = sources();
        const failing = { ...fake, loadData: async () => { throw new Error('connect ECONNREFUSED'); } };
        await assert.rejects(answerQuestion('user-a', 'Am I overexposed to AI?', { now: NOW, databaseConfigured: true, sources: failing }), /ECONNREFUSED/);
    });
});

describe('askContextLoader', () => {
    test('each part of the user\'s data is loaded once, however many tools read it', async () => {
        const { calls, fake } = sources();
        const load = askContextLoader('user-a', { now: NOW, databaseConfigured: true, sources: fake });
        await load([{ name: 'sector_exposure', args: {} }]);
        await load([{ name: 'policy_breaches', args: {} }]);
        await load([{ name: 'alpha_radar_evidence_search', args: { query: 'NVDA' } }]);
        await load([{ name: 'alpha_radar_evidence_search', args: { query: 'Berkshire' } }]);
        await load([{ name: 'correlation_with', args: { symbol: 'SPY' } }]);
        await load([{ name: 'correlation_with', args: { symbol: 'spy' } }]);
        assert.deepEqual(calls, ['data:user-a', 'policy', 'evidence', 'closes:SPY,NVDA,VTI:2026-06-04:2026-10-26']);
    });
});

describe('answerQuestionWith (launch item i59)', () => {
    const USAGE = {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
    };
    const writes = (text: string) => new MockLanguageModelV4({
        doGenerate: async () => ({ content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: undefined }, usage: USAGE, warnings: [] }),
    });

    test('without ASK_MODEL the rules answer', async () => {
        const { fake } = sources();
        const { answer, writer } = await answerQuestionWith('user-a', 'Am I overexposed to AI?', { now: NOW, databaseConfigured: true, sources: fake });
        assert.equal(writer, 'rules');
        assert.match(answer.text, /Current sector exposure is led by/);
    });

    test('Claude writes the answer when it can', async () => {
        const { fake } = sources();
        const { answer, writer } = await answerQuestionWith('user-a', 'Hello', {
            now: NOW, databaseConfigured: true, sources: fake, claude: { model: writes('I answer questions about your portfolio.'), userId: 'user-a' },
        });
        assert.equal(writer, 'claude');
        assert.equal(answer.text, 'I answer questions about your portfolio.');
    });

    test('and the rules answer when it can\'t, from the same data', async () => {
        const { calls, fake } = sources();
        const { answer, writer } = await answerQuestionWith('user-a', 'Am I overexposed to AI?', {
            now: NOW, databaseConfigured: true, sources: fake, claude: { model: writes('You hold $9,999 of AI.'), userId: 'user-a' },
        });
        assert.equal(writer, 'rules');
        assert.match(answer.text, /Current sector exposure is led by/);
        assert.deepEqual(calls, ['data:user-a', 'policy']);
    });
});
