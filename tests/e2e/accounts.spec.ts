import { test, expect } from '@playwright/test';
import { gotoAppPage } from './helpers/app';

/**
 * Portfolio › Accounts (/portfolios/accounts). Replaces the retired
 * /portfolios page, which showed three hardcoded accounts. Without a
 * database (local e2e) the page must show an honest empty state, never
 * example balances.
 */
test.describe('Portfolio › Accounts', () => {
    test.beforeEach(async ({ page }) => {
        await gotoAppPage(page, '/portfolios/accounts');
    });

    test('renders under the Portfolio title with the Accounts tab selected', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Portfolio');
        await expect(
            page.getByRole('navigation', { name: 'Section' }).getByRole('link', { name: 'Accounts' }),
        ).toHaveAttribute('aria-current', 'page');
        await expect(page.getByTestId('accounts-view')).toBeVisible();
    });

    test('shows either real accounts or an empty state — never sample balances', async ({ page }) => {
        const table = page.getByTestId('accounts-table');
        const empty = page.getByTestId('accounts-empty');
        await expect(table.or(empty)).toBeVisible();
        await expect(page.getByText('Main Investment Account')).toHaveCount(0);
        await expect(page.getByText('$1,100,601.39')).toHaveCount(0);
    });

    test('empty state links to connecting an account', async ({ page }) => {
        const empty = page.getByTestId('accounts-empty');
        test.skip(!(await empty.isVisible()), 'database has accounts');
        await expect(empty.getByRole('link', { name: 'Connect an account' })).toHaveAttribute('href', '/settings#accounts');
    });
});
