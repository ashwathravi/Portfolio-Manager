
import { test } from 'node:test';
import assert from 'node:assert';
import { calculateSparklinePoints } from './charts.ts';

// ---------------------------------------------------------------------------
// Existing tests
// ---------------------------------------------------------------------------

test('calculateSparklinePoints - empty array', () => {
    assert.strictEqual(calculateSparklinePoints([]), '');
});

test('calculateSparklinePoints - single point', () => {
    assert.strictEqual(calculateSparklinePoints([10], 80, 30), '0,15');
});

test('calculateSparklinePoints - linear trend', () => {
    const points = calculateSparklinePoints([10, 20, 30], 100, 30);
    assert.strictEqual(points, '0.00,25.00 50.00,15.00 100.00,5.00');
});

test('calculateSparklinePoints - flat line', () => {
    const points = calculateSparklinePoints([10, 10, 10], 100, 30);
    assert.strictEqual(points, '0.00,25.00 50.00,25.00 100.00,25.00');
});

test('calculateSparklinePoints - random values check', () => {
    const points = calculateSparklinePoints([0, 100], 100, 30);
    assert.strictEqual(points, '0.00,25.00 100.00,5.00');
});

// ---------------------------------------------------------------------------
// New edge-case tests
// ---------------------------------------------------------------------------

test('calculateSparklinePoints - negative values in dataset', () => {
    const points = calculateSparklinePoints([-50, 0, 50], 100, 30);
    // min = -50, max = 50, range = 100
    // drawHeight = 30 - 10 = 20, stepX = 50
    // point 0: x=0,   norm=0/100=0,   y=25 - 0*20 = 25
    // point 1: x=50,  norm=50/100=0.5, y=25 - 0.5*20 = 15
    // point 2: x=100, norm=100/100=1,  y=25 - 1*20 = 5
    assert.strictEqual(points, '0.00,25.00 50.00,15.00 100.00,5.00');
});

test('calculateSparklinePoints - drawHeight <= 0 (large padding)', () => {
    // height=10, padding=5 → drawHeight = 10 - 10 = 0 → triggers fallback branch
    const points = calculateSparklinePoints([10, 20, 30], 100, 10, 5);
    // Fallback: each point y = height/2 = 5
    assert.strictEqual(points, '0.00,5.00 50.00,5.00 100.00,5.00');
});

test('calculateSparklinePoints - drawHeight negative (padding exceeds height)', () => {
    // height=4, padding=5 → drawHeight = 4 - 10 = -6 → triggers fallback branch
    const points = calculateSparklinePoints([1, 2], 100, 4, 5);
    // Fallback: each point y = height/2 = 2
    assert.strictEqual(points, '0.00,2.00 100.00,2.00');
});

test('calculateSparklinePoints - default parameters (no width/height/padding)', () => {
    // Defaults: width=80, height=30, padding=5
    const points = calculateSparklinePoints([10, 20]);
    // min=10, max=20, range=10, drawHeight=20, stepX=80
    // point 0: x=0,  norm=0,  y=25 - 0 = 25
    // point 1: x=80, norm=1,  y=25 - 20 = 5
    assert.strictEqual(points, '0.00,25.00 80.00,5.00');
});

test('calculateSparklinePoints - all negative values', () => {
    const points = calculateSparklinePoints([-30, -20, -10], 100, 30);
    // min=-30, max=-10, range=20, drawHeight=20, stepX=50
    // point 0: x=0,   norm=0,   y=25
    // point 1: x=50,  norm=0.5, y=15
    // point 2: x=100, norm=1,   y=5
    assert.strictEqual(points, '0.00,25.00 50.00,15.00 100.00,5.00');
});

test('calculateSparklinePoints - large dataset produces correct point count', () => {
    const data = Array.from({ length: 100 }, (_, i) => i);
    const result = calculateSparklinePoints(data, 200, 50);
    const pointCount = result.split(' ').length;
    assert.strictEqual(pointCount, 100);
});

test('calculateSparklinePoints - single point uses default dimensions', () => {
    // Defaults: width=80, height=30
    assert.strictEqual(calculateSparklinePoints([42]), '0,15');
});
