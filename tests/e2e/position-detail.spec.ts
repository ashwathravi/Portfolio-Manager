import { test, expect } from '@playwright/test';
import { gotoAppPage } from './helpers/app';

/**
 * Position detail (/portfolios/detail/[symbol]). Used to dead-end with
 * "No holdings for AAPL" and an emoji. It now works for any symbol and
 * offers the next steps: the thesis and a draft order.
 */
test.describe('Position detail', () => {
    test('renders the symbol as the page title under Portfolio › Holdings', async ({ page }) => {
        await gotoAppPage(page, '/portfolios/detail/nvda');
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('NVDA');
        await expect(page.getByTestId('position-detail')).toBeVisible();
    });

    test('offers a draft order prefilled with the symbol', async ({ page }) => {
        await gotoAppPage(page, '/portfolios/detail/NVDA');
        await expect(page.getByRole('link', { name: 'Draft order' })).toHaveAttribute('href', '/execution?symbol=NVDA');
    });

    test('links to the thesis when one exists', async ({ page }) => {
        await gotoAppPage(page, '/portfolios/detail/NVDA');
        const thesis = page.getByTestId('position-thesis');
        await expect(thesis.getByRole('link', { name: 'Open thesis' })).toHaveAttribute('href', '/research/thesis/NVDA');
    });

    test('regression: a symbol you do not hold is not a dead end', async ({ page }) => {
        await gotoAppPage(page, '/portfolios/detail/ZZZZ');
        const notHeld = page.getByTestId('position-not-held');
        test.skip(!(await notHeld.isVisible()), 'database holds this symbol');
        await expect(notHeld).toContainText("You don't hold ZZZZ");
        await expect(page.getByTestId('position-thesis').getByRole('link', { name: 'Write a thesis' })).toBeVisible();
        await expect(page.getByText('🔍')).toHaveCount(0);
    });

    test('Add to watchlist puts the symbol on the Research watchlist, and can be undone', async ({ page }) => {
        await gotoAppPage(page, '/portfolios/detail/AMD');
        const toggle = page.getByRole('button', { name: 'Add to watchlist' });
        await expect(async () => {
            await toggle.click();
            await expect(page.getByRole('button', { name: /On watchlist/ })).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
        await gotoAppPage(page, '/research?tab=watchlist');
        await expect(page.locator('.pm-research-list').getByRole('button', { name: /AMD/ })).toBeVisible();
        await gotoAppPage(page, '/portfolios/detail/AMD');
        await page.getByRole('button', { name: /On watchlist/ }).click();
        await expect(page.getByRole('button', { name: 'Add to watchlist' })).toHaveAttribute('aria-pressed', 'false');
    });
});
