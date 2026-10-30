import { test, expect, type Page } from '@playwright/test';

/**
 * Database outage. The first block runs against the second Playwright web
 * server (port 3100), whose DATABASE_URL points at a closed port: the
 * database is configured but unreachable. An outage must never read as "you
 * have no accounts".
 *
 * The second block runs against the third server (port 3200), whose
 * DATABASE_URL holds Vercel's "[SENSITIVE]" placeholder: no usable database
 * is configured. That must read as "no database" (empty states, readiness
 * not_configured), not as an outage.
 */
test.describe('Database outage', () => {
    test.use({ baseURL: 'http://localhost:3100' });

    test('readiness reports the database as unavailable', async ({ request }) => {
        const response = await request.get('/api/health/ready');
        expect(response.status()).toBe(503);
        const body = await response.json();
        expect(body.status).toBe('degraded');
        expect(body.database).toBe('unavailable');
        expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|password/i);

        const liveness = await request.get('/api/health');
        expect(liveness.status()).toBe(200);
    });

    test('job health reports the database as unavailable, not every job as late', async ({ request }) => {
        const response = await request.get('/api/health/jobs');
        expect(response.status()).toBe(503);
        const body = await response.json();
        expect(body).toMatchObject({ status: 'degraded', database: 'unavailable', jobs: [] });
        expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|password/i);
    });

    const pages = [
        { path: '/', what: 'your portfolios', container: '.pm-dashboard-stack' },
        { path: '/portfolios/holdings', what: 'your holdings', container: '.pm-holdings-stack' },
        { path: '/portfolios/accounts', what: 'your accounts', container: '.pm-page' },
        { path: '/performance', what: 'your return history', container: '.pm-perf-stack' },
        { path: '/performance/behaviour', what: 'your trades', container: '.pm-perf-stack' },
        { path: '/execution', what: 'your accounts and orders', container: '.pm-exec-page' },
    ];

    for (const { path, what, container } of pages) {
        test(`${path} shows the outage notice instead of an empty portfolio`, async ({ page }) => {
            await page.goto(path);

            const notice = page.getByTestId('data-unavailable');
            await expect(notice).toBeVisible();
            await expect(notice).toContainText(`We couldn't load ${what}.`);
            await expect(notice).toHaveAttribute('role', 'alert');
            // Inside the page container, so it keeps the page gutter.
            await expect(page.locator(`${container} [data-testid="data-unavailable"]`)).toHaveCount(1);

            // None of the empty states that would claim there is no data.
            await expect(page.getByText('Connect an account', { exact: false })).toHaveCount(0);
            await expect(page.getByTestId('accounts-empty')).toHaveCount(0);
        });
    }

    test('Trade shows no ticket: no order can be checked or saved, and the user has accounts', async ({ page }) => {
        // Launch items i53/i54: a failed load is not an empty portfolio that
        // passes every check, nor a user without accounts.
        await page.goto('/execution');
        await expect(page.getByTestId('data-unavailable')).toBeVisible();
        await expect(page.locator('.pm-exec-form')).toHaveCount(0);
        await expect(page.getByTestId('trade-needs-account')).toHaveCount(0);
    });

    test('the Settings risk previews say the holdings couldn\'t be loaded', async ({ page }) => {
        await page.goto('/settings');
        await expect(page.getByTestId('bucket-holdings-unavailable')).toBeVisible();
        await expect(page.getByTestId('bucket-holdings-empty')).toHaveCount(0);
    });

    test('the notice still comes promptly after many failed reads', async ({ page, request }) => {
        // Every render tries the database and fails. The pool used to wait
        // longer before each new connect (up to 20 s), so an outage page got
        // slower with every request until it timed out.
        for (let render = 0; render < 4; render++) {
            expect((await request.get('/portfolios/holdings')).ok()).toBe(true);
        }

        await page.goto('/portfolios/holdings');
        await expect(page.getByTestId('data-unavailable')).toBeVisible();
    });
});

test.describe('Unusable DATABASE_URL', () => {
    test.use({ baseURL: 'http://localhost:3200' });

    test('readiness reports the database as not configured', async ({ request }) => {
        const response = await request.get('/api/health/ready');
        expect(response.status()).toBe(503);
        const body = await response.json();
        expect(body.database).toBe('not_configured');

        const jobs = await request.get('/api/health/jobs');
        expect(jobs.status()).toBe(503);
        expect(await jobs.json()).toMatchObject({ status: 'degraded', database: 'not_configured', jobs: [] });
    });

    const pages = [
        { path: '/', empty: (page: Page) => page.locator('[data-testid="today-hero"][data-empty="true"]') },
        { path: '/portfolios/holdings', empty: (page: Page) => page.getByTestId('holdings-empty') },
        { path: '/portfolios/accounts', empty: (page: Page) => page.getByTestId('accounts-empty') },
        // No history without a database: the labelled example series.
        { path: '/performance', empty: (page: Page) => page.getByTestId('sample-data-notice') },
        // No closed trades: the labelled example journal.
        { path: '/performance/behaviour', empty: (page: Page) => page.getByTestId('sample-data-notice') },
        // No accounts to draft an order for.
        { path: '/execution', empty: (page: Page) => page.getByTestId('trade-needs-account') },
    ];

    for (const { path, empty } of pages) {
        test(`${path} shows its empty state, not the outage notice`, async ({ page }) => {
            await page.goto(path);

            await expect(empty(page)).toBeVisible();
            await expect(page.getByTestId('data-unavailable')).toHaveCount(0);
        });
    }
});
