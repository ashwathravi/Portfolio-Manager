import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createRequestTimeout } from './fetch-limits';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createRequestTimeout', () => {
    test('aborts once the timeout passes', async () => {
        const timeout = createRequestTimeout(5);
        assert.equal(timeout.signal?.aborted, false);
        await pause(20);
        assert.equal(timeout.signal?.aborted, true);
    });

    test('cleared, it never aborts', async () => {
        const timeout = createRequestTimeout(5);
        timeout.clear();
        await pause(20);
        assert.equal(timeout.signal?.aborted, false);
    });

    test('aborts as soon as the stop signal does, before the timeout', () => {
        const stop = new AbortController();
        const timeout = createRequestTimeout(60_000, stop.signal);
        assert.equal(timeout.signal?.aborted, false);
        stop.abort();
        assert.equal(timeout.signal?.aborted, true);
        timeout.clear();
    });

    test('without a timeout, only the stop signal', () => {
        const stop = new AbortController();
        assert.equal(createRequestTimeout(0, stop.signal).signal, stop.signal);
        assert.equal(createRequestTimeout(0).signal, undefined);
    });
});
