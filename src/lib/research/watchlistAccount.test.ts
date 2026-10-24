import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { WatchItemInput } from '@/lib/validators/watchlist';

import { seedWatchlist, type WatchItem } from './watchlist';
import { AccountRequestError } from './accountWrites';
import {
    applyWatchWrite,
    fetchAccountWatchlist,
    importAccountWatchlist,
    importBrowserWatchlist,
    mergeAccountWatchlist,
    saveWrite,
    sendWatchWrite,
    toWatchItemInput,
    watchlistFullCopyKey,
    watchlistImportItems,
    type AccountWatchlist,
    type WatchWrite,
} from './watchlistAccount';

const NOW = Date.parse('2026-10-23T15:00:00Z');
const ORDER = { session: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', seq: 3 };
const EXAMPLES = seedWatchlist(Date.parse('2026-10-23T00:00:00Z'));
const NO_WRITES = new Map<string, WatchWrite>();

function input(id: string, ticker: string, extra: Partial<WatchItemInput> = {}): WatchItemInput {
    return { id, ticker, companyName: '', reason: '', notes: '', targetEntry: null, addedAt: '2026-10-20', dismissed: false, ...extra };
}

const NVDA = input('w-nvda-a', 'NVDA');
const AMD = input('w-amd-b', 'AMD');

function ids(list: readonly WatchItem[]) {
    return list.map((w) => w.id);
}

describe('mergeAccountWatchlist', () => {
    test('before anything has loaded, shows the examples', () => {
        assert.deepEqual(mergeAccountWatchlist(undefined, NO_WRITES, EXAMPLES), EXAMPLES);
    });

    test("the account's rows come first, then the examples in their order", () => {
        const merged = mergeAccountWatchlist({ items: [NVDA, AMD], dismissed: [] }, NO_WRITES, EXAMPLES);
        assert.deepEqual(ids(merged), ['w-nvda-a', 'w-amd-b', 'w-coin', 'w-pltr', 'w-shop']);
        // Rows carry no dismissed flag, and the user's rows no Sample tag.
        assert.deepEqual(merged[0], { id: 'w-nvda-a', ticker: 'NVDA', companyName: '', reason: '', notes: '', targetEntry: null, addedAt: '2026-10-20' });
        assert.equal(merged[2].sample, true);
    });

    test("a saved example replaces it in place and isn't tagged Sample; a dismissed one is gone", () => {
        const coin = input('w-coin', 'COIN', { notes: 'mine now' });
        const merged = mergeAccountWatchlist({ items: [coin, NVDA], dismissed: ['w-pltr'] }, NO_WRITES, EXAMPLES);
        assert.deepEqual(ids(merged), ['w-nvda-a', 'w-coin', 'w-shop']);
        assert.equal(merged[1].notes, 'mine now');
        assert.equal(merged[1].sample, undefined);
    });

    test('an example is hidden when the user has their own row for its ticker', () => {
        const merged = mergeAccountWatchlist({ items: [input('w-shop-x', 'SHOP')], dismissed: [] }, NO_WRITES, EXAMPLES);
        assert.deepEqual(ids(merged), ['w-shop-x', 'w-coin', 'w-pltr']);
    });

    test('unsaved writes show on top: adds newest first, edits in place, removals gone', () => {
        const pending = new Map<string, WatchWrite>([
            ['w-intc-c', { kind: 'put', item: input('w-intc-c', 'INTC') }],
            ['w-amd-b', { kind: 'put', item: { ...AMD, notes: 'edited' } }],
            ['w-tsla-d', { kind: 'put', item: input('w-tsla-d', 'TSLA') }],
            ['w-nvda-a', { kind: 'put', item: { ...NVDA, dismissed: true } }],
            ['w-coin', { kind: 'put', item: input('w-coin', 'COIN', { dismissed: true }) }],
        ]);
        const merged = mergeAccountWatchlist({ items: [NVDA, AMD], dismissed: [] }, pending, EXAMPLES);
        assert.deepEqual(ids(merged), ['w-tsla-d', 'w-intc-c', 'w-amd-b', 'w-pltr', 'w-shop']);
        assert.equal(merged[2].notes, 'edited');
    });

    test('re-adding a dismissed example before the save lands shows it again', () => {
        const pending = new Map<string, WatchWrite>([['w-coin', { kind: 'put', item: input('w-coin', 'COIN') }]]);
        const merged = mergeAccountWatchlist({ items: [], dismissed: ['w-coin'] }, pending, EXAMPLES);
        assert.deepEqual(ids(merged), ['w-coin', 'w-pltr', 'w-shop']);
        assert.equal(merged[0].sample, undefined);
    });
});

describe('applyWatchWrite', () => {
    const stored: AccountWatchlist = { items: [NVDA, AMD], dismissed: ['w-coin'] };

    test('a new item goes first; an edited one keeps its place', () => {
        assert.deepEqual(applyWatchWrite(stored, 'w-intc-c', { kind: 'put', item: input('w-intc-c', 'INTC') }).items.map((i) => i.id), ['w-intc-c', 'w-nvda-a', 'w-amd-b']);
        const edited = applyWatchWrite(stored, 'w-nvda-a', { kind: 'put', item: { ...NVDA, notes: 'x' } });
        assert.deepEqual(edited.items.map((i) => [i.id, i.notes]), [['w-nvda-a', 'x'], ['w-amd-b', '']]);
    });

    test("a removal moves the row to dismissed, the user's own or an example; a save un-dismisses", () => {
        assert.deepEqual(applyWatchWrite(stored, 'w-amd-b', { kind: 'put', item: { ...AMD, dismissed: true } }), { items: [NVDA], dismissed: ['w-coin', 'w-amd-b'] });
        assert.deepEqual(
            applyWatchWrite(stored, 'w-pltr', { kind: 'put', item: input('w-pltr', 'PLTR', { dismissed: true }) }),
            { items: [NVDA, AMD], dismissed: ['w-coin', 'w-pltr'] },
        );
        const restored = applyWatchWrite(stored, 'w-coin', { kind: 'put', item: input('w-coin', 'COIN') });
        assert.deepEqual(restored.dismissed, []);
        assert.equal(restored.items[0].id, 'w-coin');
    });

    test('works before the list has loaded', () => {
        assert.deepEqual(applyWatchWrite(undefined, 'w-nvda-a', { kind: 'put', item: NVDA }), { items: [NVDA], dismissed: [] });
    });
});

describe('saveWrite', () => {
    test('saves an item under its own id', () => {
        assert.deepEqual(saveWrite(AMD, NO_WRITES), { id: AMD.id, write: { kind: 'put', item: AMD } });
    });

    test("regression: re-adding a ticker whose removal is still being sent reuses the removed row's id", () => {
        // The Codex finding on PR #147: the add, sent alongside the removal,
        // could land first and be refused as a duplicate.
        const pending = new Map<string, WatchWrite>([[AMD.id, { kind: 'put', item: { ...AMD, dismissed: true } }]]);
        const readded = input('w-amd-new', 'AMD', { reason: 'back on the list' });
        assert.deepEqual(saveWrite(readded, pending), { id: AMD.id, write: { kind: 'put', item: { ...readded, id: AMD.id } } });
        // Not for another ticker, another removal, or a pending save that isn't one.
        assert.equal(saveWrite(input('w-intc-x', 'INTC'), pending).id, 'w-intc-x');
        assert.equal(saveWrite({ ...readded, dismissed: true }, pending).id, 'w-amd-new');
        const live = new Map<string, WatchWrite>([[AMD.id, { kind: 'put', item: AMD }]]);
        assert.equal(saveWrite(readded, live).id, 'w-amd-new');
    });
});

describe('toWatchItemInput', () => {
    const item: WatchItem = { id: 'w-nvda-a', ticker: 'NVDA', companyName: ' NVIDIA ', reason: 'r', notes: 'n', targetEntry: 120, addedAt: '2026-10-20', sample: true };

    test('drops the example flag and trims the short fields', () => {
        assert.deepEqual(toWatchItemInput(item, { now: NOW }), {
            id: 'w-nvda-a', ticker: 'NVDA', companyName: 'NVIDIA', reason: 'r', notes: 'n', targetEntry: 120, addedAt: '2026-10-20', dismissed: false,
        });
        assert.equal(toWatchItemInput(item, { now: NOW, dismissed: true })?.dismissed, true);
    });

    test('cuts text to the limits and dates an undated item today', () => {
        const long = toWatchItemInput({ ...item, reason: 'r'.repeat(600), notes: 'n'.repeat(6000), companyName: 'c'.repeat(300), addedAt: '' }, { now: NOW });
        assert.equal(long?.reason.length, 500);
        assert.equal(long?.notes.length, 5000);
        assert.equal(long?.companyName.length, 200);
        assert.equal(long?.addedAt, '2026-10-23');
    });

    test('null for an item the API would refuse', () => {
        assert.equal(toWatchItemInput({ ...item, id: 'Not An Id' }, { now: NOW }), null);
        assert.equal(toWatchItemInput({ ...item, ticker: 'a..b' }, { now: NOW }), null);
    });
});

describe('watchlistImportItems', () => {
    test("sends the user's rows and a dismissal for each removed example, not untouched examples", () => {
        const adopted: WatchItem = { ...EXAMPLES[0], notes: 'adopted' };
        delete adopted.sample;
        const local: WatchItem[] = [
            { id: 'w-nvda-a', ticker: 'NVDA', companyName: '', reason: '', notes: '', targetEntry: null, addedAt: '2026-10-01' },
            adopted,
            EXAMPLES[1],
        ];
        const { items, shortened } = watchlistImportItems(local, EXAMPLES, NOW);
        assert.deepEqual(items.map((i) => [i.id, i.dismissed]), [['w-nvda-a', false], ['w-coin', false], ['w-shop', true]]);
        assert.equal(items[1].notes, 'adopted');
        assert.equal(shortened, false);
    });

    test('an emptied list dismisses every example; an untouched one sends nothing', () => {
        assert.deepEqual(watchlistImportItems([], EXAMPLES, NOW).items.map((i) => i.id), ['w-coin', 'w-pltr', 'w-shop']);
        assert.deepEqual(watchlistImportItems(EXAMPLES, EXAMPLES, NOW), { items: [], shortened: false });
    });

    test('skips repeated ids and rows the API would refuse', () => {
        const nvda: WatchItem = { id: 'w-nvda-a', ticker: 'NVDA', companyName: '', reason: '', notes: '', targetEntry: null, addedAt: '2026-10-01' };
        const { items, shortened } = watchlistImportItems([nvda, { ...nvda, notes: 'again' }, { ...nvda, id: 'BAD ID', ticker: 'AMD' }, ...EXAMPLES], EXAMPLES, NOW);
        assert.deepEqual(items.map((i) => i.id), ['w-nvda-a']);
        assert.equal(items[0].notes, '');
        // The refused row is reported, so the browser keeps its copy.
        assert.equal(shortened, true);
    });

    test('says when text was longer than the account keeps', () => {
        const nvda: WatchItem = { id: 'w-nvda-a', ticker: 'NVDA', companyName: '', reason: '', notes: '', targetEntry: null, addedAt: '2026-10-01' };
        for (const long of [{ reason: 'r'.repeat(501) }, { notes: 'n'.repeat(5001) }, { companyName: 'c'.repeat(201) }]) {
            assert.equal(watchlistImportItems([{ ...nvda, ...long }, ...EXAMPLES], EXAMPLES, NOW).shortened, true, Object.keys(long)[0]);
        }
        // Spaces the account trims anyway don't count.
        assert.equal(watchlistImportItems([{ ...nvda, reason: `  ${'r'.repeat(500)}  ` }, ...EXAMPLES], EXAMPLES, NOW).shortened, false);
        assert.equal(watchlistImportItems([{ ...nvda, notes: 'n'.repeat(5000) }, ...EXAMPLES], EXAMPLES, NOW).shortened, false);
    });
});

describe('requests', () => {
    function recorder(responses: Response[]) {
        const calls: { url: string; init: RequestInit }[] = [];
        const fetchImpl = (async (url: string, init: RequestInit = {}) => {
            calls.push({ url, init });
            return responses.shift() ?? new Response(null, { status: 204 });
        }) as unknown as typeof fetch;
        return { calls, fetchImpl };
    }

    test('loads the account list', async () => {
        const { calls, fetchImpl } = recorder([Response.json({ data: { items: [NVDA], dismissed: ['w-coin'] } })]);
        assert.deepEqual(await fetchAccountWatchlist(fetchImpl), { items: [NVDA], dismissed: ['w-coin'] });
        assert.equal(calls[0].url, '/api/research/watchlist');
        assert.equal(calls[0].init.credentials, 'same-origin');
        assert.equal(calls[0].init.cache, 'no-store');
    });

    test('a refused request says why', async () => {
        const { fetchImpl } = recorder([Response.json({ error: 'dup', code: 'DUPLICATE_TICKER' }, { status: 409 })]);
        await assert.rejects(sendWatchWrite('w-nvda-a', { kind: 'put', item: NVDA }, ORDER, fetchImpl), (error: unknown) => {
            assert.ok(error instanceof AccountRequestError);
            assert.equal(error.status, 409);
            assert.equal(error.code, 'DUPLICATE_TICKER');
            return true;
        });
        const { fetchImpl: down } = recorder([new Response('<html>', { status: 502 })]);
        await assert.rejects(fetchAccountWatchlist(down), (error: unknown) => error instanceof AccountRequestError && error.code === null);
    });

    test('saves and removals are both a keepalive PUT, in order', async () => {
        const { calls, fetchImpl } = recorder([]);
        const removed = input('w-nvda-a', 'NVDA', { dismissed: true });
        await sendWatchWrite('w-brk.b-1', { kind: 'put', item: input('w-brk.b-1', 'BRK.B') }, ORDER, fetchImpl);
        await sendWatchWrite('w-nvda-a', { kind: 'put', item: removed }, { ...ORDER, seq: 4 }, fetchImpl);
        assert.deepEqual(calls.map((c) => [c.init.method, c.url, c.init.keepalive]), [
            ['PUT', '/api/research/watchlist/w-brk.b-1', true],
            ['PUT', '/api/research/watchlist/w-nvda-a', true],
        ]);
        assert.deepEqual(JSON.parse(String(calls[0].init.body)), { item: input('w-brk.b-1', 'BRK.B'), order: ORDER });
        assert.deepEqual(JSON.parse(String(calls[1].init.body)), { item: removed, order: { ...ORDER, seq: 4 } });
        assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json' });
    });

    test('imports everything that fits in one request at once', async () => {
        const { calls, fetchImpl } = recorder([]);
        const items = Array.from({ length: 250 }, (_, i) => input(`w-${i}`, 'NVDA'));
        await importAccountWatchlist(items, fetchImpl);
        assert.deepEqual(calls.map((c) => JSON.parse(String(c.init.body)).items.length), [250]);
        assert.ok(calls.every((c) => c.url === '/api/research/watchlist/import' && c.init.method === 'POST'));
        await importAccountWatchlist([], fetchImpl);
        assert.equal(calls.length, 1);
    });

    test('regression: each batch says where it starts, so the server keeps one order', async () => {
        // The Codex finding on PR #147: batches were ordered by when each
        // arrived, so later (older) items sorted first.
        const { calls, fetchImpl } = recorder([]);
        const items = Array.from({ length: 100 }, (_, i) => input(`w-${i}`, 'NVDA', { notes: '株'.repeat(5000) }));
        await importAccountWatchlist(items, fetchImpl, 1_761_220_000_000);
        const bodies = calls.map((c) => JSON.parse(String(c.init.body)) as { items: unknown[]; first: number; startedAt: number });
        assert.ok(bodies.length > 1);
        let next = 0;
        for (const body of bodies) {
            assert.equal(body.first, next);
            assert.equal(body.startedAt, 1_761_220_000_000);
            next += body.items.length;
        }
        assert.equal(next, 100);
    });

    test('regression: long non-ASCII notes are split into requests under the 1 MiB limit', async () => {
        // The Codex finding on PR #147: 100 rows of 5,000 CJK characters
        // came to about 1.5 MB in one request, refused every time.
        const { calls, fetchImpl } = recorder([]);
        const items = Array.from({ length: 100 }, (_, i) => input(`w-${i}`, 'NVDA', { notes: '株'.repeat(5000) }));
        await importAccountWatchlist(items, fetchImpl);
        assert.ok(calls.length > 1);
        for (const call of calls) assert.ok(new TextEncoder().encode(String(call.init.body)).length < 1024 * 1024);
        assert.equal(calls.reduce((n, c) => n + JSON.parse(String(c.init.body)).items.length, 0), 100);
    });
});

describe('importBrowserWatchlist', () => {
    function storageWith(key: string, items: unknown) {
        const map = new Map<string, string>([[key, JSON.stringify({ version: 1, items })]]);
        return {
            map,
            storage: {
                getItem: (k: string) => map.get(k) ?? null,
                setItem: (k: string, v: string) => void map.set(k, v),
                removeItem: (k: string) => void map.delete(k),
            },
        };
    }
    const nvda: WatchItem = { id: 'w-nvda-a', ticker: 'NVDA', companyName: '', reason: '', notes: '', targetEntry: null, addedAt: '2026-10-01' };

    test("sends this browser's list once, then removes the browser's copy", async () => {
        const key = 'atlas:research:watchlist:user-1';
        const { map, storage } = storageWith(key, [nvda, ...EXAMPLES]);
        const bodies: unknown[] = [];
        const fetchImpl = (async (_url: string, init: RequestInit) => {
            bodies.push(JSON.parse(String(init.body)));
            return new Response(null, { status: 204 });
        }) as unknown as typeof fetch;

        await Promise.all([
            importBrowserWatchlist(key, { storage, examples: EXAMPLES, now: NOW, fetchImpl }),
            importBrowserWatchlist(key, { storage, examples: EXAMPLES, now: NOW, fetchImpl }),
        ]);
        assert.equal(bodies.length, 1);
        assert.deepEqual((bodies[0] as { items: unknown }).items, [toWatchItemInput(nvda, { now: NOW })]);
        assert.equal(map.has(key), false);
        assert.equal(map.size, 0);
    });

    test('regression: text the account cut short stays in this browser, and the user is told once', async () => {
        // The Codex finding on PR #147: the browser copy was removed after
        // a shortened import, losing the rest of long notes.
        const key = 'atlas:research:watchlist:user-5';
        const long = { ...nvda, notes: 'n'.repeat(6000) };
        const { map, storage } = storageWith(key, [long, ...EXAMPLES]);
        const original = map.get(key);
        let told = 0;
        const fetchImpl = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;

        await importBrowserWatchlist(key, { storage, examples: EXAMPLES, now: NOW, fetchImpl, onShortened: () => { told += 1; } });
        await importBrowserWatchlist(key, { storage, examples: EXAMPLES, now: NOW, fetchImpl, onShortened: () => { told += 1; } });
        assert.equal(told, 1);
        assert.equal(map.has(key), false);
        assert.equal(map.get(watchlistFullCopyKey(key)), original);
        assert.equal(watchlistFullCopyKey(key), 'atlas:research:watchlist-full-copy:user-5');
    });

    test('keeps the copy when the send fails, and tries again next time', async () => {
        const key = 'atlas:research:watchlist:user-2';
        const { map, storage } = storageWith(key, []);
        let attempts = 0;
        const fetchImpl = (async () => {
            attempts += 1;
            return attempts === 1 ? Response.json({ code: 'WATCHLIST_IMPORT_FAILED' }, { status: 500 }) : new Response(null, { status: 204 });
        }) as unknown as typeof fetch;

        await assert.rejects(importBrowserWatchlist(key, { storage, examples: EXAMPLES, now: NOW, fetchImpl }));
        assert.equal(map.has(key), true);
        await importBrowserWatchlist(key, { storage, examples: EXAMPLES, now: NOW, fetchImpl });
        assert.equal(attempts, 2);
        assert.equal(map.has(key), false);
    });

    test('sends nothing when this browser kept no list', async () => {
        const fetchImpl = (async () => assert.fail('nothing to send')) as unknown as typeof fetch;
        await importBrowserWatchlist('atlas:research:watchlist:user-3', { storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, examples: EXAMPLES, now: NOW, fetchImpl });
        await importBrowserWatchlist('atlas:research:watchlist:user-4', { storage: null, examples: EXAMPLES, now: NOW, fetchImpl });
    });
});
