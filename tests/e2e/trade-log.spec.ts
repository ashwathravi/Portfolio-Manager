import { test, expect } from '@playwright/test';

test.describe('Trade Log page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/portfolios/trade-log');
    });

    test('should render page heading and description', async ({ page }) => {
        await expect(page.locator('h1', { hasText: 'Trade Log' })).toBeVisible();
        await expect(page.getByText('Record of all transactions across all accounts')).toBeVisible();
    });

    test('should display Add Trade button', async ({ page }) => {
        await expect(page.getByText('Add Trade')).toBeVisible();
    });

    test('should show summary stats cards', async ({ page }) => {
        await expect(page.getByText('Total Trades')).toBeVisible();
        await expect(page.getByText('Total Buy Volume')).toBeVisible();
        await expect(page.getByText('Total Sell Volume')).toBeVisible();
    });

    test('should render trade table with column headers', async ({ page }) => {
        await expect(page.getByRole('columnheader', { name: 'DATE' })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'SYMBOL' })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'TYPE' })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'QUANTITY' })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'PRICE' })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'TOTAL VALUE' })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'ACCOUNT' })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'STATUS' })).toBeVisible();
    });

    test('should display trade rows with BUY and SELL badges', async ({ page }) => {
        // Check for BUY badges
        const buyBadges = page.locator('text=BUY');
        await expect(buyBadges.first()).toBeVisible();

        // Check for SELL badge
        await expect(page.getByText('SELL').first()).toBeVisible();
    });

    test('should display known trade symbols', async ({ page }) => {
        await expect(page.getByText('AAPL').first()).toBeVisible();
        await expect(page.getByText('TSLA').first()).toBeVisible();
        await expect(page.getByText('MSFT').first()).toBeVisible();
    });

    test('should show churn warning and filter to high-churn names', async ({ page }) => {
        await expect(page.getByTestId('trade-log-churn-warning')).toBeVisible();
        await expect(page.getByTestId('trade-log-churn-warning')).toContainText('TSLA');

        await page.getByTestId('trade-log-high-churn-filter').click();
        await expect(page.getByTestId('trade-log-high-churn-filter')).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByText('TSLA').first()).toBeVisible();
        await expect(page.getByText('MSFT').first()).toHaveCount(0);
    });

    test('should toggle filter panel via Filter button', async ({ page }) => {
        const filterButton = page.getByRole('button', { name: 'Filter' });
        await filterButton.click();

        const filters = page.getByRole('combobox');
        await expect(filters.filter({ hasText: 'All Accounts' })).toBeVisible();
        await expect(filters.filter({ hasText: 'All Strategies' })).toBeVisible();
        await expect(filters.filter({ hasText: 'All Tags' })).toBeVisible();
    });
});
