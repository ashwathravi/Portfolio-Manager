import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SEED_STRATEGIES } from './seed';
import { isKnownStrategyId, resolveSelectedStrategyId, strategyHref } from './routes';

describe('strategy routes', () => {
    test('strategyHref encodes the id into the workspace query string', () => {
        assert.strictEqual(strategyHref('strategy-momentum-value'), '/strategies?strategy=strategy-momentum-value');
        assert.strictEqual(strategyHref('a b/c'), '/strategies?strategy=a%20b%2Fc');
    });

    test('regression: every seeded strategy id is known (no more "Strategy not found")', () => {
        for (const s of SEED_STRATEGIES) {
            assert.strictEqual(isKnownStrategyId(s.id, SEED_STRATEGIES), true, s.id);
        }
    });

    test('unknown, empty, or missing ids are not known', () => {
        assert.strictEqual(isKnownStrategyId('nope', SEED_STRATEGIES), false);
        assert.strictEqual(isKnownStrategyId('', SEED_STRATEGIES), false);
        assert.strictEqual(isKnownStrategyId(undefined, SEED_STRATEGIES), false);
    });

    test('resolveSelectedStrategyId honours a known id', () => {
        assert.strictEqual(resolveSelectedStrategyId('strategy-sector-rotation', SEED_STRATEGIES), 'strategy-sector-rotation');
    });

    test('resolveSelectedStrategyId falls back to the first strategy', () => {
        assert.strictEqual(resolveSelectedStrategyId('missing', SEED_STRATEGIES), SEED_STRATEGIES[0].id);
        assert.strictEqual(resolveSelectedStrategyId(null, SEED_STRATEGIES), SEED_STRATEGIES[0].id);
    });

    test('resolveSelectedStrategyId returns "" for an empty list', () => {
        assert.strictEqual(resolveSelectedStrategyId('x', []), '');
    });
});
