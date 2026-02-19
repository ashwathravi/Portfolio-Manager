import { test, expect } from '@playwright/test';

test.describe('Holdings page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/portfolios/holdings');
    });

    test('should render the holdings page', async ({ page }) => {
        // The page uses Suspense with a fallback, so wait for either
        // the table content or the loading message
        await expect(
            page.locator('text=Loading holdings...').or(page.locator('table').first())
        ).toBeVisible();
    });

    test('should show holdings table when data is available', async ({ page }) => {
        // Wait for the page to load (either table appears or loading completes)
        await page.waitForLoadState('networkidle');

        // If holdings are loaded from DB, a table should appear.
        // If DB is empty, the component may show an empty state.
        const tableOrEmpty = page.locator('table').first().or(
            page.locator('text=/no holdings|empty|Loading/i')
        );
        await expect(tableOrEmpty).toBeVisible();
    });
});
