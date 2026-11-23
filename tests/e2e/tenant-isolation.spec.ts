import { expect, test } from '@playwright/test';

import { e2eDatabase } from './helpers/users';

const OTHER_USER_PORTFOLIO_ID = '00000000-0000-4000-8000-000000000009';
// User B's one other asset, "Other User Asset Sentinel".
const OTHER_USER_ITEM_ID = '00000000-0000-4000-8000-000000000701';
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

    test('never shows or changes another user\'s other assets and debts', async ({ page }) => {
        await page.goto('/portfolios/accounts');
        await expect(page.getByTestId('net-worth-items')).toBeVisible();
        await expect(page.getByText('Other User Asset Sentinel')).toHaveCount(0);

        const takeover = { kind: 'asset', category: 'other_asset', name: 'Taken over', value: 1, valueAsOf: '2026-11-01' };
        for (const response of [
            await page.request.put(`/api/portfolio/net-worth-items/${OTHER_USER_ITEM_ID}`, { data: takeover }),
            await page.request.delete(`/api/portfolio/net-worth-items/${OTHER_USER_ITEM_ID}`),
        ]) {
            expect(response.status()).toBe(404);
            expect(await response.json()).toEqual({ error: 'Asset or debt not found', code: 'NET_WORTH_ITEM_NOT_FOUND' });
        }
        const rows = await e2eDatabase()<{ name: string; value: string }[]>`
            SELECT name, value::text AS value FROM net_worth_items WHERE id = ${OTHER_USER_ITEM_ID}`;
        expect(rows.map((r) => ({ ...r }))).toEqual([{ name: 'Other User Asset Sentinel', value: '999.00' }]);
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

        // Its own other asset is in its own card.
        await page.goto('/portfolios/accounts');
        await expect(page.getByTestId('net-worth-items')).toContainText('Other User Asset Sentinel');
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
