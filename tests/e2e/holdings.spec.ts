import { test, expect, type Page } from '@playwright/test';
import { gotoAppPage } from './helpers/app';
import { signInAsFreshUser } from './helpers/users';

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

    test('with holdings: sector chips are the sectors held, from the securities master', async ({ page }) => {
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        const dbMode = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');
        test.skip(!dbMode, 'reference data comes from the E2E database fixtures');
        const sectors = page.getByRole('radiogroup', { name: 'Filter by sector' });
        // Largest first. AMZN's industry code (catalog retail) makes it
        // Consumer; the old ticker map called it Tech.
        await expect(sectors.getByRole('radio')).toHaveText(['All', 'Tech', 'Auto', 'Consumer']);
        await sectors.getByRole('radio', { name: 'Consumer' }).click();
        const table = page.getByTestId('holdings-table');
        await expect(table.getByText('AMZN', { exact: true })).toBeVisible();
        await expect(table.getByText('AAPL', { exact: true })).toHaveCount(0);
        // The reference name, over the name the position was imported with.
        await expect(table.getByText('Amazon.Com Inc', { exact: true })).toBeVisible();
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
        const firstRow = page.getByTestId('holdings-table').locator('tbody tr').first();
        await expect(firstRow.getByTestId('spark-empty')).toBeVisible();
        await expect(firstRow.getByRole('img', { name: /30-day trend/ })).toHaveCount(0);
    });
});

test.describe('Holdings today P&L', () => {
    // Regression: before today's close the newest price is the previous
    // session's close, and its change was shown as today's P&L.
    // Sparklines fetch history per row; answering here keeps these page loads
    // off the server's market-data rate limit, which other specs share.
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/market-data/historical**', (route) => route.fulfill({ status: 200, json: { data: [] } }));
    });
    const aaplQuote = (timestamp: string) => ({
        data: [{ symbol: 'AAPL', price: 190, change: 2, changePercent: 1.06, timestamp, isRealtime: false }],
    });
    const todayPnL = (page: Page) =>
        page.locator('.pm-summary-cell').filter({ hasText: 'Today P&L' }).locator('.pm-summary-value');
    const aaplToday = (page: Page) =>
        page.getByTestId('holdings-table').locator('tbody tr').filter({ hasText: 'AAPL' }).getByTestId('holding-today');

    test('with holdings: an earlier session\'s change is not counted as today\'s', async ({ page }) => {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: aaplQuote(threeDaysAgo) }));
        await gotoAppPage(page, '/portfolios/holdings');
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        await expect(todayPnL(page)).toHaveText('$0');
        // No move from today: a dash, never "+0.00%".
        await expect(aaplToday(page)).toHaveText('—');
    });

    test('with holdings: today\'s closing change is today\'s P&L', async ({ page }) => {
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: aaplQuote(new Date().toISOString()) }));
        await gotoAppPage(page, '/portfolios/holdings');
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        // The fixture holds 500 AAPL: +$2 a share.
        await expect(todayPnL(page)).toHaveText('+$1,000');
        await expect(aaplToday(page)).toHaveText('+1.06%');
    });

    test('with holdings: a first close with nothing to compare against has no move', async ({ page }) => {
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: {
            data: [{ symbol: 'AAPL', price: 190, change: null, changePercent: null, timestamp: new Date().toISOString(), isRealtime: false }],
        } }));
        await gotoAppPage(page, '/portfolios/holdings');
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        await expect(todayPnL(page)).toHaveText('$0');
        await expect(aaplToday(page)).toHaveText('—');
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

async function openImport(page: Page, csv = SAMPLE_CSV) {
    const trigger = page.getByRole('button', { name: 'Import CSV' }).first();
    await expect(async () => {
        await trigger.click();
        await expect(page.getByTestId('import-dialog')).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await page.getByLabel('CSV file').setInputFiles({ name: 'positions.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
}

test.describe('Holdings › Import CSV', () => {
    test('regression: a new account picked for the import is kept after Cancel and reopening', async ({ page }) => {
        // The Codex finding on PR #159: reopening switched the target to the
        // first account, with the preview still ready to import into it.
        await gotoAppPage(page, '/portfolios/holdings');
        test.skip((await page.getByTestId('holdings-empty').count()) > 0, 'needs an existing account to choose instead');
        await openImport(page, SAMPLE_CSV.replace('BAD TICKER,Nope,1,1\n', ''));
        const target = page.getByTestId('import-dialog').getByRole('combobox');
        await target.selectOption({ label: 'New account…' });
        await page.getByTestId('import-dialog').getByRole('button', { name: 'Cancel' }).click();
        await expect(page.getByTestId('import-dialog')).toBeHidden();

        await page.getByRole('button', { name: 'Import CSV' }).first().click();
        await expect(page.getByTestId('import-dialog')).toBeVisible();
        await expect(page.getByTestId('import-dialog').locator('select option:checked')).toHaveText('New account…');
    });

    test('previews what was read, flags rows it could not read, and skips totals', async ({ page }) => {
        await gotoAppPage(page, '/portfolios/holdings');
        await openImport(page);
        const preview = page.getByTestId('import-preview');
        await expect(preview).toContainText('2 positions ready, 1 row needs attention, 1 cash or total row skipped');
        await expect(preview.locator('tbody tr')).toHaveCount(2);
        await expect(preview.getByRole('list', { name: 'Rows not imported' })).toContainText('Line 5');
        await expect(page.getByRole('button', { name: 'Import 2 positions' })).toBeDisabled();
        await expect(preview.getByRole('alert')).toContainText('Fix the listed issues');
    });

    test('multiline descriptions and CASH securities preview and submit exactly, with no phantom holding', async ({ page }) => {
        let sent: unknown;
        await page.route('**/api/portfolio/import', async (route) => {
            sent = route.request().postDataJSON().rows;
            await route.fulfill({ status: 200, json: { data: { insert: 3, update: 0, unchanged: 0 } } });
        });
        await gotoAppPage(page, '/portfolios/holdings');
        await openImport(page, 'Symbol,Description,Quantity,Average Cost,Asset Type\r\nAAPL,"Apple\r\nINC,Whatever,10,100\r\n""quoted""",10,100,Stock\r\nCASH,Pathward,2,30,Stock\r\nCASHX,Fund,3,1,Mutual Fund\r\nCASH,Cash balance,100,1,Cash');
        const preview = page.getByTestId('import-preview');
        await expect(preview.locator('tbody tr')).toHaveCount(3);
        await expect(preview.locator('tbody tr').first().locator('td').first()).toHaveText('AAPL');
        await expect(preview.getByRole('list', { name: 'Rows not imported' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Import 3 positions' }).click();
        await expect(page.getByText('Imported 3 positions: 3 new, 0 updated.')).toBeVisible();
        expect(sent).toEqual([
            { symbol: 'AAPL', name: 'Apple\r\nINC,Whatever,10,100\r\n"quoted"', quantity: 10, avgCost: 100 },
            { symbol: 'CASH', name: 'Pathward', quantity: 2, avgCost: 30 },
            { symbol: 'CASHX', name: 'Fund', quantity: 3, avgCost: 1 },
        ]);
    });

    test('malformed multiline CSV blocks submission until a corrected file is uploaded', async ({ page }) => {
        let requests = 0;
        await page.route('**/api/portfolio/import', (route) => {
            requests++;
            return route.fulfill({ status: 500, json: { error: 'unexpected request' } });
        });
        await gotoAppPage(page, '/portfolios/holdings');
        await openImport(page, 'Symbol,Description,Quantity,Average Cost\nMSFT,Microsoft,2,300\nAAPL,"Apple\nINC,Whatever,10,100');
        await expect(page.getByTestId('import-preview')).toContainText('Line 3: Unterminated quoted field');
        await expect(page.getByRole('button', { name: 'Import 1 position', exact: true })).toBeDisabled();
        expect(requests).toBe(0);
        // Fixed in place and chosen again under the same name: the input was
        // cleared after the first read, so the browser fires change again.
        await expect(page.getByLabel('CSV file')).toHaveValue('');
        await page.getByLabel('CSV file').setInputFiles({ name: 'positions.csv', mimeType: 'text/csv', buffer: Buffer.from('Symbol,Description,Quantity,Average Cost\nAAPL,"Apple\nInc",10,100') });
        await expect(page.getByTestId('import-preview').getByRole('alert')).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Import 1 position', exact: true })).toBeEnabled();
        expect(requests).toBe(0);
    });

    test('sends exactly the previewed rows, then confirms', async ({ page }) => {
        let sent: { rows?: Array<{ symbol: string; quantity: number; avgCost: number }>; portfolioId?: string; newPortfolioName?: string } = {};
        await page.route('**/api/portfolio/import', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill({ status: 200, json: { data: { portfolioId: 'p', createdPortfolio: false, insert: 1, update: 1, unchanged: 0 } } });
        });
        await gotoAppPage(page, '/portfolios/holdings');
        await openImport(page, SAMPLE_CSV.replace('BAD TICKER,Nope,1,1\n', ''));
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
        await openImport(page, SAMPLE_CSV.replace('BAD TICKER,Nope,1,1\n', ''));
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

    test('regression: an oversized body is refused with 413', async ({ page }) => {
        await gotoAppPage(page, '/portfolios/holdings');
        const res = await page.request.post('/api/portfolio/import', {
            headers: { 'content-type': 'application/json' },
            data: JSON.stringify({ newPortfolioName: 'x', rows: [], pad: 'x'.repeat(300 * 1024) }),
        });
        expect(res.status()).toBe(413);
    });

    test('database: another user\'s account is a 404 and nothing is written', async ({ page }) => {
        test.skip(!dbMode, 'needs the seeded E2E database');
        await gotoAppPage(page, '/portfolios/holdings');
        const res = await page.request.post('/api/portfolio/import', {
            data: { portfolioId: '00000000-0000-4000-8000-000000000009', rows: [{ symbol: 'XUSR', quantity: 5, avgCost: 1 }] },
        });
        expect(res.status()).toBe(404);
    });

    test('regression: a position with no price yet is valued at cost, not $0', async ({ context, page }) => {
        // Launch item i41: with no market data, imported holdings showed $0.
        test.skip(!dbMode, 'needs the seeded E2E database');
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/portfolios/holdings');
        const res = await page.request.post('/api/portfolio/import', {
            data: { newPortfolioName: 'Unpriced', rows: [{ symbol: 'ZZZQ', name: 'No Price Co', quantity: 10, avgCost: 12.5 }] },
        });
        expect(res.status()).toBe(200);

        await gotoAppPage(page, '/portfolios/holdings');
        const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'ZZZQ', exact: false }) });
        await expect(row.getByTestId('holding-value')).toHaveText('$125 at cost');
        await expect(row).not.toContainText('$0');
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
