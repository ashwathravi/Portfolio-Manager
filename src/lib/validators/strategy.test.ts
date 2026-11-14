import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { STRATEGY_LIMITS } from '@/lib/strategies/strategy';

import { strategyInputSchema } from './strategy';

const rule = (i: number) => ({ id: `r${i}`, field: 'RSI(14)', op: '<', value: '30' });

const valid = () => ({
    name: '  Oversold bounce ',
    definition: {
        rules: [rule(1), { id: 'r2', field: 'Close', op: 'crosses above', value: 'SMA(10)' }],
        conjunctions: ['OR'],
        symbols: ['SPY', 'BRK.B'],
        guardrails: { maxPositionPct: 0.05, stopLossPct: 0.08, rebalanceDays: 7 },
    },
    adherenceRules: [{ id: 'a1', type: 'max_position_pct', params: { pct: 5 }, severity: 'soft' }],
});

const issue = (input: unknown) => {
    const parsed = strategyInputSchema.safeParse(input);
    return parsed.success ? 'ok' : `${parsed.error.issues[0].path.join('.')}: ${parsed.error.issues[0].message}`;
};

describe('strategyInputSchema', () => {
    test('accepts a strategy, trimming the name and defaulting the description', () => {
        const parsed = strategyInputSchema.parse(valid());
        assert.equal(parsed.name, 'Oversold bounce');
        assert.equal(parsed.description, '');
    });

    test('a half-written rule saves as typed; its text is only bounded', () => {
        assert.equal(issue({ ...valid(), definition: { ...valid().definition, rules: [{ ...rule(1), value: 'SMA(' }, rule(2)] } }), 'ok');
        assert.equal(issue({ ...valid(), definition: { ...valid().definition, rules: [{ ...rule(1), value: ' ' }, rule(2)] } }), 'definition.rules.0.value: value is required');
        assert.match(issue({ ...valid(), definition: { ...valid().definition, rules: [{ ...rule(1), value: 'x'.repeat(25) }, rule(2)] } }), /at most 24 characters/);
    });

    test('operators, glue, tickers and guardrails stay within what the builder offers', () => {
        const def = valid().definition;
        assert.match(issue({ ...valid(), definition: { ...def, rules: [{ ...rule(1), op: '=' }, rule(2)] } }), /^definition\.rules\.0\.op: op must be one of/);
        assert.equal(issue({ ...valid(), definition: { ...def, conjunctions: [] } }), 'definition.conjunctions: conjunctions must be one fewer than rules');
        assert.equal(issue({ ...valid(), definition: { ...def, symbols: ['SPY', 'SPY'] } }), 'definition.symbols: symbols must not repeat');
        assert.equal(issue({ ...valid(), definition: { ...def, symbols: Array.from({ length: STRATEGY_LIMITS.symbols + 1 }, (_, i) => `T${i}`) } }), `definition.symbols: at most ${STRATEGY_LIMITS.symbols} tickers`);
        assert.equal(issue({ ...valid(), definition: { ...def, guardrails: { ...def.guardrails, rebalanceDays: 91 } } }), 'definition.guardrails.rebalanceDays: rebalanceDays must be 1 to 90');
        assert.equal(issue({ ...valid(), definition: { ...def, guardrails: { ...def.guardrails, maxPositionPct: 0 } } }), 'definition.guardrails.maxPositionPct: maxPositionPct must be 0.005 to 1');
        assert.equal(issue({ ...valid(), definition: { ...def, rules: Array.from({ length: 11 }, (_, i) => rule(i)), conjunctions: Array(10).fill('AND') } }), 'definition.rules: at most 10 rules');
    });

    test('regression: unknown fields and markup are refused', () => {
        assert.match(issue({ ...valid(), userId: 'u' }), /Unrecognized key/);
        assert.match(issue({ ...valid(), definition: { ...valid().definition, universe: [] } }), /Unrecognized key/);
        assert.equal(issue({ ...valid(), name: '<b>x</b>' }), 'name: Input contains invalid characters (< or >)');
        assert.equal(issue({ ...valid(), adherenceRules: [{ id: 'a1', type: 'no_such_rule', params: {}, severity: 'soft' }] }), 'adherenceRules.0.type: unknown adherence rule type');
    });

    test('discipline rules: each parameter within its range, whole numbers where the editor asks for them', () => {
        const withRule = (params: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
            issue({ ...valid(), adherenceRules: [{ id: 'a1', type: 'max_position_pct', params, severity: 'soft', ...extra }] });
        for (const params of [{ pct: 0 }, { pct: 100 }, { days: 0 }, { days: 365 }, { value: 0 }, { value: 10 }, { fromHour: 0, toHour: 24 }, { sector: 'Technology' }, {}]) {
            assert.equal(withRule(params), 'ok', JSON.stringify(params));
        }
        assert.match(withRule({ pct: -1 }), /^adherenceRules\.0\.params\.pct: /);
        assert.match(withRule({ pct: 100.5 }), /^adherenceRules\.0\.params\.pct: /);
        assert.match(withRule({ days: 2.5 }), /^adherenceRules\.0\.params\.days: /);
        assert.match(withRule({ days: 366 }), /^adherenceRules\.0\.params\.days: /);
        assert.match(withRule({ value: 11 }), /^adherenceRules\.0\.params\.value: /);
        assert.match(withRule({ fromHour: -1 }), /^adherenceRules\.0\.params\.fromHour: /);
        assert.match(withRule({ toHour: 25 }), /^adherenceRules\.0\.params\.toHour: /);
        assert.match(withRule({ fromHour: 9.5 }), /^adherenceRules\.0\.params\.fromHour: /);
        assert.match(withRule({ sector: 'x'.repeat(61) }), /^adherenceRules\.0\.params\.sector: /);
        assert.equal(withRule({ sector: '<script>' }), 'adherenceRules.0.params.sector: Input contains invalid characters (< or >)');
        assert.match(withRule({ pct: 5, limit: 3 }), /^adherenceRules\.0\.params: Unrecognized key/);
        assert.match(withRule({}, { severity: 'block' }), /^adherenceRules\.0\.severity: /);
        assert.match(withRule({}, { id: 'has space' }), /^adherenceRules\.0\.id: id must be letters, digits, _ or -/);
        assert.equal(issue({
            ...valid(),
            adherenceRules: Array.from({ length: STRATEGY_LIMITS.adherenceRules + 1 }, (_, i) => ({ id: `a${i}`, type: 'stop_loss_required', params: {}, severity: 'soft' })),
        }), `adherenceRules: at most ${STRATEGY_LIMITS.adherenceRules} adherence rules`);
    });

    test('a save may carry its page\'s order: a page ID and a count from 1', () => {
        assert.equal(issue({ ...valid(), order: { session: 'page-1234', seq: 1 } }), 'ok');
        assert.equal(issue({ ...valid(), order: { session: 'page-1234', seq: 0 } }), 'order.seq: seq must be at least 1');
        assert.equal(issue({ ...valid(), order: { session: 'x', seq: 1 } }), 'order.session: session must be a page ID');
        assert.match(issue({ ...valid(), order: { session: 'page-1234', seq: 1, at: 2 } }), /^order: Unrecognized key/);
    });
});
