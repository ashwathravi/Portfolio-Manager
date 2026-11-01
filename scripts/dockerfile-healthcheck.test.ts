import { test } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// The Dockerfile's HEALTHCHECK, run the way Docker runs it, against a stub
// server instead of the app on port 3000. Docker counts a probe that takes
// longer than its --timeout as a failure.
const dockerfile = readFileSync('Dockerfile', 'utf8');
const healthcheck = /^HEALTHCHECK\s+(.*?)\s*\\\n\s*CMD\s+(.+)$/m.exec(dockerfile);
const timeoutSeconds = Number(/--timeout=(\d+)s/.exec(healthcheck?.[1] ?? '')?.[1]);
const command = healthcheck?.[2] ?? '';

/** Runs the probe without blocking this process, which serves the stub. */
function probe(baseUrl: string): Promise<{ status: number | null; ms: number }> {
    const started = Date.now();
    const child = spawn('sh', ['-c', command.replaceAll('http://localhost:3000', baseUrl)], { stdio: 'ignore' });
    const killer = setTimeout(() => child.kill('SIGKILL'), timeoutSeconds * 1000 + 2_000);
    return new Promise((resolve) => {
        child.on('exit', (status) => {
            clearTimeout(killer);
            resolve({ status, ms: Date.now() - started });
        });
    });
}

async function serve(status: number): Promise<{ server: Server; url: string }> {
    const server = createServer((request, response) => {
        response.writeHead(request.url === '/api/health' ? status : 404, { 'content-type': 'application/json' });
        response.end('{"status":"ok"}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

test('Dockerfile HEALTHCHECK - asks /api/health with a timeout', () => {
    assert.ok(healthcheck, 'no HEALTHCHECK');
    assert.ok(timeoutSeconds > 0, 'no --timeout');
    assert.match(command, /http:\/\/localhost:3000\/api\/health\b/);
});

test('Dockerfile HEALTHCHECK - regression: passes promptly when the app answers 200', async () => {
    // It used to wait on the open response until Docker's timeout, so every
    // container from the image reported unhealthy.
    const { server, url } = await serve(200);
    try {
        const { status, ms } = await probe(url);
        assert.strictEqual(status, 0);
        assert.ok(ms < timeoutSeconds * 1000, `took ${ms}ms, over the ${timeoutSeconds}s timeout`);
    } finally {
        server.close();
    }
});

test('Dockerfile HEALTHCHECK - fails when the app answers an error', async () => {
    const { server, url } = await serve(503);
    try {
        const { status, ms } = await probe(url);
        assert.notStrictEqual(status, 0);
        assert.ok(ms < timeoutSeconds * 1000, `took ${ms}ms`);
    } finally {
        server.close();
    }
});

test('Dockerfile HEALTHCHECK - fails when nothing answers', async () => {
    const { server, url } = await serve(200);
    await new Promise((resolve) => server.close(resolve));
    const { status, ms } = await probe(url);
    assert.notStrictEqual(status, 0);
    assert.ok(ms < timeoutSeconds * 1000, `took ${ms}ms`);
});
