import { test, expect, type Page } from '@playwright/test';
import { gotoAppPage, reloadAppPage } from './helpers/app';
import { signInAsFreshUser } from './helpers/users';

const databaseAuthEnabled = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');
// User B's account, which no one else may see or change.
const OTHER_USERS_ACCOUNT = '00000000-0000-4000-8000-000000000009';

/**
 * Portfolio › Accounts (/portfolios/accounts). Replaces the retired
 * /portfolios page, which showed three hardcoded accounts. Without a
 * database (local e2e) the page must show an honest empty state, never
 * example balances.
 */
test.describe('Portfolio › Accounts', () => {
    test.beforeEach(async ({ page }) => {
        await gotoAppPage(page, '/portfolios/accounts');
    });

    test('renders under the Portfolio title with the Accounts tab selected', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Portfolio');
        await expect(
            page.getByRole('navigation', { name: 'Section' }).getByRole('link', { name: 'Accounts' }),
        ).toHaveAttribute('aria-current', 'page');
        await expect(page.getByTestId('accounts-view')).toBeVisible();
    });

    test('shows either real accounts or an empty state — never sample balances', async ({ page }) => {
        const table = page.getByTestId('accounts-table');
        const empty = page.getByTestId('accounts-empty');
        await expect(table.or(empty)).toBeVisible();
        await expect(page.getByText('Main Investment Account')).toHaveCount(0);
        await expect(page.getByText('$1,100,601.39')).toHaveCount(0);
    });

    test('empty state links to connecting an account, and offers to add one', async ({ page }) => {
        const empty = page.getByTestId('accounts-empty');
        test.skip(!(await empty.isVisible()), 'database has accounts');
        await expect(empty.getByRole('link', { name: 'Connect an account' })).toHaveAttribute('href', '/settings#accounts');
        await expect(empty.getByRole('button', { name: 'New account' })).toBeVisible();
    });
});

function row(page: Page, name: string) {
    return page.getByTestId('accounts-table').getByRole('row').filter({ hasText: name });
}

async function fillAccount(page: Page, { name, description, cash }: { name?: string; description?: string; cash?: string }) {
    const dialog = page.getByRole('dialog');
    if (name !== undefined) await dialog.getByLabel('Name').fill(name);
    if (description !== undefined) await dialog.getByLabel('Description (optional)').fill(description);
    if (cash !== undefined) await dialog.getByLabel('Cash ($)').fill(cash);
    return dialog;
}

// Launch item i41: add, edit and delete accounts.
test.describe('Portfolio › Accounts — managing accounts', () => {
    test.skip(!databaseAuthEnabled, 'requires the database-auth E2E mode');

    test.beforeEach(async ({ context, page }) => {
        // Each test changes accounts: a user of its own.
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/portfolios/accounts');
    });

    test('a new account appears with its cash, and is still there after a reload', async ({ page }) => {
        await page.getByRole('button', { name: 'New account' }).click();
        const dialog = await fillAccount(page, { name: 'Roth IRA', description: 'Fidelity', cash: '2,500.00' });
        await dialog.getByRole('button', { name: 'Add account' }).click();
        await expect(dialog).toBeHidden();
        await expect(row(page, 'Roth IRA')).toContainText('$2,500');
        await expect(row(page, 'Roth IRA')).toContainText('Fidelity');

        await reloadAppPage(page);
        await expect(row(page, 'Roth IRA')).toContainText('$2,500');
    });

    test('an account can be renamed and its cash changed', async ({ page }) => {
        await page.getByRole('button', { name: 'Actions for Dividend Income' }).click();
        await page.getByRole('menuitem', { name: 'Edit' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByLabel('Name')).toHaveValue('Dividend Income');
        await fillAccount(page, { name: 'Dividends', cash: '4000' });
        await dialog.getByRole('button', { name: 'Save changes' }).click();
        await expect(dialog).toBeHidden();
        await expect(row(page, 'Dividends')).toContainText('$4,000');
        await expect(row(page, 'Dividend Income')).toHaveCount(0);
    });

    test('a bad entry is explained in the form', async ({ page }) => {
        await page.getByRole('button', { name: 'New account' }).click();
        const dialog = await fillAccount(page, { name: 'Brokerage', cash: 'lots' });
        await dialog.getByRole('button', { name: 'Add account' }).click();
        await expect(dialog.getByTestId('account-form-error')).toHaveText('Cash must be a number, such as 2500 or 2,500.00.');
        await fillAccount(page, { name: '<b>Brokerage</b>', cash: '' });
        await dialog.getByRole('button', { name: 'Add account' }).click();
        await expect(dialog.getByTestId('account-form-error')).toHaveText('Input contains invalid characters (< or >)');
    });

    test('deleting an account takes its positions with it, after asking', async ({ page }) => {
        const dialogs: string[] = [];
        page.on('dialog', (dialog) => {
            dialogs.push(dialog.message());
            void dialog.accept();
        });
        await page.getByRole('button', { name: 'Actions for Main Portfolio' }).click();
        await page.getByRole('menuitem', { name: 'Delete account' }).click();
        await expect(row(page, 'Main Portfolio')).toHaveCount(0);
        expect(dialogs[0]).toContain('Delete Main Portfolio? Its 6 positions, transactions and value history go with it.');

        await gotoAppPage(page, '/portfolios/holdings');
        await expect(page.getByRole('cell', { name: 'NVDA', exact: true })).toHaveCount(0);
    });

    test('the API changes only your own accounts', async ({ page, playwright }) => {
        const created = await page.request.post('/api/portfolios', { data: { name: 'API account', cashBalance: 10 } });
        expect(created.status()).toBe(201);
        const { data } = await created.json();
        expect(data).toMatchObject({ name: 'API account', description: null, cashBalance: 10 });

        const renamed = await page.request.patch(`/api/portfolios/${data.id}`, { data: { name: 'Renamed' } });
        expect((await renamed.json()).data.name).toBe('Renamed');

        expect((await page.request.post('/api/portfolios', { data: { name: '' } })).status()).toBe(400);
        expect((await page.request.post('/api/portfolios', { data: { name: 'A', userId: 'someone-else' } })).status()).toBe(400);
        expect((await page.request.patch(`/api/portfolios/${data.id}`, { data: {} })).status()).toBe(400);

        // Another user's account is not found, and stays as it was.
        for (const response of [
            await page.request.patch(`/api/portfolios/${OTHER_USERS_ACCOUNT}`, { data: { name: 'Taken over' } }),
            await page.request.delete(`/api/portfolios/${OTHER_USERS_ACCOUNT}`),
            await page.request.delete('/api/portfolios/not-a-uuid'),
        ]) {
            expect(response.status()).toBe(404);
            expect((await response.json()).code).toBe('PORTFOLIO_NOT_FOUND');
        }

        expect((await page.request.delete(`/api/portfolios/${data.id}`)).status()).toBe(204);
        expect((await page.request.delete(`/api/portfolios/${data.id}`)).status()).toBe(404);

        // A request context of its own: the page's background requests keep
        // setting the session cookie on the shared one.
        const anonymous = await playwright.request.newContext({
            baseURL: 'http://localhost:3000',
            storageState: { cookies: [], origins: [] },
        });
        expect((await anonymous.post('/api/portfolios', { data: { name: 'Anonymous' } })).status()).toBe(401);
        expect((await anonymous.patch(`/api/portfolios/${OTHER_USERS_ACCOUNT}`, { data: { name: 'x' } })).status()).toBe(401);
        expect((await anonymous.delete(`/api/portfolios/${OTHER_USERS_ACCOUNT}`)).status()).toBe(401);
        await anonymous.dispose();
    });
});

