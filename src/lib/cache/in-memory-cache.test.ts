import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert';
import { InMemoryCache } from './in-memory-cache';

describe('InMemoryCache', () => {
    let cache: InMemoryCache;

    beforeEach(() => {
        cache = new InMemoryCache();
    });

    afterEach(() => {
        cache.dispose();
        mock.timers.reset();
    });

    it('stores and retrieves a value', () => {
        cache.set('k', { v: 1 }, 60);
        assert.deepStrictEqual(cache.get('k'), { v: 1 });
    });

    it('returns undefined for missing keys', () => {
        assert.strictEqual(cache.get('nope'), undefined);
    });

    it('reports has() consistent with get()', () => {
        cache.set('k', 'v', 60);
        assert.strictEqual(cache.has('k'), true);
        assert.strictEqual(cache.has('other'), false);
    });

    it('expires entries after TTL elapses (lazy eviction on read)', () => {
        mock.timers.enable({ apis: ['Date'], now: 0 });
        cache.set('k', 'v', 10); // 10s TTL
        assert.strictEqual(cache.get('k'), 'v');
        mock.timers.tick(9_999);
        assert.strictEqual(cache.get('k'), 'v');
        mock.timers.tick(2);
        assert.strictEqual(cache.get('k'), undefined);
        assert.strictEqual(cache.size, 0);
    });

    it('delete() removes a key', () => {
        cache.set('k', 'v', 60);
        cache.delete('k');
        assert.strictEqual(cache.has('k'), false);
    });

    it('clear() removes all keys', () => {
        cache.set('a', 1, 60);
        cache.set('b', 2, 60);
        cache.clear();
        assert.strictEqual(cache.size, 0);
    });

    it('sweep interval purges expired entries eagerly', () => {
        mock.timers.enable({ apis: ['Date', 'setInterval'], now: 0 });
        const sweepCache = new InMemoryCache({ sweepIntervalMs: 1_000 });
        sweepCache.set('k', 'v', 5); // 5s TTL
        mock.timers.tick(6_000); // past TTL
        // sweep ticks at 1s intervals, so by 6s it has run 6 times
        assert.strictEqual(sweepCache.size, 0);
        sweepCache.dispose();
    });

    it('dispose() stops the sweep timer (idempotent)', () => {
        const c = new InMemoryCache({ sweepIntervalMs: 1_000 });
        c.dispose();
        c.dispose(); // should not throw
    });

    it('evicts the least recently used entry when maxEntries is reached', (t) => {
        t.mock.method(console, 'warn', () => {});
        const bounded = new InMemoryCache({ maxEntries: 2, warningThreshold: 1 });
        bounded.set('a', 1, 60);
        bounded.set('b', 2, 60);
        assert.strictEqual(bounded.get('a'), 1); // a is now most recently used
        bounded.set('c', 3, 60);

        assert.strictEqual(bounded.get('a'), 1);
        assert.strictEqual(bounded.get('b'), undefined);
        assert.strictEqual(bounded.get('c'), 3);
        assert.strictEqual(bounded.size, 2);
    });

    it('warns once when approaching capacity', (t) => {
        const warn = t.mock.method(console, 'warn', () => {});
        const bounded = new InMemoryCache({ maxEntries: 5, warningThreshold: 0.8 });
        bounded.set('a', 1, 60);
        bounded.set('b', 2, 60);
        bounded.set('c', 3, 60);
        assert.strictEqual(warn.mock.callCount(), 0);

        bounded.set('d', 4, 60);
        bounded.set('e', 5, 60);
        assert.strictEqual(warn.mock.callCount(), 1);
    });
});
