
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
    webServer: {
        command: 'npm run dev',
        env: {
            ...webServerEnv,
            ...authServerEnv,
        },
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
