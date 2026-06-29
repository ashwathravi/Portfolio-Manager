import { test, expect } from '@playwright/test';

test.describe('Portfolios page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/portfolios');
    });

    test('should render page heading and description', async ({ page }) => {
        await expect(page.locator('h1', { hasText: 'Portfolios' })).toBeVisible();
        await expect(page.getByText('Manage your investment portfolios')).toBeVisible();
    });

    test('should display New Portfolio button', async ({ page }) => {
        await expect(page.getByText('New Portfolio')).toBeVisible();
    });

    test('should show view-by toggles (Account, Strategy, Tag)', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Strategy', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Tag', exact: true })).toBeVisible();
    });

    test('should display summary cards (Total Value, Total Cash, count)', async ({ page }) => {
        await expect(page.getByText('Total Value')).toBeVisible();
        await expect(page.getByText('Total Cash')).toBeVisible();
    });

    test('should render portfolio table with columns', async ({ page }) => {
        await expect(page.getByRole('columnheader', { name: /NAME/ })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: /VALUE/ })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: /DAY CHANGE/ })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: /TOTAL RETURN/ })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: /CASH BALANCE/ })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'LAST UPDATED' })).toBeVisible();
    });

    test('should display account data rows in the table', async ({ page }) => {
        await expect(page.getByText('Main Investment Account')).toBeVisible();
        await expect(page.getByText('Retirement IRA')).toBeVisible();
        await expect(page.getByText('Speculative Trading')).toBeVisible();
    });

    test('should switch views when clicking Strategy toggle', async ({ page }) => {
        await page.getByRole('button', { name: 'Strategy', exact: true }).click();

        // Strategy-specific data should appear
        await expect(page.getByText('Growth Tech')).toBeVisible();
        await expect(page.getByText('Value Investing')).toBeVisible();
        await expect(page.getByText('Momentum Trading')).toBeVisible();
    });

    test('should switch views when clicking Tag toggle', async ({ page }) => {
        await page.getByRole('button', { name: 'Tag', exact: true }).click();

        // Tag-specific data should appear
        await expect(page.getByText('High Conviction')).toBeVisible();
        await expect(page.getByText('VCP Setup')).toBeVisible();
    });

    test('should filter table rows with search input', async ({ page }) => {
        const searchInput = page.getByPlaceholder('Filter...');
        await searchInput.fill('Retirement');

        // Only Retirement IRA should be visible
        await expect(page.getByText('Retirement IRA')).toBeVisible();
        await expect(page.getByText('Main Investment Account')).not.toBeVisible();
        await expect(page.getByText('Speculative Trading')).not.toBeVisible();
    });

    test('should navigate to holdings on row click', async ({ page }) => {
        await page.getByText('Main Investment Account').click();
        await expect(page).toHaveURL(/\/portfolios\/holdings/);
    });
});
