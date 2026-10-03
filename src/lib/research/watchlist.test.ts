import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
    addToWatchlist,
    distanceToEntryPct,
    findWatchItem,
    loadWatchlist,
    normalizeTicker,
    removeFromWatchlist,
    saveWatchlist,
    seedWatchlist,
    updateWatchItem,
    WATCHLIST_STORAGE_KEY,
    type WatchItem,
} from './watchlist';

const NOW = Date.parse('2026-10-03T15:00:00Z');

function memoryStorage() {
    const map = new Map<string, string>();
    return {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        map,
    };
}

describe('normalizeTicker', () => {
    test('uppercases and trims valid symbols, including class shares and pairs', () => {
        assert.strictEqual(normalizeTicker(' nvda '), 'NVDA');
        assert.strictEqual(normalizeTicker('brk.b'), 'BRK.B');
        assert.strictEqual(normalizeTicker('btc-usd'), 'BTC-USD');
    });

    test('rejects empty, spaced, and malformed input', () => {
        assert.strictEqual(normalizeTicker(''), null);
        assert.strictEqual(normalizeTicker('NV DA'), null);
        assert.strictEqual(normalizeTicker('AAPL$'), null);
        assert.strictEqual(normalizeTicker('A..B'), null);
    });
});

describe('addToWatchlist', () => {
    test('prepends a new item dated today with no target', () => {
        const { list, item, error } = addToWatchlist(seedWatchlist(NOW), 'msft', { now: NOW });
        assert.strictEqual(error, undefined);
        assert.strictEqual(list[0], item);
        assert.strictEqual(item?.ticker, 'MSFT');
        assert.strictEqual(item?.addedAt, '2026-10-03');
        assert.strictEqual(item?.targetEntry, null);
        assert.strictEqual(item?.sample, undefined);
        assert.strictEqual(list.length, 4);
    });

    test('refuses duplicates case-insensitively and invalid tickers', () => {
        const seeded = seedWatchlist(NOW);
        assert.strictEqual(addToWatchlist(seeded, 'coin', { now: NOW }).error, 'duplicate');
        assert.strictEqual(addToWatchlist(seeded, 'not a ticker', { now: NOW }).error, 'invalid');
        assert.strictEqual(addToWatchlist(seeded, 'coin', { now: NOW }).list.length, 3);
    });
});

describe('removeFromWatchlist / findWatchItem', () => {
    test('remove by ticker, any case; unknown tickers are a no-op', () => {
        const seeded = seedWatchlist(NOW);
        assert.ok(findWatchItem(seeded, 'pltr'));
        const after = removeFromWatchlist(seeded, 'pltr');
        assert.strictEqual(findWatchItem(after, 'PLTR'), undefined);
        assert.strictEqual(after.length, 2);
        assert.strictEqual(removeFromWatchlist(seeded, 'ZZZZ').length, 3);
    });
});

describe('updateWatchItem', () => {
    test('edits reason, notes, and target; an edited example becomes the user\'s', () => {
        const seeded = seedWatchlist(NOW);
        const id = seeded[0].id;
        const [first] = updateWatchItem(seeded, id, { notes: 'Mine now', targetEntry: 150 });
        assert.strictEqual(first.notes, 'Mine now');
        assert.strictEqual(first.targetEntry, 150);
        assert.strictEqual(first.sample, undefined);
    });

    test('a zero, negative, or non-finite target clears it', () => {
        const seeded = seedWatchlist(NOW);
        const id = seeded[0].id;
        for (const bad of [0, -5, Number.NaN, null]) {
            assert.strictEqual(updateWatchItem(seeded, id, { targetEntry: bad })[0].targetEntry, null);
        }
    });

    test('unknown ids change nothing', () => {
        const seeded = seedWatchlist(NOW);
        assert.deepStrictEqual(updateWatchItem(seeded, 'nope', { notes: 'x' }), seeded);
    });
});

describe('distanceToEntryPct', () => {
    test('negative when the price has to fall to the entry', () => {
        assert.strictEqual(distanceToEntryPct(200, 150), -25);
        assert.strictEqual(distanceToEntryPct(100, 110), 10);
    });

    test('null without a live price or a target', () => {
        assert.strictEqual(distanceToEntryPct(undefined, 150), null);
        assert.strictEqual(distanceToEntryPct(0, 150), null);
        assert.strictEqual(distanceToEntryPct(100, null), null);
    });
});

describe('seedWatchlist', () => {
    test('is tagged sample, carries no stored price, and is dated within the last month', () => {
        const seeded = seedWatchlist(NOW);
        assert.ok(seeded.every((w) => w.sample === true));
        assert.ok(seeded.every((w) => !('currentPrice' in w)));
        assert.deepStrictEqual(seeded.map((w) => w.addedAt), ['2026-09-13', '2026-09-20', '2026-09-27']);
    });
});

describe('watchlist storage', () => {
    test('round-trips through storage', () => {
        const storage = memoryStorage();
        const { list } = addToWatchlist(seedWatchlist(NOW), 'amd', { now: NOW });
        saveWatchlist(storage, list);
        assert.deepStrictEqual(loadWatchlist(storage), list);
    });

    test('an empty saved list stays empty (the user removed everything)', () => {
        const storage = memoryStorage();
        saveWatchlist(storage, []);
        assert.deepStrictEqual(loadWatchlist(storage), []);
    });

    test('missing, corrupt, or wrong-version data loads as null', () => {
        const storage = memoryStorage();
        assert.strictEqual(loadWatchlist(storage), null);
        storage.map.set(WATCHLIST_STORAGE_KEY, '{oops');
        assert.strictEqual(loadWatchlist(storage), null);
        storage.map.set(WATCHLIST_STORAGE_KEY, JSON.stringify({ version: 9, items: [] }));
        assert.strictEqual(loadWatchlist(storage), null);
        assert.strictEqual(loadWatchlist(null), null);
    });

    test('drops malformed rows and duplicate tickers', () => {
        const storage = memoryStorage();
        const good: WatchItem = { id: 'a', ticker: 'aapl', companyName: '', reason: '', notes: '', targetEntry: -1, addedAt: '2026-10-01' };
        storage.map.set(
            WATCHLIST_STORAGE_KEY,
            JSON.stringify({ version: 1, items: [good, { ...good, id: 'b' }, { id: 'c' }, { id: 'd', ticker: 'bad ticker' }] }),
        );
        const loaded = loadWatchlist(storage);
        assert.strictEqual(loaded?.length, 1);
        assert.strictEqual(loaded?.[0].ticker, 'AAPL');
        assert.strictEqual(loaded?.[0].targetEntry, null);
    });
});
