import { test, expect } from '@playwright/test';

test.describe('Research page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/research');
    });

    test('should render page heading and description', async ({ page }) => {
        await expect(page.locator('h1', { hasText: 'Research' })).toBeVisible();
        await expect(page.getByText('Develop and track your investment theses')).toBeVisible();
    });

    test('should display tab navigation (Active Theses, Watchlists, Decision Journal, Archive)', async ({ page }) => {
        await expect(page.getByRole('tab', { name: 'Active Theses' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Watchlists' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Decision Journal' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Archive' })).toBeVisible();
    });

    test('should show thesis cards on Active Theses tab', async ({ page }) => {
        // Active Theses is the default tab
        await expect(page.getByText('NVDA').first()).toBeVisible();
        await expect(page.getByText('AI Infrastructure Dominance')).toBeVisible();
        await expect(page.getByText('TSLA').first()).toBeVisible();
        await expect(page.getByText('MSFT').first()).toBeVisible();
    });

    test('should show conviction levels on thesis cards', async ({ page }) => {
        await expect(page.getByText('HIGH CONVICTION').first()).toBeVisible();
        await expect(page.getByText('MEDIUM CONVICTION').first()).toBeVisible();
    });

    test('should display target prices on thesis cards', async ({ page }) => {
        await expect(page.getByText('Target: $950')).toBeVisible();
        await expect(page.getByText('Target: $180')).toBeVisible();
        await expect(page.getByText('Target: $485')).toBeVisible();
    });

    test('should switch to Watchlists tab and show watchlist items', async ({ page }) => {
        await page.getByRole('tab', { name: 'Watchlists' }).click();

        await expect(page.getByText('COIN').first()).toBeVisible();
        await expect(page.getByText('Coinbase Global')).toBeVisible();
        await expect(page.getByText('PLTR').first()).toBeVisible();
        await expect(page.getByText('SHOP').first()).toBeVisible();
    });

    test('should show price data on watchlist items', async ({ page }) => {
        await page.getByRole('tab', { name: 'Watchlists' }).click();

        await expect(page.getByText('Current Price')).toBeVisible();
        await expect(page.getByText('Target Entry')).toBeVisible();
        await expect(page.getByText('Distance')).toBeVisible();
    });

    test('should switch to Decision Journal tab and show entries', async ({ page }) => {
        await page.getByRole('tab', { name: 'Decision Journal' }).click();

        await expect(page.getByText('Increased position by 50 shares')).toBeVisible();
        await expect(page.getByText('Reduced position by 25 shares')).toBeVisible();
    });

    test('should show entry/exit/hold badges in journal', async ({ page }) => {
        await page.getByRole('tab', { name: 'Decision Journal' }).click();

        await expect(page.getByText('entry').first()).toBeVisible();
        await expect(page.getByText('exit').first()).toBeVisible();
        await expect(page.getByText('hold').first()).toBeVisible();
    });

    test('should switch to Archive tab and show archived theses', async ({ page }) => {
        await page.getByRole('tab', { name: 'Archive' }).click();

        await expect(page.getByText('META')).toBeVisible();
        await expect(page.getByText('Metaverse Pivot Risk')).toBeVisible();
        await expect(page.getByText('Archived')).toBeVisible();
    });

    test('should show New Thesis button on theses tab', async ({ page }) => {
        await expect(page.getByRole('button', { name: /New Thesis/ })).toBeVisible();
    });
});
