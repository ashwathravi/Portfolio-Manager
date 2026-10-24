import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { WatchItemInput } from '@/lib/validators/watchlist';

import { seedWatchlist, type WatchItem } from './watchlist';
import {
    WatchlistRequestError,
    applyWatchWrite,
    createWatchlistWriter,
    fetchAccountWatchlist,
    importAccountWatchlist,
    importBrowserWatchlist,
    mergeAccountWatchlist,
    sendWatchWrite,
    toWatchItemInput,
    watchlistImportItems,
    type AccountWatchlist,
    type WatchWrite,
} from './watchlistAccount';

const NOW = Date.parse('2026-10-23T15:00:00Z');
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
            ['w-nvda-a', { kind: 'delete', ticker: 'NVDA' }],
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

    test('a delete removes the row; a dismissal moves it to dismissed; a save un-dismisses', () => {
        assert.deepEqual(applyWatchWrite(stored, 'w-amd-b', { kind: 'delete', ticker: 'AMD' }), { items: [NVDA], dismissed: ['w-coin'] });
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
        const items = watchlistImportItems(local, EXAMPLES, NOW);
        assert.deepEqual(items.map((i) => [i.id, i.dismissed]), [['w-nvda-a', false], ['w-coin', false], ['w-shop', true]]);
        assert.equal(items[1].notes, 'adopted');
    });

    test('an emptied list dismisses every example; an untouched one sends nothing', () => {
        assert.deepEqual(watchlistImportItems([], EXAMPLES, NOW).map((i) => i.id), ['w-coin', 'w-pltr', 'w-shop']);
        assert.deepEqual(watchlistImportItems(EXAMPLES, EXAMPLES, NOW), []);
    });

    test('skips repeated ids and rows the API would refuse', () => {
        const nvda: WatchItem = { id: 'w-nvda-a', ticker: 'NVDA', companyName: '', reason: '', notes: '', targetEntry: null, addedAt: '2026-10-01' };
        const items = watchlistImportItems([nvda, { ...nvda, notes: 'again' }, { ...nvda, id: 'BAD ID', ticker: 'AMD' }, ...EXAMPLES], EXAMPLES, NOW);
        assert.deepEqual(items.map((i) => i.id), ['w-nvda-a']);
        assert.equal(items[0].notes, '');
    });
});

describe('createWatchlistWriter', () => {
    function deferred() {
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
    }
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    test('shows a write as pending until it is saved', async () => {
        const sent = deferred();
        const saved: string[] = [];
        const writer = createWatchlistWriter({ send: () => sent.promise, onSaved: (id) => saved.push(id), onFailed: () => assert.fail('no failure') });
        let changes = 0;
        writer.subscribe(() => { changes += 1; });
        const before = writer.pending();

        writer.write('w-nvda-a', { kind: 'put', item: NVDA });
        assert.notEqual(writer.pending(), before);
        assert.deepEqual([...writer.pending().keys()], ['w-nvda-a']);

        sent.resolve();
        await flush();
        assert.deepEqual(saved, ['w-nvda-a']);
        assert.equal(writer.pending().size, 0);
        assert.equal(changes, 2);
    });

    test("sends one item's writes one at a time, and only the latest of those waiting", async () => {
        const calls: { id: string; write: WatchWrite; done: ReturnType<typeof deferred> }[] = [];
        const saved: WatchWrite[] = [];
        const writer = createWatchlistWriter({
            send: (id, write) => {
                const done = deferred();
                calls.push({ id, write, done });
                return done.promise;
            },
            onSaved: (_id, write) => saved.push(write),
            onFailed: () => assert.fail('no failure'),
        });

        writer.write('w-nvda-a', { kind: 'put', item: { ...NVDA, notes: '1' } });
        writer.write('w-nvda-a', { kind: 'put', item: { ...NVDA, notes: '2' } });
        writer.write('w-nvda-a', { kind: 'put', item: { ...NVDA, notes: '3' } });
        writer.write('w-amd-b', { kind: 'delete', ticker: 'AMD' });
        // Another item's write doesn't wait for this one.
        assert.deepEqual(calls.map((c) => c.id), ['w-nvda-a', 'w-amd-b']);

        calls[0].done.resolve();
        await flush();
        // The first save is out of date, so nothing is reported yet.
        assert.equal(saved.length, 0);
        assert.equal(calls.length, 3);
        assert.equal(calls[2].write.kind === 'put' && calls[2].write.item.notes, '3');
        assert.equal(writer.pending().get('w-nvda-a')?.kind, 'put');

        calls[2].done.resolve();
        calls[1].done.resolve();
        await flush();
        assert.deepEqual(saved.map((w) => (w.kind === 'put' ? w.item.notes : w.ticker)), ['3', 'AMD']);
        assert.equal(writer.pending().size, 0);
    });

    test('a closing page sends the writes waiting behind one in flight, at once', async () => {
        const sent: string[] = [];
        const first = deferred();
        const writer = createWatchlistWriter({
            send: (_id, write) => {
                sent.push(write.kind === 'put' ? write.item.notes : write.ticker);
                return sent.length === 1 ? first.promise : Promise.resolve();
            },
            onSaved: () => {},
            onFailed: () => assert.fail('no failure'),
        });
        writer.write('w-nvda-a', { kind: 'put', item: { ...NVDA, notes: 'target' } });
        writer.write('w-nvda-a', { kind: 'put', item: { ...NVDA, notes: 'target and notes' } });
        writer.write('w-amd-b', { kind: 'delete', ticker: 'AMD' });
        await flush();
        assert.deepEqual(sent, ['target', 'AMD']);

        writer.sendWaiting();
        // Only the write that was waiting; the delete was already sent.
        assert.deepEqual(sent, ['target', 'AMD', 'target and notes']);
        first.resolve();
        await flush();
        assert.equal(writer.pending().size, 0);
    });

    test('a failed write is dropped and reported; a newer one is still sent', async () => {
        const failures: unknown[] = [];
        const saved: string[] = [];
        let call = 0;
        const error = new Error('offline');
        const writer = createWatchlistWriter({
            send: async () => {
                call += 1;
                if (call !== 3) throw error;
            },
            onSaved: (id) => saved.push(id),
            onFailed: (_id, _write, err) => failures.push(err),
        });

        writer.write('w-nvda-a', { kind: 'put', item: NVDA });
        await flush();
        assert.deepEqual(failures, [error]);
        assert.equal(writer.pending().size, 0);

        // Failed, but superseded before it finished: only the newer one counts.
        writer.write('w-amd-b', { kind: 'put', item: AMD });
        writer.write('w-amd-b', { kind: 'put', item: { ...AMD, notes: 'newer' } });
        await flush();
        assert.deepEqual(saved, ['w-amd-b']);
        assert.deepEqual(failures, [error]);
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
        await assert.rejects(sendWatchWrite('w-nvda-a', { kind: 'put', item: NVDA }, fetchImpl), (error: unknown) => {
            assert.ok(error instanceof WatchlistRequestError);
            assert.equal(error.status, 409);
            assert.equal(error.code, 'DUPLICATE_TICKER');
            return true;
        });
        const { fetchImpl: down } = recorder([new Response('<html>', { status: 502 })]);
        await assert.rejects(fetchAccountWatchlist(down), (error: unknown) => error instanceof WatchlistRequestError && error.code === null);
    });

    test('saves with PUT and deletes with DELETE, both keepalive', async () => {
        const { calls, fetchImpl } = recorder([]);
        await sendWatchWrite('w-brk.b-1', { kind: 'put', item: input('w-brk.b-1', 'BRK.B') }, fetchImpl);
        await sendWatchWrite('w-nvda-a', { kind: 'delete', ticker: 'NVDA' }, fetchImpl);
        assert.deepEqual(calls.map((c) => [c.init.method, c.url, c.init.keepalive]), [
            ['PUT', '/api/research/watchlist/w-brk.b-1', true],
            ['DELETE', '/api/research/watchlist/w-nvda-a', true],
        ]);
        assert.deepEqual(JSON.parse(String(calls[0].init.body)), input('w-brk.b-1', 'BRK.B'));
        assert.deepEqual(calls[0].init.headers, { 'Content-Type': 'application/json' });
        assert.equal(calls[1].init.body, undefined);
    });

    test('imports in batches of 100', async () => {
        const { calls, fetchImpl } = recorder([]);
        const items = Array.from({ length: 250 }, (_, i) => input(`w-${i}`, 'NVDA'));
        await importAccountWatchlist(items, fetchImpl);
        assert.deepEqual(calls.map((c) => JSON.parse(String(c.init.body)).items.length), [100, 100, 50]);
        assert.ok(calls.every((c) => c.url === '/api/research/watchlist/import' && c.init.method === 'POST'));
        await importAccountWatchlist([], fetchImpl);
        assert.equal(calls.length, 3);
    });
});

describe('importBrowserWatchlist', () => {
    function storageWith(key: string, items: unknown) {
        const map = new Map<string, string>([[key, JSON.stringify({ version: 1, items })]]);
        return { map, storage: { getItem: (k: string) => map.get(k) ?? null, removeItem: (k: string) => void map.delete(k) } };
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
        assert.deepEqual(bodies, [{ items: [toWatchItemInput(nvda, { now: NOW })] }]);
        assert.equal(map.has(key), false);
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
        await importBrowserWatchlist('atlas:research:watchlist:user-3', { storage: { getItem: () => null, removeItem: () => {} }, examples: EXAMPLES, now: NOW, fetchImpl });
        await importBrowserWatchlist('atlas:research:watchlist:user-4', { storage: null, examples: EXAMPLES, now: NOW, fetchImpl });
    });
});
