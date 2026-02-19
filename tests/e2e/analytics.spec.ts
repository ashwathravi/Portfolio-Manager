import { test, expect } from '@playwright/test';

test.describe('Trade Analytics page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/analytics');
    });

    test('should render page heading and description', async ({ page }) => {
        await expect(page.locator('h1', { hasText: 'Trade Analytics' })).toBeVisible();
        await expect(page.getByText('Detailed breakdown of your trades and execution patterns')).toBeVisible();
    });

    test('should display Trading Activity section', async ({ page }) => {
        await expect(page.getByText('Trading Activity').first()).toBeVisible();
    });

    test('should show stat cards for P&L, Win Rate, Best Day, Worst Day', async ({ page }) => {
        await expect(page.getByText('Total P&L')).toBeVisible();
        await expect(page.getByText('Win Rate').first()).toBeVisible();
        await expect(page.getByText('Best Day').first()).toBeVisible();
        await expect(page.getByText('Worst Day')).toBeVisible();
    });

    test('should display year heatmap legend', async ({ page }) => {
        await expect(page.getByText('No trades').first()).toBeVisible();
        await expect(page.getByText('Profit').first()).toBeVisible();
    });

    test('should display Trade Calendar section', async ({ page }) => {
        await expect(page.getByText('Trade Calendar').first()).toBeVisible();
        await expect(page.getByText('February 2026').first()).toBeVisible();
    });

    test('should show calendar day-of-week headers', async ({ page }) => {
        const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for (const day of dayHeaders) {
            await expect(page.getByText(day, { exact: true }).first()).toBeVisible();
        }
    });

    test('should display calendar metrics', async ({ page }) => {
        await expect(page.getByText('Net P&L').first()).toBeVisible();
        await expect(page.getByText('Profit Factor').first()).toBeVisible();
    });

    test('should display Trade Distribution and Win/Loss Analysis sections', async ({ page }) => {
        await expect(page.getByText('Trade Distribution').first()).toBeVisible();
        await expect(page.getByText('Win/Loss Analysis').first()).toBeVisible();
    });

    test('should display Behavioral Insights section with summary table', async ({ page }) => {
        await expect(page.getByText('Behavioral Insights')).toBeVisible();
        await expect(page.getByText('Summary').first()).toBeVisible();

        // Day-of-week rows in the summary table
        await expect(page.getByText('Monday').first()).toBeVisible();
        await expect(page.getByText('Friday').first()).toBeVisible();
    });

    test('should show Trade Distribution by Day of the Week chart section', async ({ page }) => {
        await expect(page.getByText('Trade Distribution by Day of the Week')).toBeVisible();
    });
});
