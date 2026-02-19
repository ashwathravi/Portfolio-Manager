import { test, expect } from '@playwright/test';

test.describe('Performance page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/performance');
    });

    test('should render page heading and description', async ({ page }) => {
        await expect(page.locator('h1', { hasText: 'Performance Analytics' })).toBeVisible();
        await expect(page.getByText('Deep dive into your portfolio performance and risk metrics')).toBeVisible();
    });

    test('should display time period filters', async ({ page }) => {
        await expect(page.getByText('All Time')).toBeVisible();
        await expect(page.getByText('Date Range')).toBeVisible();
    });

    test('should show trading performance metrics cards', async ({ page }) => {
        await expect(page.getByText('Net Realized P&L')).toBeVisible();
        await expect(page.getByText('Win Rate').first()).toBeVisible();
        await expect(page.getByText('Profit Factor').first()).toBeVisible();
        await expect(page.getByText('Avg win/loss trade')).toBeVisible();
    });

    test('should show additional financial metrics', async ({ page }) => {
        await expect(page.getByText('Unrealized P&L')).toBeVisible();
        await expect(page.getByText('Available Cash')).toBeVisible();
        await expect(page.getByText('Deployed Capital')).toBeVisible();
        await expect(page.getByText('Total Open Risk')).toBeVisible();
    });

    test('should display key performance stat cards', async ({ page }) => {
        await expect(page.getByText('Total Return (1Y)')).toBeVisible();
        await expect(page.getByText('Sharpe Ratio').first()).toBeVisible();
        await expect(page.getByText('Max Drawdown').first()).toBeVisible();
        await expect(page.getByText('Alpha').first()).toBeVisible();
    });

    test('should display Monthly Performance chart section', async ({ page }) => {
        await expect(page.getByText('Monthly Performance')).toBeVisible();
    });

    test('should display Equity Curve chart section', async ({ page }) => {
        await expect(page.getByText('Equity Curve')).toBeVisible();
    });

    test('should display Account Balance chart section', async ({ page }) => {
        await expect(page.getByText('Account Balance')).toBeVisible();
    });

    test('should display Performance by Period table', async ({ page }) => {
        await expect(page.getByText('Performance by Period')).toBeVisible();

        // Table headers
        await expect(page.getByText('Period').first()).toBeVisible();
        await expect(page.getByText('Benchmark').first()).toBeVisible();

        // Period rows from mock data
        await expect(page.getByText('1M').first()).toBeVisible();
        await expect(page.getByText('3M').first()).toBeVisible();
        await expect(page.getByText('YTD').first()).toBeVisible();
        await expect(page.getByText('1Y').first()).toBeVisible();
    });

    test('should display Risk Metrics section', async ({ page }) => {
        await expect(page.getByText('Risk Metrics')).toBeVisible();
        await expect(page.getByText('Volatility (Annual)')).toBeVisible();
        await expect(page.getByText('Beta')).toBeVisible();
        await expect(page.getByText('Value at Risk (95%)')).toBeVisible();
        await expect(page.getByText('Sortino Ratio').first()).toBeVisible();
    });

    test('should display Attribution Analysis section', async ({ page }) => {
        await expect(page.getByText('Attribution Analysis')).toBeVisible();
        await expect(page.getByText('Stock Selection')).toBeVisible();
        await expect(page.getByText('Asset Allocation')).toBeVisible();
        await expect(page.getByText('Timing')).toBeVisible();
    });
});
