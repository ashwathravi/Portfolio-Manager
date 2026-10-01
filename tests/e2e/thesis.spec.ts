import { test, expect } from '@playwright/test';
import { gotoAppPage } from './helpers/app';

/**
 * Thesis (/research/thesis/[ticker]) — the canonical full-page thesis,
 * restyled from the legacy shadcn layout into the Ledger memo layout.
 */
test.describe('Thesis page', () => {
    test('renders the memo with a single heading and the thesis title as subtitle', async ({ page }) => {
        await gotoAppPage(page, '/research/thesis/NVDA');
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('NVDA');
        await expect(page.locator('.pm-topbar-sub')).toHaveText('AI Infrastructure Dominance');
        await expect(page.getByTestId('thesis-page')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Would prove it wrong' })).toBeVisible();
    });

    test('regression: the unexplained health score is replaced by explained checks', async ({ page }) => {
        await gotoAppPage(page, '/research/thesis/NVDA');
        await expect(page.getByText('Health Score')).toHaveCount(0);
        const check = page.getByTestId('thesis-check');
        await expect(check.locator('li')).toHaveCount(4);
        await expect(check).toContainText('Reviewed recently');
        await expect(page.getByTestId('thesis-check-score')).toHaveText(/^\d\/4$/);
    });

    test('example thesis is tagged Sample and links to the position and a draft order', async ({ page }) => {
        await gotoAppPage(page, '/research/thesis/NVDA');
        await expect(page.getByTestId('thesis-page').getByTestId('sample-tag').first()).toBeVisible();
        await expect(page.getByRole('link', { name: 'Draft order' })).toHaveAttribute('href', '/execution?symbol=NVDA');
        await expect(page.getByRole('link', { name: 'View position' })).toHaveAttribute('href', '/portfolios/detail/NVDA');
    });

    test('an unknown ticker offers to write a thesis', async ({ page }) => {
        await gotoAppPage(page, '/research/thesis/ZZZZ');
        await expect(page.getByTestId('thesis-not-found')).toContainText('No thesis for ZZZZ');
        await expect(page.getByRole('link', { name: 'Write a thesis' })).toBeVisible();
    });
});
