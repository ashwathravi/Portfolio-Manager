
import { defineConfig, devices } from '@playwright/test';

const webServerEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);

export const E2E_USER_ID = '00000000-0000-4000-8000-00000000a001';
export const E2E_SESSION_TOKEN = 'e2e-session-user-a';
const databaseAuthEnabled = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');
const authServerEnv = databaseAuthEnabled
    ? {
        AUTH_SECRET: process.env.E2E_AUTH_SECRET ?? 'e2e-only-auth-secret-change-outside-tests',
        AUTH_GOOGLE_ID: 'e2e-google-client-id',
        AUTH_GOOGLE_SECRET: 'e2e-google-client-secret',
        AUTH_LOCAL_DEV_BYPASS: '0',
        AUTH_LOCAL_DEV_USER_ID: '',
    }
    : {
        AUTH_SECRET: '',
        AUTH_GOOGLE_ID: '',
        AUTH_GOOGLE_SECRET: '',
        AUTH_LOCAL_DEV_BYPASS: '1',
        AUTH_LOCAL_DEV_USER_ID: E2E_USER_ID,
    };

// E2E always uses the in-memory rate limiter: empty values stop Next from
// loading Upstash credentials out of .env.local, so test runs never spend
// (or trip over) a shared Redis budget.
const noSharedRedis = {
    KV_REST_API_URL: '',
    KV_REST_API_TOKEN: '',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
};

// No market-data key either, so test runs never spend the free plan's 5 calls
// a minute and always see the not-configured state: stored prices on pages,
// 503 from /api/market-data (tests stub those routes where they need quotes).
const noMarketData = {
    POLYGON_API_KEY: '',
};

// No cron secret, so /api/cron/* always refuses (503) and a test run never
// runs the scheduled jobs, whatever .env.local holds.
const noCronSecret = {
    CRON_SECRET: '',
};

// No Sentry DSN, so the SDK never starts and a test run's errors never reach
// the production project (and no build uploads source maps).
const noSentry = {
    NEXT_PUBLIC_SENTRY_DSN: '',
    SENTRY_AUTH_TOKEN: '',
};

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI
        ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
        : 'html',
    use: {
        baseURL: 'http://localhost:3000',
        trace: 'on-first-retry',
        ...(databaseAuthEnabled
            ? {
                storageState: {
                    cookies: [{
                        name: 'authjs.session-token',
                        value: E2E_SESSION_TOKEN,
                        domain: 'localhost',
                        path: '/',
                        expires: -1,
                        httpOnly: true,
                        secure: false,
                        sameSite: 'Lax' as const,
                    }],
                    origins: [],
                },
            }
            : {}),
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: [
        {
            command: 'npm run dev',
            env: {
                ...webServerEnv,
                ...authServerEnv,
                // Only use a database the test run was explicitly given (CI exports
                // one). An empty value stops Next from loading a developer's real
                // DATABASE_URL out of .env.local into the test server.
                DATABASE_URL: process.env.DATABASE_URL ?? '',
                ...noSharedRedis,
                ...noMarketData,
                ...noCronSecret,
                ...noSentry,
            },
            url: 'http://localhost:3000',
            // Never reuse a running server: it may be connected to a real
            // database or the shared Redis. A busy port fails the run instead.
            reuseExistingServer: false,
            timeout: 120_000,
        },
        {
            // "Database down" server for tests/e2e/outage.spec.ts: a database is
            // configured but unreachable (nothing listens on port 9). Local auth
            // bypass, because database sessions need the database. Its own build
            // directory, because Next allows one dev server per directory.
            command: 'npm run dev -- --port 3100',
            env: {
                ...webServerEnv,
                NEXT_DIST_DIR: '.next/e2e-outage',
                DATABASE_URL: 'postgres://outage:outage@127.0.0.1:9/atlas_wealth_outage?sslmode=disable',
                AUTH_SECRET: '',
                AUTH_GOOGLE_ID: '',
                AUTH_GOOGLE_SECRET: '',
                AUTH_LOCAL_DEV_BYPASS: '1',
                AUTH_LOCAL_DEV_USER_ID: E2E_USER_ID,
                ...noSharedRedis,
                ...noMarketData,
                ...noCronSecret,
                ...noSentry,
            },
            url: 'http://localhost:3100/api/health',
            // Never reuse a running server: it may be connected to a real
            // database or the shared Redis. A busy port fails the run instead.
            reuseExistingServer: false,
            timeout: 120_000,
        },
        {
            // "Unusable database URL" server for the second half of
            // outage.spec.ts: DATABASE_URL holds Vercel's "[SENSITIVE]"
            // placeholder, as a build or runtime that never received the real
            // value would. That must read as "no database", not as an outage.
            command: 'npm run dev -- --port 3200',
            env: {
                ...webServerEnv,
                NEXT_DIST_DIR: '.next/e2e-placeholder',
                DATABASE_URL: '[SENSITIVE]',
                AUTH_SECRET: '',
                AUTH_GOOGLE_ID: '',
                AUTH_GOOGLE_SECRET: '',
                AUTH_LOCAL_DEV_BYPASS: '1',
                AUTH_LOCAL_DEV_USER_ID: E2E_USER_ID,
                ...noSharedRedis,
                ...noMarketData,
                ...noCronSecret,
                ...noSentry,
            },
            url: 'http://localhost:3200/api/health',
            // Never reuse a running server: it may be connected to a real
            // database or the shared Redis. A busy port fails the run instead.
            reuseExistingServer: false,
            timeout: 120_000,
        },
    ],
});
