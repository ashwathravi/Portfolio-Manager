import { test, expect, type Locator, type Page } from '@playwright/test';
import { gotoAppPage, reloadAppPage } from './helpers/app';
import { e2eDatabase, signInAsFreshUser, signInAsNewUser } from './helpers/users';

const databaseAuthEnabled = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');
// User B's account, which no one else may see or change.
const OTHER_USERS_ACCOUNT = '00000000-0000-4000-8000-000000000009';
// User B's one other asset ("Other User Asset Sentinel"), the same.
const OTHER_USERS_ITEM = '00000000-0000-4000-8000-000000000701';

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

    test('regression (x30): without bank linking, the empty state offers to add an account by hand first, not a Connect link that loops', async ({ context, page }) => {
        // E2E runs without Plaid's keys, as production does until they're
        // set: Settings says bank linking isn't set up and points back here,
        // so "Connect an account" went round in a circle. With a database,
        // a user with no accounts yet (fixture user A has some).
        if (await signInAsNewUser(context)) await gotoAppPage(page, '/portfolios/accounts');
        const empty = page.getByTestId('accounts-empty');
        await expect(empty).toContainText('Accounts appear here once you add one yourself or import positions.');
        await expect(empty.getByRole('link', { name: 'Connect an account' })).toHaveCount(0);
        await expect(empty.locator('a[href^="/settings"]')).toHaveCount(0);
        await expect(empty.getByRole('button', { name: 'New account' })).toHaveClass(/pm-btn-primary/);
        await expect(empty.getByRole('link', { name: 'Import a CSV' })).toHaveAttribute('href', '/portfolios/holdings');
    });

    test('x30: a new user adds an account by hand from the empty state', async ({ context, page }) => {
        test.skip(!databaseAuthEnabled, 'requires the database-auth E2E mode');
        await signInAsNewUser(context);
        await gotoAppPage(page, '/portfolios/accounts');
        await page.getByTestId('accounts-empty').getByRole('button', { name: 'New account' }).click();
        const dialog = await fillAccount(page, { name: 'Brokerage', cash: '500' });
        await dialog.getByRole('button', { name: 'Add account' }).click();
        await expect(dialog).toBeHidden();
        await expect(row(page, 'Brokerage')).toContainText('$500');
        await expect(page.getByTestId('accounts-empty')).toHaveCount(0);
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

/** Opens the account's Edit dialog, makes `change` in it, and saves. */
async function editAccount(page: Page, name: string, change: (dialog: Locator) => Promise<void>) {
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Name')).toHaveValue(name);
    await change(dialog);
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();
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

    test("an account's type, institution, tax treatment and ownership are kept, shown under its name, and can be cleared", async ({ page }) => {
        await page.getByRole('button', { name: 'New account' }).click();
        const dialog = await fillAccount(page, { name: 'Old 401k' });
        await expect(dialog.getByLabel('Ownership (optional)')).toHaveValue('');
        await dialog.getByLabel('Type (optional)').selectOption({ label: '401(k)' });
        // Picking a kind suggests how it's usually taxed and held, before anything is saved.
        await expect(dialog.getByLabel('Tax treatment (optional)')).toHaveValue('tax_deferred');
        await expect(dialog.getByLabel('Ownership (optional)')).toHaveValue('individual');
        await dialog.getByLabel('Institution (optional)').fill('Vanguard');
        await dialog.getByRole('button', { name: 'Add account' }).click();
        await expect(dialog).toBeHidden();
        await expect(row(page, 'Old 401k').getByTestId('account-kind')).toHaveText('401(k) · Vanguard · Individual');

        await reloadAppPage(page);
        await editAccount(page, 'Old 401k', async (edit) => {
            await expect(edit.getByLabel('Tax treatment (optional)')).toHaveValue('tax_deferred');
            await expect(edit.getByLabel('Ownership (optional)')).toHaveValue('individual');
            await edit.getByLabel('Type (optional)').selectOption('');
            await edit.getByLabel('Institution (optional)').fill('');
            await edit.getByLabel('Ownership (optional)').selectOption('');
        });
        await expect(row(page, 'Old 401k').getByTestId('account-kind')).toHaveCount(0);
    });

    test("the accounts' value is split by tax treatment and by ownership once any account has one, and the rest are Not set", async ({ page }) => {
        /** Each group's accounts, under its value. */
        const accountsOf = (strip: Locator, key: string) => strip.locator(`[data-group="${key}"]`).getByTestId('account-group-accounts');
        /** A split's labels in order, then each group's value and the accounts it names. */
        async function expectSplit(id: string, groups: [key: string, label: string, value: string, accounts: string][]) {
            const strip = page.getByTestId(id);
            await expect(strip.locator('dt')).toHaveText(groups.map(([, label]) => label));
            for (const [key, , value, accounts] of groups) {
                await expect(strip.locator(`[data-group="${key}"] dd`).first()).toContainText(value);
                await expect(accountsOf(strip, key)).toHaveText(accounts);
                // On screen, not in a tooltip a keyboard or a phone can't open,
                // nor clipped to the pixel a screen-reader-only line gets.
                expect((await accountsOf(strip, key).boundingBox())?.height ?? 0).toBeGreaterThan(1);
            }
        }
        async function expectBothSplits() {
            // Main Portfolio says neither, so Not set is its value, as its row shows it.
            const main = (await row(page, 'Main Portfolio').locator('td').nth(1).innerText()).trim();
            expect(main).toMatch(/^\$[\d,]+\.\d\d$/);
            await expectSplit('accounts-by-tax', [
                ['tax_deferred', 'Tax-deferred', '$5,240.00', 'Growth Portfolio'],
                ['tax_free', 'Tax-free', '$3,120.00', 'Dividend Income'],
                ['not_set', 'Not set', main, 'Main Portfolio'],
            ]);
            await expectSplit('accounts-by-ownership', [
                ['joint', 'Joint', '$5,240.00', 'Growth Portfolio'],
                ['dependent', 'For a dependent', '$3,120.00', 'Dividend Income'],
                ['not_set', 'Not set', main, 'Main Portfolio'],
            ]);
        }

        // Three accounts and none says either: a line on how, and no split.
        await expect(page.getByTestId('accounts-groups-hint')).toBeVisible();
        await expect(page.getByTestId('accounts-by-tax')).toHaveCount(0);
        await expect(page.getByTestId('accounts-by-ownership')).toHaveCount(0);

        await editAccount(page, 'Growth Portfolio', async (dialog) => {
            await dialog.getByLabel('Tax treatment (optional)').selectOption({ label: 'Tax-deferred' });
            await dialog.getByLabel('Ownership (optional)').selectOption({ label: 'Joint' });
        });
        await editAccount(page, 'Dividend Income', async (dialog) => {
            await dialog.getByLabel('Tax treatment (optional)').selectOption({ label: 'Tax-free' });
            await dialog.getByLabel('Ownership (optional)').selectOption({ label: 'For a dependent' });
        });
        await expect(row(page, 'Growth Portfolio').getByTestId('account-kind')).toHaveText('Joint');
        await expect(row(page, 'Dividend Income').getByTestId('account-kind')).toHaveText('For a dependent');
        await expect(page.getByTestId('accounts-groups-hint')).toHaveCount(0);
        await expectBothSplits();

        await reloadAppPage(page);
        await expectBothSplits();

        await editAccount(page, 'Growth Portfolio', async (dialog) => {
            await dialog.getByLabel('Ownership (optional)').selectOption('');
        });
        await expect(row(page, 'Growth Portfolio').getByTestId('account-kind')).toHaveCount(0);
        const ownership = page.getByTestId('accounts-by-ownership');
        await expect(ownership.locator('dt')).toHaveText(['For a dependent', 'Not set']);
        await expect(accountsOf(ownership, 'not_set')).toHaveText('Main Portfolio, Growth Portfolio');
        // Growth keeps its tax treatment.
        await expect(page.getByTestId('accounts-by-tax').locator('dt')).toHaveText(['Tax-deferred', 'Tax-free', 'Not set']);

        // The strips fit a phone's width.
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(async () => {
            const overflow = await page.evaluate(() => {
                const main = document.querySelector('main');
                return Math.max(
                    document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    main ? main.scrollWidth - main.clientWidth : 0,
                );
            });
            expect(overflow).toBeLessThanOrEqual(1);
        }).toPass({ timeout: 5_000 });
        // And a phone, with no hover, still sees which accounts a group holds.
        expect((await accountsOf(ownership, 'not_set').boundingBox())?.height ?? 0).toBeGreaterThan(1);
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

    test('a name already in use, in any case, is refused by the form, a rename and an import', async ({ page }) => {
        await page.getByRole('button', { name: 'New account' }).click();
        const dialog = await fillAccount(page, { name: ' main portfolio ' });
        await dialog.getByRole('button', { name: 'Add account' }).click();
        await expect(dialog.getByTestId('account-form-error')).toHaveText('You already have an account named main portfolio.');
        await expect(dialog).toBeVisible();

        const created = await page.request.post('/api/portfolios', { data: { name: 'Taxable' } });
        expect(created.status()).toBe(201);
        const { id } = (await created.json()).data;
        const taken = await page.request.patch(`/api/portfolios/${id}`, { data: { name: 'GROWTH PORTFOLIO' } });
        expect(taken.status()).toBe(409);
        expect((await taken.json()).code).toBe('DUPLICATE_ACCOUNT_NAME');
        // Its own name, recased, and a cash change that resends it are fine.
        expect((await page.request.patch(`/api/portfolios/${id}`, { data: { name: 'TAXABLE' } })).status()).toBe(200);
        expect((await page.request.patch(`/api/portfolios/${id}`, { data: { name: 'TAXABLE', cashBalance: 5 } })).status()).toBe(200);

        const before = (await (await page.request.get('/api/portfolios/count')).json()).count;
        const imported = await page.request.post('/api/portfolio/import', {
            data: { newPortfolioName: 'Main Portfolio', rows: [{ symbol: 'MSFT', quantity: 1, avgCost: 1 }] },
        });
        expect(imported.status()).toBe(409);
        expect((await imported.json()).code).toBe('DUPLICATE_ACCOUNT_NAME');
        expect((await (await page.request.get('/api/portfolios/count')).json()).count).toBe(before);
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
        expect(dialogs[0]).toContain('Delete Main Portfolio? Its 6 positions, transactions, drafted orders, option positions and value history go with it.');

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

        // Whose name an account is in: one from the list, or none.
        const joint = await page.request.post('/api/portfolios', { data: { name: 'Joint brokerage', ownership: 'joint' } });
        expect(joint.status()).toBe(201);
        const jointAccount = (await joint.json()).data;
        expect(jointAccount.ownership).toBe('joint');
        const unset = await page.request.patch(`/api/portfolios/${jointAccount.id}`, { data: { ownership: null } });
        expect(unset.status()).toBe(200);
        expect((await unset.json()).data.ownership).toBeNull();
        const partner = await page.request.patch(`/api/portfolios/${jointAccount.id}`, { data: { ownership: 'partner' } });
        expect(partner.status()).toBe(400);
        expect(await partner.json()).toMatchObject({ code: 'INVALID_PORTFOLIO', error: 'Choose whose account it is' });

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


// Other assets and debts: what the user owns and owes outside their
// accounts, which Today adds up as the net worth.
test.describe('Portfolio › Accounts — other assets and debts', () => {
    test.skip(!databaseAuthEnabled, 'requires the database-auth E2E mode');

    const HOME = { kind: 'asset', category: 'property', name: 'Home', value: 300_000, valueAsOf: '2026-11-01' };
    let userId = '';

    test.beforeEach(async ({ context }) => {
        // Each test adds its own: a user of its own, with nothing yet.
        userId = (await signInAsNewUser(context, { firstSignIn: true })) ?? '';
    });

    /** A "Brokerage" account with $1,000 of cash, made through the API. */
    async function brokerage(page: Page) {
        const created = await page.request.post('/api/portfolios', { data: { name: 'Brokerage', cashBalance: 1_000 } });
        expect(created.status()).toBe(201);
    }
    const card = (page: Page) => page.getByTestId('net-worth-items');
    const item = (page: Page, name: string) => page.getByTestId('net-worth-items-table').getByRole('row').filter({ hasText: name });
    /** The figure under a label in the card's strip. */
    const figure = (page: Page, label: string) => page.getByTestId('net-worth-summary').locator('div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd');

    async function add(page: Page, kind: 'asset' | 'debt', fields: { type?: string; name?: string; value?: string; asOf?: string; note?: string }) {
        await card(page).getByRole('button', { name: kind === 'asset' ? 'Add asset' : 'Add debt' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('heading', { name: kind === 'asset' ? 'Add an asset' : 'Add a debt' })).toBeVisible();
        if (fields.type !== undefined) await dialog.getByLabel('Type').selectOption({ label: fields.type });
        if (fields.name !== undefined) await dialog.getByLabel('Name').fill(fields.name);
        if (fields.value !== undefined) await dialog.getByLabel(kind === 'asset' ? 'Value ($)' : 'Balance owed ($)').fill(fields.value);
        if (fields.asOf !== undefined) await dialog.getByLabel('As of').fill(fields.asOf);
        if (fields.note !== undefined) await dialog.getByLabel('Note (optional)').fill(fields.note);
        await dialog.getByRole('button', { name: kind === 'asset' ? 'Add asset' : 'Add debt' }).click();
        return dialog;
    }

    test('an asset and a debt added from the card are totalled with the accounts, and still there after a reload', async ({ page }) => {
        await brokerage(page);
        await gotoAppPage(page, '/portfolios/accounts');
        await expect(card(page)).toContainText('What you own and owe outside your accounts');

        // The name starts as the type until one is typed.
        await card(page).getByRole('button', { name: 'Add asset' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByLabel('Name')).toHaveValue('Home or property');
        await dialog.getByLabel('Type').selectOption({ label: 'Vehicle' });
        await expect(dialog.getByLabel('Name')).toHaveValue('Vehicle');
        await dialog.getByRole('button', { name: 'Cancel' }).click();

        await expect(await add(page, 'asset', { type: 'Home or property', name: 'Home', value: '300,000', asOf: '2026-11-01', note: 'Estimate' })).toBeHidden();
        await expect(page.getByText('Home added.')).toBeVisible();
        await expect(await add(page, 'debt', { value: '200000', asOf: '2026-10-15' })).toBeHidden();

        for (const reloaded of [false, true]) {
            if (reloaded) await reloadAppPage(page);
            await expect(item(page, 'Home')).toContainText('Home or property');
            await expect(item(page, 'Home')).toContainText('$300,000.00');
            await expect(item(page, 'Home')).toContainText('Estimate');
            await expect(item(page, 'Home')).toContainText('Nov 1, 2026');
            // The debt's name was left as its type.
            await expect(item(page, 'Mortgage')).toContainText('−$200,000.00');
            await expect(item(page, 'Mortgage')).toContainText('Oct 15, 2026');
            // A debt is owed, not a loss: never in red.
            await expect(card(page).locator('.pm-neg')).toHaveCount(0);
            await expect(card(page)).toContainText('1 asset and 1 debt, at the values and dates you gave');
            await expect(figure(page, 'Your accounts')).toHaveText('$1,000.00');
            await expect(figure(page, 'Other assets')).toHaveText('$300,000.00');
            await expect(figure(page, 'Debts')).toHaveText('−$200,000.00');
            await expect(figure(page, 'Net worth')).toHaveText('$101,000.00');
        }

        // Another user's item is never among them.
        await expect(page.getByText('Other User Asset Sentinel')).toHaveCount(0);

        // The card fits a phone's width: its table scrolls inside it.
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(async () => {
            const overflow = await page.evaluate(() => {
                const main = document.querySelector('main');
                return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, main ? main.scrollWidth - main.clientWidth : 0);
            });
            expect(overflow).toBeLessThanOrEqual(1);
        }).toPass({ timeout: 5_000 });
    });

    test('an item\'s value and date are updated, keeping the earlier value; deleting one asks first', async ({ page }) => {
        await brokerage(page);
        for (const data of [HOME, { kind: 'debt', category: 'auto_loan', name: 'Car loan', value: 12_000, valueAsOf: '2026-11-01' }]) {
            expect((await page.request.post('/api/portfolio/net-worth-items', { data })).status()).toBe(201);
        }
        await gotoAppPage(page, '/portfolios/accounts');

        await page.getByRole('button', { name: 'Actions for Home' }).click();
        await page.getByRole('menuitem', { name: 'Update' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('heading', { name: 'Update Home' })).toBeVisible();
        await expect(dialog.getByLabel('Value ($)')).toHaveValue('300000');
        await dialog.getByLabel('Value ($)').fill('320,000');
        await dialog.getByLabel('As of').fill('2026-11-20');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByText('Home updated.')).toBeVisible();
        await expect(item(page, 'Home')).toContainText('$320,000.00');
        await expect(item(page, 'Home')).toContainText('Nov 20, 2026');
        await expect(figure(page, 'Net worth')).toHaveText('$309,000.00');
        // Each value is kept as of its day.
        const values = await e2eDatabase()<{ date: string; value: string }[]>`
            SELECT to_char(v.date, 'YYYY-MM-DD') AS date, v.value::text AS value
            FROM net_worth_item_values v JOIN net_worth_items i ON i.id = v.net_worth_item_id
            WHERE i.user_id = ${userId} AND i.name = 'Home'
            ORDER BY v.date`;
        expect(values.map((v) => [v.date, Number(v.value)])).toEqual([['2026-11-01', 300_000], ['2026-11-20', 320_000]]);

        const asked: string[] = [];
        page.on('dialog', (confirm) => {
            asked.push(confirm.message());
            void confirm.accept();
        });
        await page.getByRole('button', { name: 'Actions for Car loan' }).click();
        await page.getByRole('menuitem', { name: 'Delete' }).click();
        await expect(item(page, 'Car loan')).toHaveCount(0);
        expect(asked).toEqual(['Delete Car loan? It stops counting in your net worth.']);
        await expect(figure(page, 'Debts')).toHaveText('$0.00');
        await expect(figure(page, 'Net worth')).toHaveText('$321,000.00');
        await expect(card(page)).toContainText('1 asset, at the value and date you gave');

        await page.getByRole('button', { name: 'Actions for Home' }).click();
        await page.getByRole('menuitem', { name: 'Delete' }).click();
        await expect(page.getByTestId('net-worth-items-table')).toHaveCount(0);
        await expect(page.getByTestId('net-worth-summary')).toHaveCount(0);
        await expect(card(page)).toContainText('Add one and Today shows your net worth.');
    });

    test('a new name or note keeps the value\'s date and adds no value; a new value is as of today until another day is given', async ({ page }) => {
        // A day that can't be today, so a value dated anew would show.
        const asOf = '2025-06-30';
        expect((await page.request.post('/api/portfolio/net-worth-items', { data: { ...HOME, valueAsOf: asOf } })).status()).toBe(201);
        await gotoAppPage(page, '/portfolios/accounts');
        // The dialog's today: the browser's own date.
        const today = await page.evaluate(() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        });
        const values = async () => (await e2eDatabase()<{ date: string; value: string }[]>`
            SELECT to_char(v.date, 'YYYY-MM-DD') AS date, v.value::text AS value
            FROM net_worth_item_values v JOIN net_worth_items i ON i.id = v.net_worth_item_id
            WHERE i.user_id = ${userId}
            ORDER BY v.date`).map((v) => [v.date, Number(v.value)]);

        await page.getByRole('button', { name: 'Actions for Home' }).click();
        await page.getByRole('menuitem', { name: 'Update' }).click();
        const dialog = page.getByRole('dialog');
        const date = dialog.getByLabel('As of');
        await expect(date).toHaveValue(asOf);
        // A new value is as of today; put back, it's the item's own day again.
        await dialog.getByLabel('Value ($)').fill('320,000');
        await expect(date).toHaveValue(today);
        await dialog.getByLabel('Value ($)').fill('300,000');
        await expect(date).toHaveValue(asOf);
        await dialog.getByLabel('Name').fill('Lake house');
        await dialog.getByLabel('Note (optional)').fill('Appraised in June');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByText('Lake house updated.')).toBeVisible();
        await expect(item(page, 'Lake house')).toContainText('Appraised in June');
        await expect(item(page, 'Lake house')).toContainText('$300,000.00');
        await expect(item(page, 'Lake house')).toContainText('Jun 30, 2025');
        // Still the one value, as of its own day: nothing was valued today.
        expect(await values()).toEqual([[asOf, 300_000]]);

        // A day the user gives stays theirs when the value changes after it.
        await page.getByRole('button', { name: 'Actions for Lake house' }).click();
        await page.getByRole('menuitem', { name: 'Update' }).click();
        await date.fill('2025-12-31');
        await dialog.getByLabel('Value ($)').fill('310,000');
        await expect(date).toHaveValue('2025-12-31');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(dialog).toBeHidden();
        await expect(item(page, 'Lake house')).toContainText('Dec 31, 2025');
        expect(await values()).toEqual([[asOf, 300_000], ['2025-12-31', 310_000]]);
    });

    test('a bad entry is explained in the form, and nothing is saved', async ({ page }) => {
        await brokerage(page);
        await gotoAppPage(page, '/portfolios/accounts');

        const dialog = await add(page, 'asset', { name: '  ', value: '5000' });
        const error = dialog.getByTestId('net-worth-item-error');
        await expect(error).toHaveText('Name the asset or debt');
        await dialog.getByLabel('Name').fill('Car');
        await dialog.getByLabel('Value ($)').fill('-5');
        await dialog.getByRole('button', { name: 'Add asset' }).click();
        await expect(error).toHaveText("Enter what it's worth, in dollars");
        await dialog.getByLabel('Value ($)').fill('5000');
        await dialog.getByLabel('As of').fill('');
        await dialog.getByRole('button', { name: 'Add asset' }).click();
        await expect(error).toHaveText('Enter the date of the value');
        // What the server refuses is said the same way.
        await dialog.getByLabel('As of').fill('2026-11-01');
        await dialog.getByLabel('Name').fill('<b>Car</b>');
        await dialog.getByRole('button', { name: 'Add asset' }).click();
        await expect(error).toHaveText('Input contains invalid characters (< or >)');
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel' }).click();

        const debt = await add(page, 'debt', { value: 'lots' });
        await expect(debt.getByTestId('net-worth-item-error')).toHaveText('Enter the balance owed, in dollars');
        await debt.getByRole('button', { name: 'Cancel' }).click();

        await reloadAppPage(page);
        await expect(page.getByTestId('net-worth-items-table')).toHaveCount(0);
        await expect(card(page)).toContainText('Add one and Today shows your net worth.');
    });

    test('before any account, the card is under the empty state, and the net worth is the assets less the debts', async ({ page }) => {
        expect((await page.request.post('/api/portfolio/net-worth-items', { data: HOME })).status()).toBe(201);
        expect((await page.request.post('/api/portfolio/net-worth-items', {
            data: { kind: 'debt', category: 'credit_card', name: 'Card', value: 4_999.5, valueAsOf: '2026-11-20' },
        })).status()).toBe(201);
        await gotoAppPage(page, '/portfolios/accounts');
        await expect(page.getByTestId('accounts-empty')).toBeVisible();
        await expect(page.getByTestId('accounts-view').locator('[data-testid="accounts-empty"] + [data-testid="net-worth-items"]')).toBeVisible();
        await expect(figure(page, 'Your accounts')).toHaveText('$0.00');
        await expect(figure(page, 'Debts')).toHaveText('−$4,999.50');
        await expect(figure(page, 'Net worth')).toHaveText('$295,000.50');
    });

    test('the API changes only your own items', async ({ page, playwright }) => {
        const created = await page.request.post('/api/portfolio/net-worth-items', { data: HOME });
        expect(created.status()).toBe(201);
        const { data: { id } } = await created.json() as { data: { id: string } };
        const saved = await page.request.put(`/api/portfolio/net-worth-items/${id}`, { data: { ...HOME, value: 310_000, valueAsOf: '2026-11-15' } });
        expect(saved.status()).toBe(200);
        expect(await saved.json()).toEqual({ data: { id } });

        // An asset stays an asset: the values it keeps by day are a home's, not a debt's.
        const madeDebt = await page.request.put(`/api/portfolio/net-worth-items/${id}`, { data: { ...HOME, kind: 'debt', category: 'mortgage' } });
        expect(madeDebt.status()).toBe(400);
        expect(await madeDebt.json()).toEqual({ error: 'An asset can\'t become a debt. Delete it and add it as a debt.', code: 'INVALID_NET_WORTH_ITEM' });

        // Another user's item, or an ID that can't be one, is not found, and stays as it was.
        for (const response of [
            await page.request.put(`/api/portfolio/net-worth-items/${OTHER_USERS_ITEM}`, { data: HOME }),
            // Whatever kind is sent, so its kind isn't given away.
            await page.request.put(`/api/portfolio/net-worth-items/${OTHER_USERS_ITEM}`, { data: { ...HOME, kind: 'debt', category: 'mortgage' } }),
            await page.request.delete(`/api/portfolio/net-worth-items/${OTHER_USERS_ITEM}`),
            await page.request.put('/api/portfolio/net-worth-items/not-a-uuid', { data: HOME }),
            await page.request.delete('/api/portfolio/net-worth-items/not-a-uuid'),
        ]) {
            expect(response.status()).toBe(404);
            expect(await response.json()).toEqual({ error: 'Asset or debt not found', code: 'NET_WORTH_ITEM_NOT_FOUND' });
        }
        const [sentinel] = await e2eDatabase()<{ name: string; value: string }[]>`SELECT name, value::text AS value FROM net_worth_items WHERE id = ${OTHER_USERS_ITEM}`;
        expect({ ...sentinel }).toEqual({ name: 'Other User Asset Sentinel', value: '999.00' });

        const mismatched = await page.request.post('/api/portfolio/net-worth-items', { data: { ...HOME, category: 'mortgage' } });
        expect(mismatched.status()).toBe(400);
        expect(await mismatched.json()).toEqual({ error: 'Choose a kind of asset', code: 'INVALID_NET_WORTH_ITEM' });
        expect((await page.request.post('/api/portfolio/net-worth-items', { data: { ...HOME, userId: 'someone-else' } })).status()).toBe(400);
        expect((await page.request.post('/api/portfolio/net-worth-items', { data: { ...HOME, note: 'n'.repeat(5 * 1024) } })).status()).toBe(413);

        expect((await page.request.delete(`/api/portfolio/net-worth-items/${id}`)).status()).toBe(204);
        expect((await page.request.delete(`/api/portfolio/net-worth-items/${id}`)).status()).toBe(404);

        // A request context of its own: the page's background requests keep
        // setting the session cookie on the shared one.
        const anonymous = await playwright.request.newContext({
            baseURL: 'http://localhost:3000',
            storageState: { cookies: [], origins: [] },
        });
        expect((await anonymous.post('/api/portfolio/net-worth-items', { data: HOME })).status()).toBe(401);
        expect((await anonymous.put(`/api/portfolio/net-worth-items/${OTHER_USERS_ITEM}`, { data: HOME })).status()).toBe(401);
        expect((await anonymous.delete(`/api/portfolio/net-worth-items/${OTHER_USERS_ITEM}`)).status()).toBe(401);
        await anonymous.dispose();
    });
});
