import { test, expect, type Page } from '@playwright/test';
import { gotoAppPage } from './helpers/app';

/**
 * Portfolio › Holdings (/portfolios/holdings).
 *
 * Holdings come from the database. With an empty book the page shows a
 * single empty state (no zero-filled KPI tiles, and no option ledger
 * measured against nothing). With positions, it shows the summary strip,
 * policy/theme exposure, the filter row, and the full table; the LEAPS
 * ledger runs on example positions until an options feed exists, so it
 * carries a Sample tag.
 */

async function hasHoldings(page: Page): Promise<boolean> {
    await expect(page.getByTestId('holdings-empty').or(page.locator('table').first())).toBeVisible();
    return !(await page.getByTestId('holdings-empty').isVisible());
}

test.describe('Portfolio › Holdings', () => {
    test.beforeEach(async ({ page }) => {
        await gotoAppPage(page, '/portfolios/holdings');
    });

    test('renders under the Portfolio title with the Holdings tab selected', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Portfolio');
        await expect(
            page.getByRole('navigation', { name: 'Section' }).getByRole('link', { name: 'Holdings' }),
        ).toHaveAttribute('aria-current', 'page');
    });

    test('regression: there is exactly one page heading', async ({ page }) => {
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.getByText('Current holdings')).toHaveCount(0);
    });

    test('shows the holdings table or a single empty state', async ({ page }) => {
        await expect(page.locator('table').first().or(page.getByTestId('holdings-empty'))).toBeVisible();
    });

    test('regression: an empty book shows no option premium measured against nothing', async ({ page }) => {
        test.skip(await hasHoldings(page), 'database has holdings');
        await expect(page.getByTestId('options-risk-ledger')).toHaveCount(0);
        await expect(page.getByText('185.7%')).toHaveCount(0);
        const empty = page.getByTestId('holdings-empty');
        await expect(empty.getByRole('link', { name: 'Connect an account' })).toHaveAttribute('href', '/settings#accounts');
    });

    test('regression: no dead links to retired routes', async ({ page }) => {
        for (const href of ['/portfolios', '/portfolios/trade-log']) {
            await expect(page.locator(`main a[href="${href}"]`)).toHaveCount(0);
        }
    });

    test('with holdings: exposes policy bucket and theme controls', async ({ page }) => {
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        await expect(page.getByRole('heading', { name: 'Policy buckets' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Theme exposure' })).toBeVisible();
        const bucketFilter = page.getByLabel('Filter holdings by policy bucket');
        await bucketFilter.selectOption('active');
        await expect(bucketFilter).toHaveValue('active');
    });

    test('with holdings: the LEAPS ledger is tagged as sample data', async ({ page }) => {
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        const ledger = page.getByTestId('options-risk-ledger');
        await expect(ledger).toContainText('LEAPS and option premium at risk');
        await expect(ledger.getByTestId('sample-tag')).toBeVisible();
    });
});

test.describe('Holdings layout', () => {
    test('regression: holdings content keeps a page gutter instead of touching the sidebar', async ({ page }) => {
        await gotoAppPage(page, '/portfolios/holdings');
        const stack = page.locator('.pm-holdings-stack');
        await expect(stack).toBeVisible();
        const paddingLeft = await stack.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
        expect(paddingLeft).toBeGreaterThanOrEqual(16);
    });
});
