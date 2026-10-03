import { test, describe } from 'node:test';
import assert from 'node:assert';
import { colorFor, HEAT_COLORS } from './heatmap';

describe('colorFor', () => {
    test('maps the avg/scale ratio onto the five theme stops', () => {
        assert.strictEqual(colorFor(70, 100), HEAT_COLORS.pos2);
        assert.strictEqual(colorFor(30, 100), HEAT_COLORS.pos1);
        assert.strictEqual(colorFor(10, 100), HEAT_COLORS.zero);
        assert.strictEqual(colorFor(-10, 100), HEAT_COLORS.zero);
        assert.strictEqual(colorFor(-30, 100), HEAT_COLORS.neg1);
        assert.strictEqual(colorFor(-70, 100), HEAT_COLORS.neg2);
    });

    test('boundaries fall to the milder stop', () => {
        assert.strictEqual(colorFor(60, 100), HEAT_COLORS.pos1);
        assert.strictEqual(colorFor(20, 100), HEAT_COLORS.zero);
        assert.strictEqual(colorFor(-20, 100), HEAT_COLORS.neg1);
        assert.strictEqual(colorFor(-60, 100), HEAT_COLORS.neg2);
    });

    test('zero scale or zero P&L is neutral', () => {
        assert.strictEqual(colorFor(50, 0), HEAT_COLORS.zero);
        assert.strictEqual(colorFor(0, 100), HEAT_COLORS.zero);
    });

    test('every stop is a theme token, never a literal colour', () => {
        for (const c of Object.values(HEAT_COLORS)) assert.match(c, /^var\(--pm-heat-/);
    });
});
