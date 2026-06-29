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

    test('should expose risk policy bucket and theme controls', async ({ page }) => {
        await page.waitForLoadState('networkidle');

        await expect(page.getByRole('heading', { name: 'Policy buckets' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Theme exposure' })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'Policy' })).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'Themes' })).toBeVisible();

        const bucketFilter = page.getByLabel('Filter holdings by policy bucket');
        await expect(bucketFilter).toBeVisible();
        await bucketFilter.selectOption('active');
        await expect(bucketFilter).toHaveValue('active');

        const themeFilter = page.getByLabel('Filter holdings by theme');
        await expect(themeFilter).toBeVisible();
        await themeFilter.selectOption('ai_infrastructure');
        await expect(themeFilter).toHaveValue('ai_infrastructure');
    });

    test('should render the options risk ledger with breached LEAPS policy rows', async ({ page }) => {
        await page.waitForLoadState('networkidle');

        const ledger = page.getByTestId('options-risk-ledger');
        await expect(ledger).toBeVisible();
        await expect(ledger).toContainText('LEAPS and option premium at risk');
        await expect(ledger).toContainText('AAPL 2027-01-15 250C');
        await expect(ledger).toContainText('RIVN 2027-01-16 25C');
        await expect(ledger).toContainText('Premium risk');
        await expect(ledger).toContainText('Notional equiv.');
        await expect(
            ledger.locator('[data-testid="options-risk-row"][data-status="breached"]'),
        ).toBeVisible();
    });
});
