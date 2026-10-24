
import { defineConfig, devices } from '@playwright/test';

const webServerEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);

export const E2E_USER_ID = '00000000-0000-4000-8000-00000000a001';
export const E2E_SESSION_TOKEN = 'e2e-session-user-a';
const databaseAuthEnabled = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');
// With database sessions (CI and test:e2e:local) the main server runs a
// production build, as Vercel serves it: `next build`, then `next start`.
// E2E_DEV_SERVER=1 uses `next dev` instead, for debugging. Without a database
// the app signs in through the local bypass, which production refuses, so
// that mode and the two outage servers always run `next dev`.
const productionBuild = databaseAuthEnabled && process.env.E2E_DEV_SERVER !== '1';
const PRODUCTION_DIST_DIR = '.next/e2e-production';
const authServerEnv: Record<string, string> = databaseAuthEnabled
    ? {
        AUTH_SECRET: process.env.E2E_AUTH_SECRET ?? 'e2e-only-auth-secret-change-outside-tests',
        AUTH_GOOGLE_ID: 'e2e-google-client-id',
        AUTH_GOOGLE_SECRET: 'e2e-google-client-secret',
        AUTH_LOCAL_DEV_BYPASS: '0',
        AUTH_LOCAL_DEV_USER_ID: '',
        // Production refuses sign-in without an invite list: the fixture users
        // and the fresh users some tests create (tests/e2e/helpers/users.ts).
        AUTH_ALLOWED_EMAILS: '',
        AUTH_ALLOWED_DOMAINS: 'example.test',
        // Off Vercel, production Auth.js only trusts a host it is told about.
        AUTH_URL: 'http://localhost:3000',
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

// The outage servers run `next dev` from an empty build directory every run.
// Playwright ends a run by SIGKILLing its servers, so a dev server never saves
// its Turbopack cache on the way out, while the chunks it wrote stay on disk
// (Next keeps them for a week). A later run that started from what a killed
// server left behind pushed hot updates to pages as they loaded, and the
// outage pages reloaded in the middle of their checks, some in a loop.
function freshDevServer(port: number, distDir: string): string {
    return `rm -rf ${distDir} && npm run dev -- --port ${port}`;
}

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
            command: productionBuild ? 'npm run build && npm run start' : 'npm run dev',
            env: {
                ...webServerEnv,
                ...authServerEnv,
                // The production build gets its own directory: building
                // cleans it, and the outage servers' dev builds sit next to it.
                ...(productionBuild ? { NEXT_DIST_DIR: PRODUCTION_DIST_DIR } : {}),
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
            // A production build takes a few minutes before the server starts.
            timeout: productionBuild ? 600_000 : 120_000,
        },
        {
            // "Database down" server for tests/e2e/outage.spec.ts: a database is
            // configured but unreachable (nothing listens on port 9). Local auth
            // bypass, because database sessions need the database. Its own build
            // directory, because Next allows one dev server per directory.
            command: freshDevServer(3100, '.next/e2e-outage'),
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
            command: freshDevServer(3200, '.next/e2e-placeholder'),
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
