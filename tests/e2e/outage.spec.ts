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

    const pages = [
        { path: '/', what: 'your portfolios', container: '.pm-dashboard-stack' },
        { path: '/portfolios/holdings', what: 'your holdings', container: '.pm-holdings-stack' },
        { path: '/portfolios/accounts', what: 'your accounts', container: '.pm-page' },
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
});

test.describe('Unusable DATABASE_URL', () => {
    test.use({ baseURL: 'http://localhost:3200' });

    test('readiness reports the database as not configured', async ({ request }) => {
        const response = await request.get('/api/health/ready');
        expect(response.status()).toBe(503);
        const body = await response.json();
        expect(body.database).toBe('not_configured');
    });

    const pages = [
        { path: '/', empty: (page: Page) => page.locator('[data-testid="today-hero"][data-empty="true"]') },
        { path: '/portfolios/holdings', empty: (page: Page) => page.getByTestId('holdings-empty') },
        { path: '/portfolios/accounts', empty: (page: Page) => page.getByTestId('accounts-empty') },
    ];

    for (const { path, empty } of pages) {
        test(`${path} shows its empty state, not the outage notice`, async ({ page }) => {
            await page.goto(path);

            await expect(empty(page)).toBeVisible();
            await expect(page.getByTestId('data-unavailable')).toHaveCount(0);
        });
    }
});
