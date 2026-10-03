import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    attributionHeadline,
    computeAttribution,
    formatPp,
    defaultSectorBreakdown,
    defaultAssetClassBreakdown,
    type AttributionSegment,
} from './attribution';

const approx = (actual: number, expected: number, epsilon = 1e-9) =>
    Math.abs(actual - expected) < epsilon;

describe('computeAttribution', () => {
    test('returns zeros when given no segments', () => {
        const result = computeAttribution([]);
        assert.deepStrictEqual(result.segments, []);
        assert.strictEqual(result.total.portfolioReturn, 0);
        assert.strictEqual(result.total.benchmarkReturn, 0);
        assert.strictEqual(result.total.alpha, 0);
        assert.strictEqual(result.total.totalEffect, 0);
    });

    test('portfolio and benchmark returns are weight-weighted averages', () => {
        const segments: AttributionSegment[] = [
            { key: 'a', label: 'A', portfolioWeight: 0.6, benchmarkWeight: 0.5, portfolioReturn: 0.10, benchmarkReturn: 0.08 },
            { key: 'b', label: 'B', portfolioWeight: 0.4, benchmarkWeight: 0.5, portfolioReturn: 0.05, benchmarkReturn: 0.06 },
        ];
        const { total } = computeAttribution(segments);
        // Portfolio: 0.6*0.10 + 0.4*0.05 = 0.06 + 0.02 = 0.08
        assert.ok(approx(total.portfolioReturn, 0.08), `got ${total.portfolioReturn}`);
        // Benchmark: 0.5*0.08 + 0.5*0.06 = 0.04 + 0.03 = 0.07
        assert.ok(approx(total.benchmarkReturn, 0.07), `got ${total.benchmarkReturn}`);
        assert.ok(approx(total.alpha, 0.01));
    });

    test('BHB decomposition sums exactly to alpha (Brinson identity)', () => {
        const segments: AttributionSegment[] = [
            { key: 'a', label: 'A', portfolioWeight: 0.6, benchmarkWeight: 0.5, portfolioReturn: 0.10, benchmarkReturn: 0.08 },
            { key: 'b', label: 'B', portfolioWeight: 0.4, benchmarkWeight: 0.5, portfolioReturn: 0.05, benchmarkReturn: 0.06 },
        ];
        const { total } = computeAttribution(segments);
        const decomposed = total.allocationEffect + total.selectionEffect + total.interactionEffect;
        assert.ok(approx(decomposed, total.alpha, 1e-12), `decomposition ${decomposed} != alpha ${total.alpha}`);
        assert.ok(approx(total.totalEffect, total.alpha, 1e-12));
    });

    test('equal weights zero out the allocation and interaction effects', () => {
        const segments: AttributionSegment[] = [
            { key: 'a', label: 'A', portfolioWeight: 0.5, benchmarkWeight: 0.5, portfolioReturn: 0.10, benchmarkReturn: 0.08 },
            { key: 'b', label: 'B', portfolioWeight: 0.5, benchmarkWeight: 0.5, portfolioReturn: 0.04, benchmarkReturn: 0.06 },
        ];
        const { segments: rows, total } = computeAttribution(segments);
        for (const row of rows) {
            assert.ok(approx(row.allocationEffect, 0), `allocation ${row.allocationEffect} should be 0 for equal weights`);
            assert.ok(approx(row.interactionEffect, 0), `interaction ${row.interactionEffect} should be 0 for equal weights`);
        }
        assert.ok(approx(total.allocationEffect, 0));
        assert.ok(approx(total.interactionEffect, 0));
        // All alpha is pure selection effect here
        assert.ok(approx(total.selectionEffect, total.alpha, 1e-12));
    });

    test('identical portfolio and benchmark yields zero selection effect', () => {
        const segments: AttributionSegment[] = [
            { key: 'a', label: 'A', portfolioWeight: 0.7, benchmarkWeight: 0.5, portfolioReturn: 0.10, benchmarkReturn: 0.10 },
            { key: 'b', label: 'B', portfolioWeight: 0.3, benchmarkWeight: 0.5, portfolioReturn: 0.02, benchmarkReturn: 0.02 },
        ];
        const { segments: rows, total } = computeAttribution(segments);
        for (const row of rows) {
            assert.ok(approx(row.selectionEffect, 0));
            assert.ok(approx(row.interactionEffect, 0));
        }
        assert.ok(approx(total.selectionEffect, 0));
    });

    test('contribution equals portfolio weight times portfolio return', () => {
        const segments: AttributionSegment[] = [
            { key: 'a', label: 'A', portfolioWeight: 0.3, benchmarkWeight: 0.2, portfolioReturn: 0.20, benchmarkReturn: 0.10 },
        ];
        const { segments: rows, total } = computeAttribution(segments);
        assert.ok(approx(rows[0].contribution, 0.06));
        assert.ok(approx(total.portfolioReturn, 0.06));
    });

    test('handles negative returns without breaking the identity', () => {
        const segments: AttributionSegment[] = [
            { key: 'a', label: 'A', portfolioWeight: 0.4, benchmarkWeight: 0.5, portfolioReturn: -0.05, benchmarkReturn: -0.03 },
            { key: 'b', label: 'B', portfolioWeight: 0.6, benchmarkWeight: 0.5, portfolioReturn: 0.12, benchmarkReturn: 0.09 },
        ];
        const { total } = computeAttribution(segments);
        const decomposed = total.allocationEffect + total.selectionEffect + total.interactionEffect;
        assert.ok(approx(decomposed, total.alpha, 1e-12));
    });
});

describe('defaultSectorBreakdown', () => {
    test('portfolio weights sum to 1', () => {
        const totalWeight = defaultSectorBreakdown.reduce((acc, s) => acc + s.portfolioWeight, 0);
        assert.ok(approx(totalWeight, 1, 1e-9), `portfolio weights sum to ${totalWeight}`);
    });

    test('benchmark weights sum to 1', () => {
        const totalWeight = defaultSectorBreakdown.reduce((acc, s) => acc + s.benchmarkWeight, 0);
        assert.ok(approx(totalWeight, 1, 1e-9), `benchmark weights sum to ${totalWeight}`);
    });

    test('every segment has unique key', () => {
        const keys = defaultSectorBreakdown.map((s) => s.key);
        assert.strictEqual(new Set(keys).size, keys.length);
    });

    test('decomposition equals alpha on the default sector breakdown', () => {
        const { total } = computeAttribution(defaultSectorBreakdown);
        const decomposed = total.allocationEffect + total.selectionEffect + total.interactionEffect;
        assert.ok(approx(decomposed, total.alpha, 1e-9));
    });
});

describe('defaultAssetClassBreakdown', () => {
    test('portfolio weights sum to 1', () => {
        const totalWeight = defaultAssetClassBreakdown.reduce((acc, s) => acc + s.portfolioWeight, 0);
        assert.ok(approx(totalWeight, 1, 1e-9), `weights sum to ${totalWeight}`);
    });

    test('benchmark weights sum to 1', () => {
        const totalWeight = defaultAssetClassBreakdown.reduce((acc, s) => acc + s.benchmarkWeight, 0);
        assert.ok(approx(totalWeight, 1, 1e-9), `weights sum to ${totalWeight}`);
    });
});

describe('attributionHeadline', () => {
    const seg = (key: string, wP: number, wB: number, rP: number, rB: number) => ({
        key, label: key, portfolioWeight: wP, benchmarkWeight: wB, portfolioReturn: rP, benchmarkReturn: rB,
    });

    test('names the verdict, the main driver, and the single biggest move', () => {
        const summary = computeAttribution([
            seg('Tech', 0.5, 0.5, 0.2, 0.1),
            seg('Energy', 0.5, 0.5, 0.05, 0.05),
        ]);
        const h = attributionHeadline(summary);
        assert.strictEqual(h.verdict, 'You beat the benchmark by 5.0 pp');
        assert.strictEqual(h.mainDriver.name, 'selection');
        assert.deepStrictEqual(h.biggestMove && [h.biggestMove.label, h.biggestMove.name], ['Tech', 'selection']);
    });

    test('trailing and matching read correctly', () => {
        assert.strictEqual(
            attributionHeadline(computeAttribution([seg('A', 1, 1, 0.01, 0.03)])).verdict,
            'You trailed the benchmark by 2.0 pp',
        );
        const flat = attributionHeadline(computeAttribution([seg('A', 1, 1, 0.03, 0.03)]));
        assert.strictEqual(flat.verdict, 'You matched the benchmark');
        assert.strictEqual(flat.biggestMove, null);
    });

    test('an overweight in a winning segment is an allocation story', () => {
        const h = attributionHeadline(computeAttribution([
            seg('Tech', 0.8, 0.4, 0.2, 0.2),
            seg('Bonds', 0.2, 0.6, 0.02, 0.02),
        ]));
        assert.strictEqual(h.mainDriver.name, 'allocation');
        assert.ok(h.mainDriver.value > 0);
    });
});

describe('formatPp', () => {
    test('signs and rounds to one decimal of a percentage point', () => {
        assert.strictEqual(formatPp(0.0213), '+2.1 pp');
        assert.strictEqual(formatPp(-0.0049), '−0.5 pp');
        assert.strictEqual(formatPp(0.00001), '0.0 pp');
    });
});
