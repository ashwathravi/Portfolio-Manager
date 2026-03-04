import { test, expect } from '@playwright/test';

test.describe('Execution page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/execution');
    });

    test('should render page heading and description', async ({ page }) => {
        await expect(page.locator('h2', { hasText: 'Execution' })).toBeVisible();
        await expect(page.getByText('Manage active orders and view trade history')).toBeVisible();
    });

    test('should display Order Entry form card', async ({ page }) => {
        await expect(page.getByText('Order Entry')).toBeVisible();
        await expect(page.getByText('Place manual trade orders to the broker')).toBeVisible();
    });

    test('should show Buy/Sell tabs in the order form', async ({ page }) => {
        await expect(page.getByRole('tab', { name: 'Buy' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Sell' })).toBeVisible();
    });

    test('should show Symbol and Order Type inputs', async ({ page }) => {
        await expect(page.getByLabel('Symbol')).toBeVisible();
        await expect(page.getByLabel('Order Type')).toBeVisible();
    });

    test('should show Quantity input', async ({ page }) => {
        await expect(page.getByLabel('Quantity')).toBeVisible();
    });

    test('should show Price input for limit orders (default)', async ({ page }) => {
        // Default order type is "limit", so Price should be visible
        await expect(page.getByLabel('Price')).toBeVisible();
    });

    test('should hide Price input when Market order type is selected', async ({ page }) => {
        // Click the Order Type select and choose Market
        await page.getByLabel('Order Type').click();
        await page.getByRole('option', { name: 'Market' }).click();

        // Price field should not be visible for market orders
        await expect(page.getByLabel('Price')).not.toBeVisible();
    });

    test('should display order blotter tabs (Working, Fills, Cancelled)', async ({ page }) => {
        await expect(page.getByRole('tab', { name: /Working/ })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Fills' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Cancelled' })).toBeVisible();
    });

    test('should show working orders in the blotter', async ({ page }) => {
        // Working tab should be active by default, showing TSLA and AAPL orders
        await expect(page.getByText('TSLA').first()).toBeVisible();
        await expect(page.getByText('AAPL').first()).toBeVisible();
    });

    test('should uppercase ticker input on typing', async ({ page }) => {
        const tickerInput = page.getByLabel('Symbol');
        await tickerInput.fill('aapl');
        await expect(tickerInput).toHaveValue('AAPL');
    });

    test('should show Time in Force selector', async ({ page }) => {
        await expect(page.getByLabel('Time in Force')).toBeVisible();
    });
});
