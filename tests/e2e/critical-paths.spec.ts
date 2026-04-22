import { test, expect } from '@playwright/test';

/**
 * Critical user-path E2E tests (AR-33).
 *
 * These cover end-to-end journeys that involve state mutation and cross-page
 * propagation, not just page-level rendering checks. They exercise:
 *   1. alert rule creation + zustand persist across reload
 *   2. preferences change → propagates to dashboard's LiveDataIndicator (AR-36)
 *   3. theme switch → html.dark class applied + persists
 *   4. multi-page navigation journey without breaking data
 */

test.describe('Critical user paths', () => {
    test('user creates an alert rule and it persists across reload', async ({ page }) => {
        await page.goto('/settings?tab=alerts');

        // Seed rules should render up front. Use exact match + .first() because the
        // rule name also appears in sr-only labels on the edit/delete buttons.
        await expect(page.getByText('AAPL above $200', { exact: true }).first()).toBeVisible();

        // Open the "New Alert" dialog.
        await page.getByRole('button', { name: /New Alert/ }).click();
        await expect(page.getByRole('dialog')).toBeVisible();

        // Fill the form. Metric defaults to "price" which requires a symbol.
        const uniqueName = `E2E price alert ${Date.now()}`;
        await page.getByLabel('Name').fill(uniqueName);
        await page.getByLabel('Symbol', { exact: false }).fill('tsla');
        await page.getByLabel('Threshold', { exact: false }).fill('250');

        // Submit.
        await page.getByRole('button', { name: 'Create', exact: true }).click();

        // Dialog closes and the new rule is rendered in the list. The name also
        // appears in the toast and in sr-only labels on edit/delete buttons, so
        // scope to the visible list label.
        await expect(page.getByRole('dialog')).not.toBeVisible();
        await expect(page.getByText(uniqueName, { exact: true }).first()).toBeVisible();

        // Reload — zustand persist (localStorage) should restore the rule.
        await page.reload();
        await expect(page.getByText(uniqueName, { exact: true }).first()).toBeVisible();
    });

    test('changing market data refresh interval reflects on dashboard live indicator', async ({ page }) => {
        // Stub the quotes endpoint so the client query resolves successfully regardless
        // of whether API keys are configured in the test environment. When the query
        // errors out, LiveDataIndicator hides the refresh-every label and we'd have
        // nothing assertable.
        await page.route('**/api/market-data/quotes*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: {} }),
            });
        });

        await page.goto('/settings?tab=preferences');

        const refreshInput = page.getByLabel('Market data refresh (seconds)');
        await expect(refreshInput).toBeVisible();

        // Flip to a non-default value.
        await refreshInput.fill('');
        await refreshInput.fill('120');

        await page.getByRole('button', { name: /Save Preferences/ }).click();

        // Reload the preferences page and confirm the value was persisted by the store.
        await page.reload();
        await expect(page.getByLabel('Market data refresh (seconds)')).toHaveValue('120');

        // Navigate to the dashboard and verify the LiveDataIndicator reflects the new interval.
        // The indicator shows "auto-refresh every Ns" in both the initial and success states.
        await page.goto('/');
        await expect(page.getByText(/every\s*120s/i).first()).toBeVisible({ timeout: 10_000 });
    });

    test('switching theme to dark applies html.dark class and persists', async ({ page }) => {
        await page.goto('/settings?tab=appearance');

        // Select the Dark theme tile.
        await page.getByLabel('Dark', { exact: true }).click();

        // ThemeProvider runs a useEffect that toggles `html.dark`. Wait for it.
        await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);

        // Navigate away — the class should remain since the settings store persists.
        await page.goto('/');
        await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);

        // Reload and ensure the class is re-applied on a cold load too.
        await page.reload();
        await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);
    });

    test('user navigates dashboard → holdings → portfolios without errors', async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on('pageerror', (err) => consoleErrors.push(err.message));

        await page.goto('/');
        await expect(page.getByText(/Here's your portfolio overview/i)).toBeVisible();

        // Jump to holdings via direct URL (sidebar is covered by navigation.spec.ts).
        await page.goto('/portfolios/holdings');
        // The page uses Suspense — wait for table OR empty-state.
        const tableOrEmpty = page.locator('table').first().or(
            page.locator('text=/no holdings|Loading/i'),
        );
        await expect(tableOrEmpty).toBeVisible();

        // Then portfolios overview.
        await page.goto('/portfolios');
        await expect(page.locator('h1', { hasText: 'Portfolios' })).toBeVisible();

        // No uncaught runtime errors surfaced during the journey.
        expect(consoleErrors).toEqual([]);
    });
});
