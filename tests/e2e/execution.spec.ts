import { test, expect } from '@playwright/test';

/**
 * Phase 9 (AR-94) Execution tests.
 *
 * Phase 7 (AR-83/84/85/86) replaced the legacy single OrderEntryForm
 * surface with a variant-switching shell that renders one of three
 * execution layouts: Focus (default — form + blotter split), Checkout
 * (guided wizard), or Terminal (Bloomberg-style keyboard palette). The
 * chosen variant persists in localStorage under `pm-exec-variant`.
 *
 * The tests cover:
 *   - Topbar title + variant switcher in the Topbar actions slot
 *   - Focus variant's "New order" form fields, TIF group, preview rows
 *   - Blotter filter chips
 *   - Switching variants flips the `data-variant` attribute on the shell
 */

test.describe('Execution page (Focus variant, default)', () => {
    test.beforeEach(async ({ page }) => {
        // Clear any persisted variant so every test lands on Focus.
        await page.addInitScript(() => {
            try {
                window.localStorage.removeItem('pm-exec-variant');
            } catch {
                /* private-mode / sandboxed — ignore */
            }
        });
        await page.goto('/execution');
    });

    test('renders Topbar title "Execution" and the 3-pill variant switcher', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Execution');

        const switcher = page.locator('.pm-variant-switch');
        await expect(switcher).toBeVisible();
        await expect(switcher.getByRole('tab', { name: /Focus/ })).toBeVisible();
        await expect(switcher.getByRole('tab', { name: /Checkout/ })).toBeVisible();
        await expect(switcher.getByRole('tab', { name: /Terminal/ })).toBeVisible();
    });

    test('lands on the Focus variant by default', async ({ page }) => {
        await expect(page.locator('.pm-exec-page[data-variant="focus"]')).toBeVisible();
    });

    test('Focus variant shows both the New order form and Today\'s orders blotter', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'New order' })).toBeVisible();
        await expect(
            page.getByText('Draft routes to review. Never fills on click.'),
        ).toBeVisible();
        // "Today's orders" uses an h3 inside the right card.
        await expect(page.getByRole('heading', { name: /Today.?s orders/i })).toBeVisible();
    });

    test('side toggle defaults to Buy and switches to Sell on click', async ({ page }) => {
        const sideTabs = page.locator('.pm-exec-side');
        await expect(sideTabs.getByRole('tab', { name: 'Buy' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        await expect(sideTabs.getByRole('tab', { name: 'Sell' })).toHaveAttribute(
            'aria-selected',
            'false',
        );

        await sideTabs.getByRole('tab', { name: 'Sell' }).click();
        await expect(sideTabs.getByRole('tab', { name: 'Sell' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    test('form renders ticker / quantity / order-type with seed defaults', async ({ page }) => {
        await expect(page.getByLabel('Ticker')).toHaveValue('AAPL');
        await expect(page.getByLabel('Quantity')).toHaveValue('50');
        await expect(page.getByLabel('Order type')).toHaveValue('limit');
    });

    test('ticker input uppercases user input', async ({ page }) => {
        const ticker = page.getByLabel('Ticker');
        await ticker.fill('tsla');
        await expect(ticker).toHaveValue('TSLA');
    });

    test('TIF segmented group shows DAY/GTC/IOC/FOK with DAY selected', async ({ page }) => {
        const tif = page.locator('.pm-exec-tif');
        await expect(tif.getByRole('tab', { name: 'DAY' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        for (const opt of ['GTC', 'IOC', 'FOK']) {
            await expect(tif.getByRole('tab', { name: opt })).toBeVisible();
        }
    });

    test('preview section renders notional / commission / buying-power / position rows', async ({ page }) => {
        const preview = page.locator('.pm-exec-preview');
        await expect(preview.getByText('Notional')).toBeVisible();
        await expect(preview.getByText('Est. commission')).toBeVisible();
        await expect(preview.getByText('Buying power after')).toBeVisible();
        await expect(preview.getByText('Position after')).toBeVisible();
    });

    test('blotter exposes All / Working / Filled / Rejected filter chips', async ({ page }) => {
        const chips = page.locator('.pm-exec-chips');
        for (const label of ['All', 'Working', 'Filled', 'Rejected']) {
            await expect(
                chips.getByRole('tab', { name: new RegExp(`^${label}`) }),
            ).toBeVisible();
        }
    });

    test('switching to Checkout variant flips the shell data-variant attribute', async ({ page }) => {
        await page
            .locator('.pm-variant-switch')
            .getByRole('tab', { name: /Checkout/ })
            .click();
        await expect(page.locator('.pm-exec-page[data-variant="checkout"]')).toBeVisible();
    });

    test('switching to Terminal variant flips the shell data-variant attribute', async ({ page }) => {
        await page
            .locator('.pm-variant-switch')
            .getByRole('tab', { name: /Terminal/ })
            .click();
        await expect(page.locator('.pm-exec-page[data-variant="terminal"]')).toBeVisible();
    });
});
