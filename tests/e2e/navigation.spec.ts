import { test, expect } from '@playwright/test';

test.describe('Sidebar navigation', () => {
    test('should navigate to all top-level routes from sidebar', async ({ page }) => {
        await page.goto('/');

        // Sidebar should always be visible
        const sidebar = page.locator('nav');
        await expect(sidebar).toBeVisible();

        // Dashboard link should be highlighted by default
        await expect(sidebar.getByText('Dashboard')).toBeVisible();

        // Navigate to Performance
        await sidebar.getByText('Performance').click();
        await expect(page).toHaveURL(/\/performance/);
        await expect(page.locator('h1', { hasText: 'Performance Analytics' })).toBeVisible();

        // Navigate to Trade Analytics
        await sidebar.getByText('Trade Analytics').click();
        await expect(page).toHaveURL(/\/analytics/);
        await expect(page.locator('h1', { hasText: 'Trade Analytics' })).toBeVisible();

        // Navigate to Settings
        await sidebar.getByText('Settings').click();
        await expect(page).toHaveURL(/\/settings/);
        await expect(page.locator('h2', { hasText: 'Settings' })).toBeVisible();
    });

    test('should expand Portfolio sub-menu and navigate to sub-pages', async ({ page }) => {
        await page.goto('/');

        const sidebar = page.locator('nav');

        // Click on "Portfolio" to expand the sub-menu
        await sidebar.getByText('Portfolio', { exact: false }).first().click();

        // Sub-items should become visible
        await expect(sidebar.getByText('Overview')).toBeVisible();
        await expect(sidebar.getByText('Current Holdings')).toBeVisible();
        await expect(sidebar.getByText('Trade Log')).toBeVisible();

        // Navigate to Overview
        await sidebar.getByText('Overview').click();
        await expect(page).toHaveURL(/\/portfolios/);
        await expect(page.locator('h1', { hasText: 'Portfolios' })).toBeVisible();
    });

    test('should expand Research sub-menu and navigate to sub-pages', async ({ page }) => {
        await page.goto('/');

        const sidebar = page.locator('nav');

        // Click on "Research" to expand the sub-menu
        await sidebar.getByText('Research', { exact: false }).first().click();

        // Sub-items should become visible
        await expect(sidebar.getByText('Theses')).toBeVisible();
        await expect(sidebar.getByText('Watchlists')).toBeVisible();
        await expect(sidebar.getByText('Journal')).toBeVisible();
    });

    test('should expand Strategies sub-menu', async ({ page }) => {
        await page.goto('/');

        const sidebar = page.locator('nav');

        // Click on "Strategies" to expand the sub-menu
        await sidebar.getByText('Strategies', { exact: false }).first().click();

        await expect(sidebar.getByText('Builder')).toBeVisible();
        await expect(sidebar.getByText('Backtests')).toBeVisible();
    });

    test('should show user info in sidebar footer', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText('John Doe')).toBeVisible();
        await expect(page.getByText('Pro Plan')).toBeVisible();
    });
});
