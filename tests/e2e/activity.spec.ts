import { test, expect } from '@playwright/test';
import { gotoAppPage } from './helpers/app';

/**
 * Portfolio › Activity (/portfolios/activity). Replaces the retired
 * trade log. Rows come from the transactions table; without a database
 * the page shows an empty state instead of the old hardcoded trades.
 */
test.describe('Portfolio › Activity', () => {
    test.beforeEach(async ({ page }) => {
        await gotoAppPage(page, '/portfolios/activity');
    });

    test('renders under the Portfolio title with the Activity tab selected', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Portfolio');
        await expect(
            page.getByRole('navigation', { name: 'Section' }).getByRole('link', { name: 'Activity' }),
        ).toHaveAttribute('aria-current', 'page');
        await expect(page.getByTestId('activity-view')).toBeVisible();
    });

    test('shows real transactions or an empty state — never the old mock trades', async ({ page }) => {
        await expect(page.getByTestId('activity-table').or(page.getByTestId('activity-empty'))).toBeVisible();
        await expect(page.getByText('Fidelity Individual')).toHaveCount(0);
    });

    test('when transactions exist, side filters narrow the table', async ({ page }) => {
        const table = page.getByTestId('activity-table');
        test.skip(!(await table.isVisible()), 'no transactions in this database');
        await page.getByRole('group', { name: 'Side' }).getByRole('button', { name: 'Sells' }).click();
        const sides = await table.locator('.pm-side').allTextContents();
        expect(sides.every((s) => s === 'SELL')).toBe(true);
    });
});
