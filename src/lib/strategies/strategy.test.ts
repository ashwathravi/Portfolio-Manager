import { test, describe } from 'node:test';
import assert from 'node:assert';
import { compileRules } from './backtest';
import { SEED_STRATEGIES } from './seed';
import {
    addRule,
    addSymbols,
    backtestWindowLabel,
    duplicateStrategy,
    hasUnbacktestedChanges,
    opLabel,
    removeRule,
    removeSymbol,
    setConjunction,
    setGuardrail,
    STRATEGY_LIMITS,
    summarizeRules,
} from './strategy';

const base = SEED_STRATEGIES[0];

describe('strategy reducers', () => {
    test('addRule appends a rule and glues it with AND by default', () => {
        const next = addRule(base.rules, base.conjunctions, { id: 'x', field: 'RSI(14)', op: '<', value: '30' });
        assert.strictEqual(next.rules.length, base.rules.length + 1);
        assert.strictEqual(next.conjunctions.at(-1), 'AND');
    });

    test('addRule to an empty rule set adds no conjunction', () => {
        const next = addRule([], [], { id: 'x', field: 'RSI(14)', op: '<', value: '30' }, 'OR');
        assert.deepStrictEqual(next.conjunctions, []);
    });

    test('removeRule drops the rule and its left-side conjunction; unknown ids are a no-op', () => {
        const next = removeRule(base.rules, base.conjunctions, base.rules[1].id);
        assert.strictEqual(next.rules.length, base.rules.length - 1);
        assert.strictEqual(next.conjunctions.length, base.conjunctions.length - 1);
        assert.deepStrictEqual(removeRule(base.rules, base.conjunctions, 'missing').rules, base.rules);
    });

    test('setConjunction and setGuardrail return new values', () => {
        assert.strictEqual(setConjunction(['AND', 'AND'], 1, 'OR')[1], 'OR');
        const g = setGuardrail(base.guardrails, 'maxPositionPct', 7);
        assert.strictEqual(g.maxPositionPct, 7);
        assert.notStrictEqual(g, base.guardrails);
    });

    test('addSymbols uppercases, skips repeats and stops at the limit; removeSymbol drops one', () => {
        assert.deepStrictEqual(addSymbols(['SPY'], [' qqq', 'SPY', 'QQQ', '']), ['SPY', 'QQQ']);
        const full = Array.from({ length: STRATEGY_LIMITS.symbols }, (_, i) => `T${i}`);
        assert.strictEqual(addSymbols(full, ['NEW']).length, STRATEGY_LIMITS.symbols);
        assert.deepStrictEqual(removeSymbol(['SPY', 'QQQ'], 'SPY'), ['QQQ']);
    });

    test('summarizeRules', () => {
        assert.strictEqual(summarizeRules({ rules: [] }), 'No rules');
        assert.strictEqual(summarizeRules({ rules: [base.rules[0]] }), '1 rule');
        assert.strictEqual(summarizeRules(base), `${base.rules.length} rules`);
    });
});

describe('duplicateStrategy', () => {
    test('copies the definition and discipline rules under a new name, without the backtest', () => {
        const copy = duplicateStrategy(base, SEED_STRATEGIES, 'local-1');
        assert.strictEqual(copy.id, 'local-1');
        assert.strictEqual(copy.name, `${base.name} (copy)`);
        assert.strictEqual(copy.example, undefined);
        assert.strictEqual(copy.backtest, null);
        assert.deepStrictEqual(copy.symbols, base.symbols);
        assert.notStrictEqual(copy.symbols, base.symbols);
        assert.deepStrictEqual(copy.adherenceRules, base.adherenceRules);
        assert.deepStrictEqual(copy.rules.map((r) => r.id), base.rules.map((_, i) => `r${i + 1}`));
    });

    test('a second copy gets a numbered name', () => {
        const first = duplicateStrategy(base, SEED_STRATEGIES, 'local-1');
        assert.strictEqual(duplicateStrategy(base, [...SEED_STRATEGIES, first], 'local-2').name, `${base.name} (copy 2)`);
    });
});

describe('hasUnbacktestedChanges', () => {
    test('an unedited strategy and a fresh copy match their backtest', () => {
        assert.strictEqual(hasUnbacktestedChanges(base, base.backtest!.definition), false);
        assert.strictEqual(hasUnbacktestedChanges(duplicateStrategy(base, SEED_STRATEGIES, 'local-1'), base.backtest!.definition), false);
    });

    test('changing a rule value, a ticker, or a guardrail flags the backtest as stale', () => {
        const ran = base.backtest!.definition;
        assert.strictEqual(hasUnbacktestedChanges({ ...base, rules: base.rules.map((r, i) => (i === 0 ? { ...r, value: '20%' } : r)) }, ran), true);
        assert.strictEqual(hasUnbacktestedChanges({ ...base, symbols: removeSymbol(base.symbols, base.symbols[0]) }, ran), true);
        assert.strictEqual(hasUnbacktestedChanges({ ...base, guardrails: setGuardrail(base.guardrails, 'maxPositionPct', 0.09) }, ran), true);
    });
});

describe('backtestWindowLabel', () => {
    test('first and last month of the window', () => {
        assert.strictEqual(backtestWindowLabel('2024-05-01', '2026-04-30'), 'May 2024 – Apr 2026');
    });
});

describe('opLabel', () => {
    test('renders comparison operators as typographic symbols', () => {
        assert.strictEqual(opLabel('>='), '≥');
        assert.strictEqual(opLabel('<='), '≤');
    });

    test('leaves single-character and word operators alone', () => {
        assert.strictEqual(opLabel('>'), '>');
        assert.strictEqual(opLabel('crosses above'), 'crosses above');
    });
});

describe('example strategies', () => {
    test('regression: every example rule is one the backtest engine can read', () => {
        for (const s of SEED_STRATEGIES) {
            assert.ok(compileRules(s).ok, s.name);
            assert.strictEqual(s.example, true);
            assert.strictEqual(s.conjunctions.length, s.rules.length - 1);
            assert.strictEqual(hasUnbacktestedChanges(s, s.backtest!.definition), false, s.name);
        }
    });
});
