import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readJsonBody } from './body';

function chunked(parts: string[]): Request {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const p of parts) controller.enqueue(enc.encode(p));
            controller.close();
        },
    });
    return new Request('http://x/api', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
}

describe('readJsonBody', () => {
    test('parses a body within the limit', async () => {
        const r = await readJsonBody(new Request('http://x', { method: 'POST', body: '{"a":1}' }), 100);
        assert.deepStrictEqual(r, { ok: true, value: { a: 1 } });
    });

    test('rejects a declared Content-Length over the limit without reading', async () => {
        const req = new Request('http://x', { method: 'POST', body: '{}', headers: { 'content-length': '5000' } });
        assert.deepStrictEqual(await readJsonBody(req, 100), { ok: false, reason: 'too-large' });
    });

    test('regression: a chunked body with no Content-Length is still capped', async () => {
        const req = chunked(['{"rows":[', '"x"'.repeat(50), ']}']);
        assert.strictEqual(req.headers.get('content-length'), null);
        assert.deepStrictEqual(await readJsonBody(req, 64), { ok: false, reason: 'too-large' });
    });

    test('a chunked body within the limit is reassembled', async () => {
        assert.deepStrictEqual(await readJsonBody(chunked(['{"a"', ':', '[1,2]}']), 64), { ok: true, value: { a: [1, 2] } });
    });

    test('malformed or missing bodies are invalid JSON', async () => {
        assert.deepStrictEqual(await readJsonBody(new Request('http://x', { method: 'POST', body: '{oops' }), 100), { ok: false, reason: 'invalid-json' });
        assert.deepStrictEqual(await readJsonBody(new Request('http://x', { method: 'POST' }), 100), { ok: false, reason: 'invalid-json' });
    });
});
