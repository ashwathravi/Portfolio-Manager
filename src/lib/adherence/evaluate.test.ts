import { test, describe } from 'node:test';
import assert from 'node:assert';
import { countViolations, evaluateRules } from './evaluate';
import type { AdherenceRule } from './rules';

const hours = (fromHour: number, toHour: number): AdherenceRule => ({
    id: 'r-hours', type: 'allowed_hours', params: { fromHour, toHour }, severity: 'soft',
});

describe('allowed_hours', () => {
    test('evaluates the hour in market time (ET), whatever the machine timezone', () => {
        // 14:30 UTC on 15 Jun 2026 = 10:30 EDT, inside a 9–16 session.
        const inside = evaluateRules([hours(9, 16)], { ticker: 'AAPL', side: 'buy', executedAt: '2026-06-15T14:30:00Z' }, 'x');
        assert.strictEqual(inside.results[0].passed, true);
        // 21:00 UTC = 17:00 EDT, after the session.
        const after = evaluateRules([hours(9, 16)], { ticker: 'AAPL', side: 'buy', executedAt: '2026-06-15T21:00:00Z' }, 'x');
        assert.strictEqual(after.results[0].passed, false);
    });

    test('regression: the result does not depend on process.env.TZ', () => {
        const ctx = { ticker: 'AAPL', side: 'buy' as const, executedAt: Date.parse('2026-01-20T15:59:00Z') }; // 10:59 EST
        const prev = process.env.TZ;
        try {
            process.env.TZ = 'Asia/Tokyo';
            const tokyo = evaluateRules([hours(9, 16)], ctx, 'x');
            process.env.TZ = 'UTC';
            const utc = evaluateRules([hours(9, 16)], ctx, 'x');
            assert.deepStrictEqual(tokyo, utc);
            assert.strictEqual(utc.score, 100);
        } finally {
            if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
        }
    });

    test('missing execution time passes neutrally', () => {
        const r = evaluateRules([hours(9, 16)], { ticker: 'AAPL', side: 'buy' }, 'x');
        assert.strictEqual(r.results[0].passed, true);
    });
});

describe('evaluateRules', () => {
    test('no rules scores 100 with no violations', () => {
        const r = evaluateRules([], { ticker: 'AAPL', side: 'buy' }, 'x');
        assert.deepStrictEqual([r.score, countViolations(r)], [100, 0]);
    });

    test('score is the share of rules that pass', () => {
        const r = evaluateRules([hours(9, 16), hours(0, 1)], { ticker: 'AAPL', side: 'buy', executedAt: '2026-06-15T14:30:00Z' }, 'x');
        assert.deepStrictEqual([r.score, countViolations(r)], [50, 1]);
    });
});
