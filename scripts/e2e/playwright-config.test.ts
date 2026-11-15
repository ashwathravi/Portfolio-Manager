import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

// "E2E never touches real services" (AGENTS.md): every server Playwright
// starts gets an empty value for each setting that would reach one, even when
// the shell running the tests exports it (the servers inherit the shell's
// environment) or .env.local sets it (an empty value stops Next loading it).
const REAL_SERVICE_SETTINGS = [
    // The shared Redis.
    'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
    // Market data and SEC.
    'POLYGON_API_KEY', 'FINNHUB_API_KEY', 'SEC_EDGAR_USER_AGENT',
    // The scheduled jobs.
    'CRON_SECRET',
    // Email (launch item i58).
    'RESEND_API_KEY', 'EMAIL_FROM',
    // Plaid.
    'PLAID_CLIENT_ID', 'PLAID_SECRET',
    // Sentry.
    'NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN',
    // Models through AI Gateway: Ask (i59) and Alpha Radar's embeddings (i62).
    'ASK_MODEL', 'ALPHA_RADAR_EMBEDDING_MODEL', 'AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN',
] as const;

interface WebServer {
    command: string;
    url?: string;
    env?: Record<string, string>;
}

describe('playwright.config.ts', () => {
    const exported: Record<string, string | undefined> = {};
    let servers: WebServer[] = [];

    before(async () => {
        // As if the developer's shell had every one of them set.
        for (const name of REAL_SERVICE_SETTINGS) {
            exported[name] = process.env[name];
            process.env[name] = `from-the-shell-${name.toLowerCase()}`;
        }
        const config = (await import('../../playwright.config')).default;
        servers = ([] as WebServer[]).concat((config.webServer ?? []) as WebServer[]);
    });

    after(() => {
        for (const name of REAL_SERVICE_SETTINGS) {
            if (exported[name] === undefined) delete process.env[name];
            else process.env[name] = exported[name];
        }
    });

    test('starts the main server and the two outage servers', () => {
        assert.deepEqual(servers.map((server) => server.url), [
            'http://localhost:3000',
            'http://localhost:3100/api/health',
            'http://localhost:3200/api/health',
        ]);
    });

    test('blanks every setting that would reach a real service, the embedding model included, on every server', () => {
        for (const server of servers) {
            for (const name of REAL_SERVICE_SETTINGS) {
                assert.equal(server.env?.[name], '', `${name} on ${server.url}`);
            }
        }
    });
});
