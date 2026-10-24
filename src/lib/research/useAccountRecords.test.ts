import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { QueryClient, QueryObserver } from '@tanstack/react-query';

import { accountWriterFor } from './useAccountRecords';

type Stored = { items: string[] };
type Write = { kind: 'put'; item: string };

const flush = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function options(send: (id: string, write: Write) => Promise<void>, queryKey: readonly string[] = ['research', 'test']) {
    return {
        queryKey,
        send,
        apply: (stored: Stored | undefined, _id: string, write: Write): Stored => ({ items: [write.item, ...(stored?.items ?? [])] }),
        failedMessage: (write: Write) => `Couldn't save ${write.item}.`,
    };
}

describe('accountWriterFor', () => {
    test('one writer per query client and key, shared by every caller', () => {
        const client = new QueryClient();
        const send = async () => {};
        const writer = accountWriterFor<Stored, Write>(client, options(send));
        assert.equal(accountWriterFor<Stored, Write>(client, options(send)), writer);
        assert.notEqual(accountWriterFor<Stored, Write>(client, options(send, ['research', 'other'])), writer);
        assert.notEqual(accountWriterFor<Stored, Write>(new QueryClient(), options(send)), writer);
    });

    test("a saved write is applied to the query's data", async () => {
        const client = new QueryClient();
        client.setQueryData<Stored>(['research', 'saved'], { items: ['old'] });
        const writer = accountWriterFor<Stored, Write>(client, options(async () => {}, ['research', 'saved']));
        writer.write('a', { kind: 'put', item: 'new' });
        await flush();
        assert.deepEqual(client.getQueryData(['research', 'saved']), { items: ['new', 'old'] });
    });

    test('before anything has loaded, a saved write leaves the data to the first read', async () => {
        const client = new QueryClient();
        const writer = accountWriterFor<Stored, Write>(client, options(async () => {}, ['research', 'unloaded']));
        writer.write('a', { kind: 'put', item: 'new' });
        await flush();
        assert.equal(client.getQueryData(['research', 'unloaded']), undefined);
    });

    test('a write saved while a read is in flight reads again, since that read may not include it', async () => {
        const client = new QueryClient();
        const key = ['research', 'reading'];
        let reads = 0;
        const firstRead = deferred();
        const read = async (): Promise<Stored> => {
            reads += 1;
            if (reads === 1) await firstRead.promise;
            return { items: [`read ${reads}`] };
        };
        client.setQueryData<Stored>(key, { items: [] });
        // Watched, as by a component on the page, so invalidating reads again.
        const observer = new QueryObserver<Stored>(client, { queryKey: key, queryFn: read, staleTime: 0 });
        const unsubscribe = observer.subscribe(() => {});
        await flush();
        assert.equal(client.isFetching({ queryKey: key }), 1);

        const writer = accountWriterFor<Stored, Write>(client, options(async () => {}, key));
        writer.write('a', { kind: 'put', item: 'new' });
        await flush();
        firstRead.resolve();
        for (let i = 0; i < 5; i += 1) await flush();
        assert.equal(reads, 2);
        assert.deepEqual(client.getQueryData(key), { items: ['read 2'] });
        unsubscribe();
    });

    test('a failed write is reported and the data read again', async () => {
        const client = new QueryClient();
        const key = ['research', 'failed'];
        const messages: string[] = [];
        const writer = accountWriterFor<Stored, Write>(client, options(async () => { throw new Error('offline'); }, key), (message) => messages.push(message));
        client.setQueryData<Stored>(key, { items: ['kept'] });
        writer.write('a', { kind: 'put', item: 'lost' });
        await flush();
        assert.deepEqual(messages, ["Couldn't save lost."]);
        assert.equal(client.getQueryState(key)?.isInvalidated, true);
        assert.deepEqual(client.getQueryData(key), { items: ['kept'] });
    });
});
