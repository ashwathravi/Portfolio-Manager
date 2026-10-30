import { expect, test, type Page } from '@playwright/test';

// Launch item i72: the post-deploy smoke test. The deploy job runs it against
// the live site once it serves the new commit (playwright.production.config.ts);
// the E2E run also runs it against the local production build
// (playwright.config.ts), so it stays true to the app. Signed out and
// read-only: it never signs in, writes nothing and runs no job.

const SCHEDULED_JOBS = ['expired-sessions', 'ask-history', 'plaid', 'prices', 'snapshots', 'backup'];

function isLocal(baseURL: string | undefined): boolean {
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(baseURL ?? 'http://localhost').hostname);
}

/** Console errors, uncaught errors, CSP violations and failed requests to this site. */
function watchForProblems(page: Page, origin: string): string[] {
    const problems: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`page error: ${String(error)}`));
    page.on('response', (response) => {
        if (new URL(response.url()).origin === origin && response.status() >= 400) {
            problems.push(`HTTP ${response.status()} ${response.url()}`);
        }
    });
    page.on('requestfailed', (request) => {
        const failure = request.failure()?.errorText ?? 'failed';
        // A prefetch the page no longer needs is cancelled, not broken.
        if (new URL(request.url()).origin === origin && failure !== 'net::ERR_ABORTED') {
            problems.push(`${failure} ${request.url()}`);
        }
    });
    return problems;
}

test.describe('After a production deploy', () => {
    test('serves the commit just deployed', async ({ request }) => {
        const response = await request.get('/api/health');
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(body.status).toBe('ok');
        // The deploy job sets it; tests/production/wait-for-release.ts waited for it.
        const expected = process.env.EXPECTED_RELEASE?.trim();
        if (expected) expect(body.release).toBe(expected);
    });

    test('reaches its database', async ({ request }) => {
        const response = await request.get('/api/health/ready');
        expect(response.status()).toBe(200);
        expect(await response.json()).toMatchObject({ status: 'ok', database: 'ok' });
    });

    test('reads every scheduled job from its database', async ({ request }) => {
        // Whether the jobs ran on time is the production monitor's alert
        // (docs/monitoring.md), not a reason to fail a deploy: only that the
        // check works on this release.
        const response = await request.get('/api/health/jobs');
        expect([200, 503]).toContain(response.status());
        const body = await response.json();
        expect(body.database).toBe('ok');
        expect(body.status).toBe(response.status() === 200 ? 'ok' : 'degraded');
        expect(body.jobs.map((job: { job: string }) => job.job)).toEqual(SCHEDULED_JOBS);
        for (const job of body.jobs) expect(['ok', 'late', 'failed']).toContain(job.status);
    });

    test('sends a signed-out visitor to sign in, with sign-in configured', async ({ page }) => {
        await page.goto('/portfolios/holdings');

        await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fportfolios%2Fholdings$/);
        await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Continue with Google/ })).toBeEnabled();
        await expect(page.getByTestId('login-unavailable')).toHaveCount(0);
    });

    test('Continue with Google goes to Google with this site\'s callback', async ({ page, baseURL }) => {
        // Starting a sign-in makes the server ask Google for its endpoints,
        // and E2E never calls real services (AGENTS.md).
        test.skip(isLocal(baseURL), 'Only against a deployed site.');

        // Google's page is never loaded: the request that would open it is
        // answered here, so nothing reaches Google from the browser.
        let authorization: URL | undefined;
        await page.route('https://accounts.google.com/**', async (route) => {
            authorization ??= new URL(route.request().url());
            await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Google</title>' });
        });
        await page.goto('/login');
        await page.getByRole('button', { name: /Continue with Google/ }).click();

        await expect.poll(() => authorization?.hostname).toBe('accounts.google.com');
        const params = authorization!.searchParams;
        expect(params.get('client_id')).toMatch(/\.apps\.googleusercontent\.com$/);
        expect(params.get('redirect_uri')).toBe(new URL('/api/auth/callback/google', baseURL).href);
        expect(params.get('response_type')).toBe('code');
        expect(params.get('scope')).toBe('openid email profile');
        expect(params.get('code_challenge')).toBeTruthy();
    });

    for (const { path, heading } of [
        { path: '/login', heading: 'Sign in' },
        { path: '/privacy', heading: 'Privacy Policy' },
        { path: '/terms', heading: 'Terms of Service' },
    ]) {
        test(`${path} loads cleanly, with its security headers`, async ({ page, baseURL }) => {
            const problems = watchForProblems(page, new URL(baseURL!).origin);
            await page.addInitScript(() => {
                document.addEventListener('securitypolicyviolation', (event) => {
                    console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
                });
            });

            const response = await page.goto(path);
            expect(response?.status()).toBe(200);
            const headers = response!.headers();
            const policy = headers['content-security-policy'] ?? '';
            const scriptSrc = policy.split('; ').find((part) => part.startsWith('script-src ')) ?? '';
            expect(scriptSrc).toMatch(/'nonce-[^']+'/);
            expect(scriptSrc).toContain("'strict-dynamic'");
            expect(scriptSrc).not.toContain("'unsafe-inline'");
            expect(policy).toContain("frame-ancestors 'none'");
            expect(headers['strict-transport-security']).toMatch(/max-age=\d+/);
            expect(headers['x-frame-options']).toBe('DENY');
            expect(headers['x-content-type-options']).toBe('nosniff');

            await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
            // Hydrated (src/components/layout/AppFrame.tsx), so a hydration
            // error would have been logged. Not "network idle": a signed-out
            // prefetch of a link to / follows its redirect to /login, and the
            // router never reads that response, so the network never idles.
            await expect(page.locator('body')).toHaveAttribute('data-pm-hydrated-path', path);
            await page.waitForLoadState('load');
            expect(problems).toEqual([]);
        });
    }

    test('the sign-in page fits a phone', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/login');

        await expect(page.getByRole('button', { name: /Continue with Google/ })).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBe(0);
    });

    test('the API refuses signed-out callers', async ({ request }) => {
        // One answered by the proxy, one by a route that checks its session.
        for (const path of ['/api/settings', '/api/research/watchlist']) {
            const response = await request.get(path);
            expect(response.status(), path).toBe(401);
            expect(await response.json(), path).toMatchObject({ code: 'UNAUTHORIZED' });
        }

        // Without the cron secret the nightly jobs never run: 401, or 503
        // while CRON_SECRET isn't set.
        const cron = await request.get('/api/cron/daily');
        expect([401, 503]).toContain(cron.status());
    });
});
