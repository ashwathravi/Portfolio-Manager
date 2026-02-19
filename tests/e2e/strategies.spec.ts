import { test, expect } from '@playwright/test';

test.describe('Strategies page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/strategies');
    });

    test('should render page heading and description', async ({ page }) => {
        await expect(page.locator('h1', { hasText: 'Strategies' })).toBeVisible();
        await expect(page.getByText('Build, backtest, and monitor your trading strategies')).toBeVisible();
    });

    test('should display New Strategy button', async ({ page }) => {
        await expect(page.getByText('New Strategy')).toBeVisible();
    });

    test('should show overview stat cards', async ({ page }) => {
        await expect(page.getByText('Active Strategies')).toBeVisible();
        await expect(page.getByText('Avg Return')).toBeVisible();
        await expect(page.getByText('Avg Sharpe Ratio')).toBeVisible();
        await expect(page.getByText('Total Trades')).toBeVisible();
    });

    test('should display strategy cards with names', async ({ page }) => {
        await expect(page.getByText('Momentum + Value')).toBeVisible();
        await expect(page.getByText('Mean Reversion')).toBeVisible();
        await expect(page.getByText('Sector Rotation')).toBeVisible();
    });

    test('should show strategy statuses as badges', async ({ page }) => {
        await expect(page.getByText('active').first()).toBeVisible();
        await expect(page.getByText('paused').first()).toBeVisible();
        await expect(page.getByText('backtesting').first()).toBeVisible();
    });

    test('should display strategy performance metrics for non-backtesting strategies', async ({ page }) => {
        // Momentum + Value should show metrics
        await expect(page.getByText('Total Return').first()).toBeVisible();
        await expect(page.getByText('Sharpe Ratio').first()).toBeVisible();
        await expect(page.getByText('Win Rate').first()).toBeVisible();
    });

    test('should show appropriate action buttons based on status', async ({ page }) => {
        // Active strategy should have "Pause" button
        await expect(page.getByRole('button', { name: /Pause/ })).toBeVisible();

        // Paused strategy should have "Resume" button
        await expect(page.getByRole('button', { name: /Resume/ })).toBeVisible();

        // Backtesting strategy should have "Run Backtest" button
        await expect(page.getByRole('button', { name: /Run Backtest/ })).toBeVisible();
    });

    test('should have View Details buttons for each strategy', async ({ page }) => {
        const viewButtons = page.getByRole('button', { name: 'View Details' });
        await expect(viewButtons).toHaveCount(3);
    });

    test('should show strategy builder CTA', async ({ page }) => {
        await expect(page.getByText('Build Your First Strategy')).toBeVisible();
        await expect(page.getByText('Open Strategy Builder')).toBeVisible();
    });
});
