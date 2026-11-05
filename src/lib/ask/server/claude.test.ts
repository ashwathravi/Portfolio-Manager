import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { MockLanguageModelV4 } from 'ai/test';

import { setErrorReporterForTests } from '@/lib/observability/report-error';
import { stressScenariosFor, type PolicyPortfolio } from '@/lib/risk-policy';
import { storedRiskPolicy } from '@/lib/settings/risk-policy';

import type { PlannedCall } from '../planner';
import type { AskContext } from '../tools';
import type { AskMessage } from '../types';
import {
    answerWithClaude,
    askModel,
    CLAUDE_HISTORY_MESSAGES,
    CLAUDE_MAX_TOOL_RUNS,
    STRESS_SCENARIO_IDS,
} from './claude';

const NOW = new Date('2026-10-26T16:00:00.000Z');
const PORTFOLIO: PolicyPortfolio = {
    holdings: [
        { id: 'h1', symbol: 'NVDA', name: 'NVIDIA Corp', quantity: 10, avgCost: 100, currentPrice: 180, marketValue: 1_800, defaultBucket: 'active' },
        { id: 'h2', symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', quantity: 10, avgCost: 200, currentPrice: 250, marketValue: 2_500, defaultBucket: 'core' },
    ],
    cashTotal: 500,
    trades: [],
    theses: [],
};

function context(overrides: Partial<AskContext> = {}): AskContext {
    return {
        portfolio: PORTFOLIO,
        activity: [],
        closedTrades: [],
        policy: storedRiskPolicy({ status: 'unavailable' }),
        sectors: { NVDA: 'Tech', VTI: 'Broad market' },
        now: NOW.getTime(),
        ...overrides,
    };
}

const USAGE = {
    inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 5, text: 5, reasoning: undefined },
};

type Step = { tools: Array<{ name: string; input: Record<string, unknown> }> } | { text: string };
type Call = Parameters<MockLanguageModelV4['doGenerate']>[0];

/** A model that takes `steps` in turn, and the calls it was made with. */
function scripted(steps: Step[]) {
    const calls: Call[] = [];
    const model = new MockLanguageModelV4({
        doGenerate: async (options) => {
            calls.push(options);
            const step = steps[Math.min(calls.length - 1, steps.length - 1)];
            if ('text' in step) {
                return { content: [{ type: 'text', text: step.text }], finishReason: { unified: 'stop', raw: undefined }, usage: USAGE, warnings: [] };
            }
            return {
                content: step.tools.map((call, i) => ({
                    type: 'tool-call' as const,
                    toolCallId: `call-${calls.length}-${i}`,
                    toolName: call.name,
                    input: JSON.stringify(call.input),
                })),
                finishReason: { unified: 'tool-calls', raw: undefined },
                usage: USAGE,
                warnings: [],
            };
        },
    });
    return { model, calls };
}

/** What the tools returned to the model, in order. */
function toolResults(call: Call): unknown[] {
    return call.prompt
        .filter((message) => message.role === 'tool')
        .flatMap((message) => message.content)
        .map((part) => (part.type === 'tool-result' && part.output.type === 'json' ? part.output.value : part));
}

function loader(ctx: AskContext = context()) {
    const loaded: PlannedCall[][] = [];
    const load = async (calls: readonly PlannedCall[]) => {
        loaded.push([...calls]);
        return ctx;
    };
    return { load, loaded };
}

let reported: unknown[] = [];
beforeEach(() => {
    reported = [];
    setErrorReporterForTests({ capture: (error) => reported.push(error), afterResponse: () => {} });
});
afterEach(() => setErrorReporterForTests(null));

describe('askModel (launch item i59)', () => {
    test('the AI Gateway model ASK_MODEL names, or none', () => {
        assert.equal(askModel({ ASK_MODEL: ' anthropic/claude-sonnet-5.5 ' }), 'anthropic/claude-sonnet-5.5');
        assert.equal(askModel({ ASK_MODEL: '' }), null);
        assert.equal(askModel({}), null);
    });

    test('the stress scenarios offered are the built-in ones', () => {
        assert.deepEqual([...STRESS_SCENARIO_IDS].sort(), stressScenariosFor(['ACME']).map((scenario) => scenario.id).sort());
    });
});

describe('answerWithClaude', () => {
    test('Claude calls a tool over the user\'s data and answers in a sentence; its rows are listed under it', async () => {
        const { model, calls } = scripted([
            { tools: [{ name: 'sector_exposure', input: {} }] },
            { text: 'Your largest sector is **Broad market** at 58.1%[[tool:sector_exposure#0]], then Tech at 41.9%[[tool:sector_exposure#1]].' },
        ]);
        const { load, loaded } = loader();
        const answer = await answerWithClaude('Am I overexposed to tech?', load, { model, userId: 'user-a', now: NOW });

        assert.ok(answer);
        assert.deepEqual(loaded, [[{ name: 'sector_exposure', args: {} }]]);
        assert.equal(answer.text, [
            'Your largest sector is **Broad market** at 58.1%[[tool:sector_exposure#0]], then Tech at 41.9%[[tool:sector_exposure#1]].',
            '- **Broad market** — 58.1%[[tool:sector_exposure#0]] _$2,500_\n- **Tech** — 41.9%[[tool:sector_exposure#1]] _$1,800_',
        ].join('\n\n'));
        assert.deepEqual(answer.citations.map((citation) => citation.marker), ['tool:sector_exposure#0', 'tool:sector_exposure#1']);
        assert.deepEqual(answer.toolRuns.map((run) => run.name), ['sector_exposure']);

        // The model saw the rows with their markers, and nothing of example data.
        assert.deepEqual(toolResults(calls[1]), [{
            rows: [
                { cite: '[[tool:sector_exposure#0]]', label: 'Broad market', value: '58.1%', detail: '$2,500' },
                { cite: '[[tool:sector_exposure#1]]', label: 'Tech', value: '41.9%', detail: '$1,800' },
            ],
        }]);
    });

    test('sent through AI Gateway to providers that keep nothing and don\'t train, with the user hashed', async () => {
        const { model, calls } = scripted([{ text: 'I can answer questions about your portfolio.' }]);
        await answerWithClaude('Hello', loader().load, { model, userId: 'user-a', now: NOW });
        const gateway = calls[0].providerOptions?.gateway as Record<string, unknown>;
        assert.equal(gateway.zeroDataRetention, true);
        assert.equal(gateway.disallowPromptTraining, true);
        assert.match(String(gateway.user), /^[0-9a-f]{32}$/);
        assert.doesNotMatch(String(gateway.user), /user-a/);
        assert.equal(calls[0].maxOutputTokens, 2_000);
        const system = calls[0].prompt.find((message) => message.role === 'system');
        assert.match(String(system?.content), /not investment advice/);
        assert.match(String(system?.content), /Today is 2026-10-26\./);
        assert.deepEqual(calls[0].tools?.map((t) => t.name).sort(), [
            'alpha_radar_evidence_search', 'cash_jobs', 'churn_risks', 'correlation_with', 'missing_theses', 'pnl_attribution',
            'policy_breaches', 'sector_exposure', 'stress_test', 'theme_exposure', 'top_alpha_contributors', 'trade_policy_impact',
            'trades_matching', 'trim_to_target',
        ]);
    });

    test('a follow-up reads the last few messages, from a question on, without their markers', async () => {
        const history: AskMessage[] = Array.from({ length: 9 }, (_, i) => ({
            id: `m${i}`,
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: i % 2 === 0 ? `Question ${i}` : `Answer ${i} at 41.9%[[tool:sector_exposure#0]]`,
            ts: NOW.getTime() - (10 - i) * 1_000,
        }));
        const { model, calls } = scripted([{ text: 'Still 41.9%.' }]);
        const answer = await answerWithClaude('And now?', loader().load, { model, userId: 'user-a', history, now: NOW });

        const messages = calls[0].prompt.filter((message) => message.role !== 'system');
        // The last CLAUDE_HISTORY_MESSAGES start with an answer, which is left out.
        assert.equal(messages.length, CLAUDE_HISTORY_MESSAGES);
        assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant', 'user', 'assistant', 'user', 'user']);
        assert.ok(JSON.stringify(messages).includes('Answer 7 at 41.9%'));
        assert.ok(!JSON.stringify(messages).includes('[[tool:'));
        // A figure from the conversation is backed by it.
        assert.equal(answer?.text, 'Still 41.9%.');
    });

    test('regression: a figure no tool returned means the rules answer instead', async () => {
        const { model } = scripted([
            { tools: [{ name: 'sector_exposure', input: {} }] },
            { text: 'Tech is about 42%[[tool:sector_exposure#1]] of your $4,300 portfolio.' },
        ]);
        assert.equal(await answerWithClaude('Am I overexposed to tech?', loader().load, { model, userId: 'user-a', now: NOW }), null);
    });

    test('markers that cite nothing and headings are taken out', async () => {
        const { model } = scripted([
            { tools: [{ name: 'cash_jobs', input: {} }] },
            { text: '## Cash\nYour unassigned cash is $500[[tool:cash_jobs#0]][[tool:sector_exposure#4]].' },
        ]);
        const answer = await answerWithClaude('How is my cash assigned?', loader().load, { model, userId: 'user-a', now: NOW });
        assert.match(answer?.text ?? '', /^Cash\nYour unassigned cash is \$500\[\[tool:cash_jobs#0\]\]\.\n\n- \*\*Unassigned cash\*\*/);
    });

    test('a tool run twice gets markers of its own, and each list its title', async () => {
        const { model } = scripted([
            { tools: [{ name: 'stress_test', input: { symbol: 'NVDA' } }, { name: 'stress_test', input: { scenarioId: 'semis_35_down' } }] },
            { text: 'A 40% drop in NVDA would cost -$720[[tool:stress_test#0]].' },
        ]);
        const answer = await answerWithClaude('What if NVDA or semis drop?', loader().load, { model, userId: 'user-a', now: NOW });
        assert.ok(answer);
        const [first, second] = answer.toolRuns;
        assert.equal(answer.citations.length, first.rows.length + second.rows.length);
        assert.equal(new Set(answer.citations.map((citation) => citation.marker)).size, answer.citations.length);
        assert.ok(answer.text.includes(`[[tool:stress_test#${first.rows.length}]]`));
        assert.equal(answer.text.match(/^_Stress test_$/gm)?.length, 2);
    });

    test('an empty result tells the model what it means', async () => {
        const { model, calls } = scripted([
            { tools: [{ name: 'missing_theses', input: {} }, { name: 'trades_matching', input: { outcome: 'loss' } }] },
            { text: 'Neither NVDA nor VTI has an active thesis, and you have no closed losing trades.' },
        ]);
        const answer = await answerWithClaude('Anything missing?', loader().load, { model, userId: 'user-a', now: NOW });
        const [, trades] = toolResults(calls[1]) as Array<{ rows: unknown[]; empty?: string }>;
        assert.deepEqual(trades.rows, []);
        assert.match(trades.empty ?? '', /No closed trades in that window/);
        assert.ok(answer);
    });

    test('an answer from closed trades says which tickers it left out', async () => {
        const { model } = scripted([
            { tools: [{ name: 'trades_matching', input: {} }] },
            { text: 'You have no closed trades to show.' },
        ]);
        const answer = await answerWithClaude('My trades?', loader(context({ closedTradesLeftOut: ['TSLA'] })).load, { model, userId: 'user-a', now: NOW });
        assert.match(answer?.text ?? '', /_Left out: TSLA\./);
    });

    test(`at most ${CLAUDE_MAX_TOOL_RUNS} lookups a question`, async () => {
        const { model, calls } = scripted([
            { tools: Array.from({ length: CLAUDE_MAX_TOOL_RUNS + 1 }, () => ({ name: 'cash_jobs', input: {} })) },
            { text: 'Your unassigned cash is $500[[tool:cash_jobs#0]].' },
        ]);
        const { load, loaded } = loader();
        const answer = await answerWithClaude('Cash?', load, { model, userId: 'user-a', now: NOW });
        assert.equal(loaded.length, CLAUDE_MAX_TOOL_RUNS);
        assert.equal(answer?.toolRuns.length, CLAUDE_MAX_TOOL_RUNS);
        assert.deepEqual(toolResults(calls[1]).at(-1), { error: 'Too many lookups for one question. Answer from the results so far.' });
    });

    test('an answer cut off by the token limit means the rules answer', async () => {
        const model = new MockLanguageModelV4({
            doGenerate: async () => ({
                content: [{ type: 'text', text: 'Your largest sector is' }],
                finishReason: { unified: 'length', raw: undefined },
                usage: USAGE,
                warnings: [],
            }),
        });
        assert.equal(await answerWithClaude('Sectors?', loader().load, { model, userId: 'user-a', now: NOW }), null);
    });

    test('no answer once the steps run out means the rules answer', async () => {
        const { model, calls } = scripted([{ tools: [{ name: 'cash_jobs', input: {} }] }]);
        assert.equal(await answerWithClaude('Cash?', loader().load, { model, userId: 'user-a', now: NOW }), null);
        assert.equal(calls.length, 4);
    });

    test('a gateway failure is reported without the question or data, and the rules answer', async () => {
        const model = new MockLanguageModelV4({
            doGenerate: async () => {
                throw Object.assign(new Error('Insufficient credits for Am I overexposed to tech?'), { name: 'GatewayError', statusCode: 402 });
            },
        });
        assert.equal(await answerWithClaude('Am I overexposed to tech?', loader().load, { model, userId: 'user-a', now: NOW }), null);
        assert.equal(reported.length, 1);
        assert.match(String(reported[0]), /Ask's Claude answer failed: \w*Error \(402\)/);
        assert.doesNotMatch(String(reported[0]), /overexposed/);
    });

    test('regression: the user\'s data failing to load is an error, not an answer', async () => {
        const { model } = scripted([
            { tools: [{ name: 'sector_exposure', input: {} }] },
            { text: 'I could not load your data.' },
        ]);
        const failing = async () => { throw new Error('connect ECONNREFUSED'); };
        await assert.rejects(answerWithClaude('Am I overexposed to tech?', failing, { model, userId: 'user-a', now: NOW }), /ECONNREFUSED/);
        assert.equal(reported.length, 0);
    });
});
