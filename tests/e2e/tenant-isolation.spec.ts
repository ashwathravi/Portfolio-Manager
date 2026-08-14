import { expect, test } from '@playwright/test';

const OTHER_USER_PORTFOLIO_ID = '00000000-0000-4000-8000-000000000009';
const PRIMARY_USER_PORTFOLIO_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_SESSION_TOKEN = 'e2e-session-user-b';
const databaseAuthEnabled = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');

test.describe('Portfolio tenant isolation', () => {
    test.skip(!databaseAuthEnabled, 'requires the database-auth E2E mode');

    test('shows only the authenticated fixture user holdings and count', async ({ page }) => {
        await page.goto('/portfolios/holdings');
        await page.waitForLoadState('networkidle');

        await expect(page.getByText('AAPL', { exact: true }).first()).toBeVisible();
        await expect(page.getByText('XUSR', { exact: true })).toHaveCount(0);

        const countResponse = await page.request.get('/api/portfolios/count');
        expect(countResponse.status()).toBe(200);
        expect(await countResponse.json()).toEqual({ count: 3 });
    });

    test('returns 404 for another user portfolio valuation', async ({ page }) => {
        const response = await page.request.get(`/api/portfolio/${OTHER_USER_PORTFOLIO_ID}/value`);

        expect(response.status()).toBe(404);
        expect(await response.json()).toEqual({
            error: 'Portfolio not found',
            code: 'PORTFOLIO_NOT_FOUND',
        });
    });

    test('maps a second verified session to only the second user portfolio graph', async ({ context, page }) => {
        await context.clearCookies();
        await context.addCookies([{
            name: 'authjs.session-token',
            value: OTHER_USER_SESSION_TOKEN,
            domain: 'localhost',
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
        }]);

        await page.goto('/portfolios/holdings');
        await page.waitForLoadState('networkidle');

        await expect(page.getByText('XUSR', { exact: true }).first()).toBeVisible();
        await expect(page.getByText('AAPL', { exact: true })).toHaveCount(0);

        const countResponse = await page.request.get('/api/portfolios/count');
        expect(countResponse.status()).toBe(200);
        expect(await countResponse.json()).toEqual({ count: 1 });

        const primaryUserValueResponse = await page.request.get(
            `/api/portfolio/${PRIMARY_USER_PORTFOLIO_ID}/value`,
        );
        expect(primaryUserValueResponse.status()).toBe(404);
    });

    test('rejects an opaque Auth.js cookie on a dotted dynamic application path', async ({ context, page }) => {
        await context.clearCookies();
        await context.addCookies([{
            name: 'authjs.session-token',
            value: 'opaque-session-token',
            domain: 'localhost',
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
        }]);

        await page.goto('/research/thesis/BRK.B');

        await expect(page).toHaveURL(/\/login\?callbackUrl=/);
        await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
        await expect(page.getByText('Thesis not found for ticker: BRK.B')).toHaveCount(0);
    });
});
