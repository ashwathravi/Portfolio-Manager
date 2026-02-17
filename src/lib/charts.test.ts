
import { test } from 'node:test';
import assert from 'node:assert';
import { calculateSparklinePoints } from './charts.ts';

test('calculateSparklinePoints - empty array', () => {
    assert.strictEqual(calculateSparklinePoints([]), '');
});

test('calculateSparklinePoints - single point', () => {
    assert.strictEqual(calculateSparklinePoints([10], 80, 30), '0,15');
});

test('calculateSparklinePoints - linear trend', () => {
    const points = calculateSparklinePoints([10, 20, 30], 100, 30);
    assert.strictEqual(points, '0,25 50,15 100,5');
});

test('calculateSparklinePoints - flat line', () => {
    const points = calculateSparklinePoints([10, 10, 10], 100, 30);
    assert.strictEqual(points, '0,25 50,25 100,25');
});

test('calculateSparklinePoints - random values check', () => {
    const points = calculateSparklinePoints([0, 100], 100, 30);
    assert.strictEqual(points, '0,25 100,5');
});
