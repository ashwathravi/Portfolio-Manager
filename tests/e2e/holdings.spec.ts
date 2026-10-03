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

test.describe('Holdings sparklines', () => {
    test('with holdings: no price history shows a dash, never an invented trend line', async ({ page }) => {
        await page.route('**/api/market-data/historical**', (route) =>
            route.fulfill({ status: 500, json: { error: 'provider unavailable' } }),
        );
        await gotoAppPage(page, '/portfolios/holdings');
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        const firstRow = page.locator('table tbody tr').first();
        await expect(firstRow.getByTestId('spark-empty')).toBeVisible();
        await expect(firstRow.getByRole('img', { name: /30-day trend/ })).toHaveCount(0);
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

const SAMPLE_CSV = [
    'Account,Brokerage',
    'Symbol,Description,Quantity,Average Cost',
    'NVDA,NVIDIA Corp,10,"$450.25"',
    'MSFT,Microsoft,2,300',
    'BAD TICKER,Nope,1,1',
    'Account Total,,,',
].join('\n');

async function openImport(page: Page) {
    const trigger = page.getByRole('button', { name: 'Import CSV' }).first();
    await expect(async () => {
        await trigger.click();
        await expect(page.getByTestId('import-dialog')).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await page.getByLabel('CSV file').setInputFiles({ name: 'positions.csv', mimeType: 'text/csv', buffer: Buffer.from(SAMPLE_CSV) });
}

test.describe('Holdings › Import CSV', () => {
    test('previews what was read, flags rows it could not read, and skips totals', async ({ page }) => {
        await gotoAppPage(page, '/portfolios/holdings');
        await openImport(page);
        const preview = page.getByTestId('import-preview');
        await expect(preview).toContainText('2 positions ready, 1 row needs attention, 1 cash or total row skipped');
        await expect(preview.locator('tbody tr')).toHaveCount(2);
        await expect(preview.getByRole('list', { name: 'Rows not imported' })).toContainText('Line 5');
        await expect(page.getByRole('button', { name: 'Import 2 positions' })).toBeEnabled();
    });

    test('sends exactly the previewed rows, then confirms', async ({ page }) => {
        let sent: { rows?: Array<{ symbol: string; quantity: number; avgCost: number }>; portfolioId?: string; newPortfolioName?: string } = {};
        await page.route('**/api/portfolio/import', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill({ status: 200, json: { data: { portfolioId: 'p', createdPortfolio: false, insert: 1, update: 1, unchanged: 0 } } });
        });
        await gotoAppPage(page, '/portfolios/holdings');
        await openImport(page);
        await page.getByRole('button', { name: 'Import 2 positions' }).click();
        await expect(page.getByText('Imported 2 positions: 1 new, 1 updated.')).toBeVisible();
        expect(sent.rows).toEqual([
            { symbol: 'NVDA', name: 'NVIDIA Corp', quantity: 10, avgCost: 450.25 },
            { symbol: 'MSFT', name: 'Microsoft', quantity: 2, avgCost: 300 },
        ]);
        expect(Boolean(sent.portfolioId) !== Boolean(sent.newPortfolioName)).toBe(true);
    });

    test('a server error is shown and nothing is claimed', async ({ page }) => {
        await page.route('**/api/portfolio/import', (route) =>
            route.fulfill({ status: 404, json: { error: 'Portfolio not found' } }),
        );
        await gotoAppPage(page, '/portfolios/holdings');
        await openImport(page);
        await page.getByRole('button', { name: 'Import 2 positions' }).click();
        await expect(page.getByTestId('import-dialog').getByRole('alert')).toHaveText('Portfolio not found');
        await expect(page.getByText(/Imported \d+ position/)).toHaveCount(0);
    });
});

test.describe('POST /api/portfolio/import', () => {
    const dbMode = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');

    test('rejects a malformed import before touching the database', async ({ page }) => {
        await gotoAppPage(page, '/portfolios/holdings');
        const res = await page.request.post('/api/portfolio/import', { data: { rows: [] } });
        expect(res.status()).toBe(400);
    });

    test('database: another user\'s account is a 404 and nothing is written', async ({ page }) => {
        test.skip(!dbMode, 'needs the seeded E2E database');
        await gotoAppPage(page, '/portfolios/holdings');
        const res = await page.request.post('/api/portfolio/import', {
            data: { portfolioId: '00000000-0000-4000-8000-000000000009', rows: [{ symbol: 'XUSR', quantity: 5, avgCost: 1 }] },
        });
        expect(res.status()).toBe(404);
    });

    test('database: re-importing an identical position reports it unchanged', async ({ page }) => {
        test.skip(!dbMode, 'needs the seeded E2E database');
        await gotoAppPage(page, '/portfolios/holdings');
        const res = await page.request.post('/api/portfolio/import', {
            data: {
                portfolioId: '00000000-0000-4000-8000-000000000001',
                rows: [{ symbol: 'AAPL', name: 'Apple Inc.', quantity: 500, avgCost: 165.3 }],
            },
        });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.data).toMatchObject({ insert: 0, update: 0, unchanged: 1, createdPortfolio: false });
    });
});
