import { test, expect } from '@playwright/test';

test.describe('Dashboard page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('should display greeting with time-of-day context', async ({ page }) => {
        // The greeting should be "Good Morning", "Good Afternoon", or "Good Evening"
        await expect(page.locator('h2', { hasText: /Good (Morning|Afternoon|Evening)/ })).toBeVisible();
    });

    test('should display stat cards with financial data', async ({ page }) => {
        // Total Net Worth stat card
        await expect(page.getByText('Total Net Worth')).toBeVisible();

        // Today's P&L stat cards
        await expect(page.getByText("Today's P&L ($)")).toBeVisible();
        await expect(page.getByText("Today's P&L (%)")).toBeVisible();
    });

    test('should show market status indicator', async ({ page }) => {
        await expect(page.getByText('Market Open')).toBeVisible();
    });

    test('should display connected accounts section', async ({ page }) => {
        await expect(page.getByText('Connected Accounts')).toBeVisible();
    });

    test('should show Add Asset button', async ({ page }) => {
        await expect(page.getByText('Add Asset')).toBeVisible();
    });
});
