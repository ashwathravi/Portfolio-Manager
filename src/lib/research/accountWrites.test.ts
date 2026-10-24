import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { AccountRequestError, accountRequest, batchBySize, createAccountWriter, flushAccountWrites, importInBatches, importOnce, sendRecordWrite } from './accountWrites';

type Write = { kind: 'put'; notes: string } | { kind: 'delete'; ticker: string };

const put = (notes: string): Write => ({ kind: 'put', notes });
const label = (write: Write) => (write.kind === 'put' ? write.notes : write.ticker);

describe('createAccountWriter', () => {
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
        const writer = createAccountWriter<Write>({ send: () => sent.promise, onSaved: (id) => saved.push(id), onFailed: () => assert.fail('no failure') });
        let changes = 0;
        writer.subscribe(() => { changes += 1; });
        const before = writer.pending();

        writer.write('w-nvda-a', put('a'));
        assert.notEqual(writer.pending(), before);
        assert.deepEqual([...writer.pending().keys()], ['w-nvda-a']);

        sent.resolve();
        await flush();
        assert.deepEqual(saved, ['w-nvda-a']);
        assert.equal(writer.pending().size, 0);
        assert.equal(changes, 2);
    });

    test("sends one item's writes one at a time, and only the latest of those waiting", async () => {
        const calls: { id: string; write: Write; done: ReturnType<typeof deferred> }[] = [];
        const saved: Write[] = [];
        const writer = createAccountWriter<Write>({
            send: (id, write) => {
                const done = deferred();
                calls.push({ id, write, done });
                return done.promise;
            },
            onSaved: (_id, write) => saved.push(write),
            onFailed: () => assert.fail('no failure'),
        });

        writer.write('w-nvda-a', put('1'));
        writer.write('w-nvda-a', put('2'));
        writer.write('w-nvda-a', put('3'));
        writer.write('w-amd-b', { kind: 'delete', ticker: 'AMD' });
        // Another item's write doesn't wait for this one.
        assert.deepEqual(calls.map((c) => c.id), ['w-nvda-a', 'w-amd-b']);

        calls[0].done.resolve();
        await flush();
        // The first save is out of date, so nothing is reported yet.
        assert.equal(saved.length, 0);
        assert.equal(calls.length, 3);
        assert.equal(label(calls[2].write), '3');
        assert.equal(writer.pending().get('w-nvda-a')?.kind, 'put');

        calls[2].done.resolve();
        calls[1].done.resolve();
        await flush();
        assert.deepEqual(saved.map((w) => label(w)), ['3', 'AMD']);
        assert.equal(writer.pending().size, 0);
    });

    test('a closing page sends the writes waiting behind one in flight, at once', async () => {
        const sent: string[] = [];
        const first = deferred();
        const writer = createAccountWriter<Write>({
            send: (_id, write) => {
                sent.push(label(write));
                return sent.length === 1 ? first.promise : Promise.resolve();
            },
            onSaved: () => {},
            onFailed: () => assert.fail('no failure'),
        });
        writer.write('w-nvda-a', put('target'));
        writer.write('w-nvda-a', put('target and notes'));
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

    test('regression: every write is numbered in the order it was made, so a late one loses', async () => {
        // The Codex finding on PR #147: the write sent on close could be
        // overtaken by the older one still in flight.
        const orders: { notes: string; session: string; seq: number }[] = [];
        const first = deferred();
        const writer = createAccountWriter<Write>({
            session: 'page-0001',
            send: (_id, write, order) => {
                orders.push({ notes: label(write), ...order });
                return orders.length === 1 ? first.promise : Promise.resolve();
            },
            onSaved: () => {},
            onFailed: () => assert.fail('no failure'),
        });
        assert.equal(writer.session, 'page-0001');
        writer.write('w-nvda-a', put('older'));
        writer.write('w-amd-b', put('other'));
        writer.write('w-nvda-a', put('newer'));
        writer.sendWaiting();
        first.resolve();
        await flush();

        assert.deepEqual(orders.map((o) => [o.notes, o.seq]), [['older', 1], ['other', 2], ['newer', 3], ['newer', 3]]);
        assert.ok(orders.every((o) => o.session === 'page-0001'));
    });

    test('idle resolves once every write has been sent, saved or not', async () => {
        const first = deferred();
        const second = deferred();
        const writer = createAccountWriter<Write>({
            send: (id) => (id === 'w-nvda-a' ? first.promise : second.promise),
            onSaved: () => {},
            onFailed: () => {},
        });
        await writer.idle();
        writer.write('w-nvda-a', put('nvda'));
        writer.write('w-amd-b', put('amd'));
        let idle = false;
        void writer.idle().then(() => { idle = true; });
        first.resolve();
        await flush();
        assert.equal(idle, false);
        second.reject(new Error('offline'));
        await flush();
        assert.equal(idle, true);
    });

    test("regression: sign-out waits for this page's research writes, for a while at most", async () => {
        // The Codex finding on PR #147: a write still queued at sign-out
        // was sent after the session had gone, and refused.
        const sent = deferred();
        const writer = createAccountWriter<Write>({ send: () => sent.promise, onSaved: () => {}, onFailed: () => {}, register: true });
        writer.write('w-nvda-a', put('nvda'));
        let flushed = false;
        const flushing = flushAccountWrites(1000).then(() => { flushed = true; });
        await flush();
        assert.equal(flushed, false);
        sent.resolve();
        await flushing;
        assert.equal(flushed, true);

        // A write that never finishes doesn't hold sign-out up.
        const slow = deferred();
        const stuck = createAccountWriter<Write>({ send: () => slow.promise, onSaved: () => {}, onFailed: () => {}, register: true });
        stuck.write('w-amd-b', put('amd'));
        const started = Date.now();
        await flushAccountWrites(50);
        assert.ok(Date.now() - started < 1000);
        // Done, so it doesn't hold up later flushes.
        slow.resolve();
        await stuck.idle();
    });

    test("regression: writers made on the server aren't kept for sign-out", async () => {
        // The Codex finding on PR #147: every server render made a writer,
        // and the sign-out registry kept each one (and its query client).
        assert.equal(typeof window, 'undefined');
        const neverDone = createAccountWriter<Write>({ send: () => new Promise<void>(() => {}), onSaved: () => {}, onFailed: () => {} });
        neverDone.write('w-nvda-a', put('nvda'));
        // Not registered, so the flush doesn't wait on it: it returns before its timeout.
        const started = Date.now();
        await flushAccountWrites(5_000);
        assert.ok(Date.now() - started < 1_000);
    });

    test('a failed write is dropped and reported; a newer one is still sent', async () => {
        const failures: unknown[] = [];
        const saved: string[] = [];
        let call = 0;
        const error = new Error('offline');
        const writer = createAccountWriter<Write>({
            send: async () => {
                call += 1;
                if (call !== 3) throw error;
            },
            onSaved: (id) => saved.push(id),
            onFailed: (_id, _write, err) => failures.push(err),
        });

        writer.write('w-nvda-a', put('a'));
        await flush();
        assert.deepEqual(failures, [error]);
        assert.equal(writer.pending().size, 0);

        // Failed, but superseded before it finished: only the newer one counts.
        writer.write('w-amd-b', put('b'));
        writer.write('w-amd-b', put('newer'));
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

    test('same-origin, uncached, JSON only when there is a body', async () => {
        const { calls, fetchImpl } = recorder([]);
        await accountRequest(fetchImpl, '/api/x');
        await accountRequest(fetchImpl, '/api/x', { method: 'POST', body: '{}' });
        assert.deepEqual(calls.map((c) => [c.init.credentials, c.init.cache, c.init.headers]), [
            ['same-origin', 'no-store', undefined],
            ['same-origin', 'no-store', { 'Content-Type': 'application/json' }],
        ]);
    });

    test("a refused request carries the API's code, or none", async () => {
        const { fetchImpl } = recorder([
            Response.json({ error: 'dup', code: 'DUPLICATE_TICKER' }, { status: 409 }),
            new Response('<html>', { status: 502 }),
        ]);
        await assert.rejects(accountRequest(fetchImpl, '/api/x'), (error: unknown) =>
            error instanceof AccountRequestError && error.status === 409 && error.code === 'DUPLICATE_TICKER');
        await assert.rejects(accountRequest(fetchImpl, '/api/x'), (error: unknown) =>
            error instanceof AccountRequestError && error.status === 502 && error.code === null);
    });

    test('a record is saved with a keepalive PUT, in order', async () => {
        const { calls, fetchImpl } = recorder([]);
        const order = { session: 'page-0001', seq: 2 };
        await sendRecordWrite(fetchImpl, '/api/x/1', { kind: 'put', body: { item: { a: 1 } } }, order);
        assert.deepEqual(calls.map((c) => [c.init.method, c.init.keepalive, JSON.parse(String(c.init.body))]), [
            ['PUT', true, { item: { a: 1 }, order }],
        ]);
    });

    test('a body too big for keepalive is sent as a normal request', async () => {
        const { calls, fetchImpl } = recorder([]);
        const order = { session: 'page-0001', seq: 2 };
        await sendRecordWrite(fetchImpl, '/api/x/1', { kind: 'put', body: { item: { text: 'x'.repeat(61 * 1024) } } }, order);
        await sendRecordWrite(fetchImpl, '/api/x/1', { kind: 'put', body: { item: { text: 'x'.repeat(59 * 1024) } } }, order);
        assert.deepEqual(calls.map((c) => c.init.keepalive), [false, true]);
    });

    test('imports go in batches of at most the route\'s count', async () => {
        const { calls, fetchImpl } = recorder([]);
        await importInBatches(fetchImpl, '/api/x/import', Array.from({ length: 250 }, (_, i) => i), 100);
        assert.deepEqual(calls.map((c) => JSON.parse(String(c.init.body)).items.length), [100, 100, 50]);
        assert.ok(calls.every((c) => c.url === '/api/x/import' && c.init.method === 'POST'));
        await importInBatches(fetchImpl, '/api/x/import', [], 100);
        assert.equal(calls.length, 3);
    });
});

describe('importOnce', () => {
    test('runs once per key while it is running or has succeeded', async () => {
        let runs = 0;
        const send = async () => { runs += 1; };
        await Promise.all([importOnce('k-1', send), importOnce('k-1', send)]);
        await importOnce('k-1', send);
        assert.equal(runs, 1);
        await importOnce('k-2', send);
        assert.equal(runs, 2);
    });

    test('a failure lets the next call try again', async () => {
        let runs = 0;
        const send = async () => {
            runs += 1;
            if (runs === 1) throw new Error('offline');
        };
        await assert.rejects(importOnce('k-3', send));
        await importOnce('k-3', send);
        assert.equal(runs, 2);
    });
});

describe('batchBySize', () => {
    test('keeps each batch under the byte and count limits, in order', () => {
        const items = Array.from({ length: 10 }, (_, i) => ({ i, text: 'x'.repeat(100) }));
        const batches = batchBySize(items, { maxBytes: 400, maxCount: 100 });
        assert.deepEqual(batches.flat(), items);
        for (const batch of batches) assert.ok(new TextEncoder().encode(JSON.stringify({ items: batch })).length <= 400);
        assert.deepEqual(batchBySize(items, { maxBytes: 1e6, maxCount: 4 }).map((b) => b.length), [4, 4, 2]);
    });

    test('counts UTF-8 bytes and JSON escapes, not characters', () => {
        const wide = { text: '株'.repeat(100) }; // 300 bytes in UTF-8
        const escaped = { text: '\u0001'.repeat(100) }; // 600 bytes once escaped
        assert.deepEqual(batchBySize([wide, wide], { maxBytes: 500, maxCount: 10 }).map((b) => b.length), [1, 1]);
        assert.deepEqual(batchBySize([escaped, escaped], { maxBytes: 1000, maxCount: 10 }).map((b) => b.length), [1, 1]);
    });

    test('an item too big on its own goes alone; nothing is dropped', () => {
        const big = { text: 'x'.repeat(1000) };
        const small = { text: 'y' };
        assert.deepEqual(batchBySize([small, big, small], { maxBytes: 100, maxCount: 10 }), [[small], [big], [small]]);
        assert.deepEqual(batchBySize([], { maxBytes: 100, maxCount: 10 }), []);
    });
});
