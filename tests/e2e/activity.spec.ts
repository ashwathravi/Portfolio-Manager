import { test, expect, type Page } from '@playwright/test';
import { gotoAppPage, reloadAppPage } from './helpers/app';
import { signInAsFreshUser } from './helpers/users';

const databaseAuthEnabled = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');
// User B's account and transaction, which no one else may touch.
const OTHER_USERS_ACCOUNT = '00000000-0000-4000-8000-000000000009';
const OTHER_USERS_TRANSACTION = '00000000-0000-4000-8000-000000000209';

/**
 * Portfolio › Activity (/portfolios/activity). Replaces the retired
 * trade log. Rows come from the transactions table; without a database
 * the page shows an empty state instead of the old hardcoded trades.
 */
test.describe('Portfolio › Activity', () => {
    test.beforeEach(async ({ page }) => {
        await gotoAppPage(page, '/portfolios/activity');
    });

    test('renders under the Portfolio title with the Activity tab selected', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Portfolio');
        await expect(
            page.getByRole('navigation', { name: 'Section' }).getByRole('link', { name: 'Activity' }),
        ).toHaveAttribute('aria-current', 'page');
        await expect(page.getByTestId('activity-view')).toBeVisible();
    });

    test('shows real transactions or an empty state — never the old mock trades', async ({ page }) => {
        await expect(page.getByTestId('activity-table').or(page.getByTestId('activity-empty'))).toBeVisible();
        await expect(page.getByText('Fidelity Individual')).toHaveCount(0);
    });

    test('without an account, adding transactions points at adding one first', async ({ page }) => {
        const empty = page.getByTestId('activity-empty');
        test.skip(!(await empty.isVisible()), 'this database has transactions');
        const addFirst = empty.getByRole('link', { name: 'Add an account first' });
        const add = empty.getByRole('button', { name: 'Add transaction' });
        await expect(addFirst.or(add)).toBeVisible();
        if (await addFirst.isVisible()) await expect(addFirst).toHaveAttribute('href', '/portfolios/accounts');
    });

    test('when transactions exist, side filters narrow the table', async ({ page }) => {
        const table = page.getByTestId('activity-table');
        test.skip(!(await table.isVisible()), 'no transactions in this database');
        await page.getByRole('group', { name: 'Side' }).getByRole('button', { name: 'Sells' }).click();
        const sides = await table.locator('.pm-side').allTextContents();
        expect(sides.every((s) => s === 'SELL')).toBe(true);
    });
});

function activityRow(page: Page, text: string) {
    return page.getByTestId('activity-table').getByRole('row').filter({ hasText: text });
}

const CSV = [
    'Brokerage history',
    'Run Date,Action,Symbol,Security Description,Quantity,Price ($),Fees ($),Amount ($)',
    '03/05/2026,YOU BOUGHT ADVANCED MICRO (AMD),AMD,ADVANCED MICRO DEVICES,10,150,0.05,-1500.05',
    '03/10/2026,DIVIDEND RECEIVED MICROSOFT (MSFT),MSFT,MICROSOFT CORP,,,,7.50',
    '03/12/2026,Electronic Funds Transfer Received,,Payroll,,,,2500',
].join('\n');

// Launch item i40: transactions added by hand, from a CSV, and deleted.
test.describe('Portfolio › Activity — recording transactions', () => {
    test.skip(!databaseAuthEnabled, 'requires the database-auth E2E mode');

    test.beforeEach(async ({ context, page }) => {
        // Each test adds or deletes transactions: a user of its own.
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/portfolios/activity');
    });

    test('a buy entered by hand appears with its value and fees, and stays after a reload', async ({ page }) => {
        await page.getByRole('button', { name: 'Add transaction' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Type').selectOption('BUY');
        await dialog.getByLabel('Date').fill('2026-03-05');
        await dialog.getByLabel('Symbol').fill('crm');
        await dialog.getByLabel('Quantity').fill('3');
        await dialog.getByLabel('Price ($)').fill('250.50');
        await dialog.getByLabel('Fees ($, optional)').fill('1.25');
        await dialog.getByLabel('Note (optional)').fill('Starter position');
        await dialog.getByRole('button', { name: 'Add buy' }).click();
        await expect(dialog).toBeHidden();

        const row = activityRow(page, 'Starter position');
        await expect(row).toContainText('CRM');
        await expect(row).toContainText('$751.50');
        await expect(row).toContainText('$1.25');
        await reloadAppPage(page);
        await expect(activityRow(page, 'Starter position')).toContainText('CRM');
    });

    test('a deposit takes an amount, and a buy without a price is explained', async ({ page }) => {
        await page.getByRole('button', { name: 'Add transaction' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Symbol').fill('AAPL');
        await dialog.getByLabel('Quantity').fill('1');
        await dialog.getByRole('button', { name: 'Add buy' }).click();
        await expect(dialog.getByTestId('transaction-form-error')).toHaveText('Enter the quantity and price.');

        await dialog.getByLabel('Type').selectOption('DEPOSIT');
        await expect(dialog.getByLabel('Symbol')).toHaveCount(0);
        await dialog.getByLabel('Amount ($)').fill('2,000');
        await dialog.getByLabel('Note (optional)').fill('Monthly saving');
        await dialog.getByRole('button', { name: 'Add deposit' }).click();
        await expect(dialog).toBeHidden();
        await expect(activityRow(page, 'Monthly saving')).toContainText('DEPOSIT');
        await expect(activityRow(page, 'Monthly saving')).toContainText('$2,000');
    });

    test('a broker CSV imports once: importing it again adds nothing', async ({ page }) => {
        const importOnce = async () => {
            await page.getByRole('button', { name: 'Import CSV' }).click();
            const dialog = page.getByTestId('transactions-import-dialog');
            await dialog.getByLabel('CSV file').setInputFiles({ name: 'history.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
            await expect(dialog.getByTestId('transactions-import-preview')).toContainText('3 transactions ready');
            await dialog.getByRole('button', { name: 'Import 3 transactions' }).click();
            await expect(dialog).toBeHidden();
        };
        await importOnce();
        await expect(page.getByText('Imported 3 transactions.')).toBeVisible();
        // The trade's value (10 × $150) and its fees apart, not the CSV's net amount.
        await expect(activityRow(page, 'ADVANCED MICRO DEVICES')).toContainText('$1,500.00');
        await expect(activityRow(page, 'ADVANCED MICRO DEVICES')).toContainText('$0.05');
        await expect(activityRow(page, 'MICROSOFT CORP')).toContainText('DIVIDEND');
        await expect(activityRow(page, 'Payroll')).toContainText('DEPOSIT');

        await importOnce();
        await expect(page.getByText('Imported 0 transactions; 3 were already there.')).toBeVisible();
        await expect(activityRow(page, 'ADVANCED MICRO DEVICES')).toHaveCount(1);
    });

    test('a trade in another currency stays in it: its row, and Bought totalled apart from dollars', async ({ page }) => {
        // Codex findings on PR #154: CAD added into the dollar totals, and a
        // gross Value column had the fees taken off it.
        await page.getByRole('button', { name: 'Import CSV' }).click();
        const dialog = page.getByTestId('transactions-import-dialog');
        const unreadable = 'Date,Action,Symbol,Quantity,Value,Currency\n2026-03-05,Buy,SHOP,10,1000,CA$';
        await dialog.getByLabel('CSV file').setInputFiles({ name: 'cad.csv', mimeType: 'text/csv', buffer: Buffer.from(unreadable) });
        await expect(dialog.getByRole('list', { name: 'Rows not imported' })).toContainText('Line 2: “CA$” in currency is not a currency code');

        const cad = 'Date,Action,Symbol,Security Description,Quantity,Value,Fees,Currency\n2026-03-05,Buy,SHOP,SHOPIFY INC CAD,10,1000,1,CAD';
        await dialog.getByLabel('CSV file').setInputFiles({ name: 'cad.csv', mimeType: 'text/csv', buffer: Buffer.from(cad) });
        await dialog.getByRole('button', { name: 'Import 1 transaction' }).click();
        await expect(dialog).toBeHidden();

        const row = activityRow(page, 'SHOPIFY INC CAD');
        await expect(row).toContainText('100.00 CAD');
        await expect(row).toContainText('1,000.00 CAD');
        await expect(row).toContainText('1.00 CAD');
        // The fixture user's buys are in dollars; the CAD buy is added beside them.
        await expect(page.getByTestId('activity-bought')).toHaveText(/^\$[\d,]+ \+ 1,000 CAD$/);
    });

    test("a CSV with rows it can't read lists them and imports nothing", async ({ page }) => {
        await page.getByRole('button', { name: 'Import CSV' }).click();
        const dialog = page.getByTestId('transactions-import-dialog');
        const bad = 'Date,Action,Symbol,Quantity,Price\n2026-03-05,Journal,AAPL,1,10\n2026-03-06,Buy,AAPL,1,10';
        await dialog.getByLabel('CSV file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(bad) });
        await expect(dialog.getByRole('list', { name: 'Rows not imported' })).toContainText("Line 2: Can't tell what “Journal” is");
        await expect(dialog.getByRole('button', { name: 'Import 1 transaction' })).toBeDisabled();
    });

    test('a transaction can be deleted, after asking', async ({ page }) => {
        page.once('dialog', (dialog) => void dialog.accept());
        const row = activityRow(page, 'User A fixture');
        await row.getByRole('button', { name: /^Delete Buy AAPL on / }).click();
        await expect(activityRow(page, 'User A fixture')).toHaveCount(0);
    });

    test('the API writes only to your own accounts', async ({ page, playwright }) => {
        const buy = { type: 'BUY', date: '2026-03-05', symbol: 'AAPL', quantity: 1, price: 10 };
        const noPrice = await page.request.post('/api/transactions', { data: { portfolioId: OTHER_USERS_ACCOUNT, transaction: { ...buy, price: undefined } } });
        expect(noPrice.status()).toBe(400);
        expect((await noPrice.json()).error).toBe('Buys and sells need a quantity and a price');

        for (const response of [
            await page.request.post('/api/transactions', { data: { portfolioId: OTHER_USERS_ACCOUNT, transaction: buy } }),
            await page.request.post('/api/transactions/import', { data: { portfolioId: OTHER_USERS_ACCOUNT, rows: [buy] } }),
        ]) {
            expect(response.status()).toBe(404);
            expect((await response.json()).code).toBe('PORTFOLIO_NOT_FOUND');
        }
        const notYours = await page.request.delete(`/api/transactions/${OTHER_USERS_TRANSACTION}`);
        expect(notYours.status()).toBe(404);
        expect((await notYours.json()).code).toBe('TRANSACTION_NOT_FOUND');

        const badRow = await page.request.post('/api/transactions/import', {
            data: { portfolioId: OTHER_USERS_ACCOUNT, rows: [buy, { ...buy, date: 'soon' }] },
        });
        expect(badRow.status()).toBe(400);
        expect((await badRow.json()).error).toBe('Row 2: date must be a date (YYYY-MM-DD)');

        const anonymous = await playwright.request.newContext({
            baseURL: 'http://localhost:3000',
            storageState: { cookies: [], origins: [] },
        });
        expect((await anonymous.post('/api/transactions', { data: { portfolioId: OTHER_USERS_ACCOUNT, transaction: buy } })).status()).toBe(401);
        expect((await anonymous.post('/api/transactions/import', { data: { portfolioId: OTHER_USERS_ACCOUNT, rows: [buy] } })).status()).toBe(401);
        expect((await anonymous.delete(`/api/transactions/${OTHER_USERS_TRANSACTION}`)).status()).toBe(401);
        await anonymous.dispose();
    });
});

