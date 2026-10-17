import { test, expect } from '@playwright/test';

/**
 * Database outage. These run against the second Playwright web server (port
 * 3100), whose DATABASE_URL points at a closed port: the database is
 * configured but unreachable. An outage must never read as "you have no
 * accounts".
 */
test.use({ baseURL: 'http://localhost:3100' });

test.describe('Database outage', () => {
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
