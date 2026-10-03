import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildThesisPriceSeries, synthesizeWalk } from './priceSeries';

const bull = { ticker: 'NVDA', type: 'bull' as const, targetPrice: 200, currentPrice: 160 };
const bars = [
    { time: '2026-10-02T13:30:00Z', open: 150, high: 151, low: 149, close: 150.5, volume: 1 },
    { time: '2026-10-02T13:35:00Z', open: 150.5, high: 160, low: 150, close: 160, volume: 1 },
];

describe('buildThesisPriceSeries', () => {
    test('live bars give a real open, now, and day change', () => {
        const s = buildThesisPriceSeries(bars, bull);
        assert.strictEqual(s.source, 'live');
        assert.deepStrictEqual(s.data, [150.5, 160]);
        assert.strictEqual(s.open, 150);
        assert.strictEqual(s.now, 160);
        assert.ok(Math.abs((s.changePct ?? 0) - 6.6667) < 1e-3);
        assert.deepStrictEqual(s.benchmark, [200, 200]);
    });

    test('without bars the shape is illustrative and never claims an open or day change', () => {
        const s = buildThesisPriceSeries([], bull);
        assert.strictEqual(s.source, 'illustrative');
        assert.strictEqual(s.data.length, 22);
        assert.strictEqual(s.open, null);
        assert.strictEqual(s.changePct, null);
        assert.strictEqual(s.now, 160);
        assert.strictEqual(s.toTargetPct, 25);
    });

    test('no bars and no saved price means no series', () => {
        const s = buildThesisPriceSeries(undefined, { ...bull, currentPrice: undefined });
        assert.strictEqual(s.source, 'none');
        assert.deepStrictEqual(s.data, []);
        assert.deepStrictEqual(s.benchmark, []);
        assert.strictEqual(s.now, null);
        assert.strictEqual(s.toTargetPct, null);
    });

    test('a zero or non-finite saved price is treated as missing', () => {
        assert.strictEqual(buildThesisPriceSeries([], { ...bull, currentPrice: 0 }).source, 'none');
        assert.strictEqual(buildThesisPriceSeries([], { ...bull, currentPrice: Number.NaN }).source, 'none');
    });

    test('to-target is signed from a bear thesis point of view', () => {
        const s = buildThesisPriceSeries(bars, { ...bull, type: 'bear', targetPrice: 120 });
        assert.strictEqual(s.toTargetPct, 25);
    });
});

describe('synthesizeWalk', () => {
    test('is deterministic per ticker and ends exactly at the anchor', () => {
        const a = synthesizeWalk(100, 'AAPL');
        assert.deepStrictEqual(a, synthesizeWalk(100, 'AAPL'));
        assert.notDeepStrictEqual(a, synthesizeWalk(100, 'MSFT'));
        assert.strictEqual(a[a.length - 1], 100);
    });
});
