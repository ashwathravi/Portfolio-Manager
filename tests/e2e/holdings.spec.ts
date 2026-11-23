import { test, expect, type Locator, type Page } from '@playwright/test';
import { gotoAppPage, reloadAppPage } from './helpers/app';
import { databaseAuthEnabled, e2eDatabase, signInAsFreshUser, signInAsNewUser } from './helpers/users';

/**
 * Portfolio › Holdings (/portfolios/holdings).
 *
 * Holdings come from the database. With an empty book the page shows a
 * single empty state (no zero-filled KPI tiles, and no option ledger
 * measured against nothing). With positions, it shows the summary strip,
 * policy/theme exposure, the filter row, and the full table; the LEAPS
 * ledger holds the user's own option positions (launch item i63), never
 * example ones.
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
    });

    test('regression (x30): without bank linking, the empty state adds an account by hand instead of a Connect link that loops', async ({ context, page }) => {
        // E2E runs without Plaid's keys, as production does until they're
        // set: Settings says bank linking isn't set up and points back at
        // Accounts, so "Connect an account" went round in a circle. With a
        // database, a user with no positions yet (fixture user A has some).
        if (await signInAsNewUser(context)) await gotoAppPage(page, '/portfolios/holdings');
        const empty = page.getByTestId('holdings-empty');
        await expect(empty).toContainText('Add an account, or import a positions export from your broker.');
        await expect(empty.getByRole('link', { name: 'Connect an account' })).toHaveCount(0);
        await expect(empty.locator('a[href^="/settings"]')).toHaveCount(0);
        await expect(empty.getByRole('button', { name: 'New account' })).toHaveClass(/pm-btn-primary/);
        await expect(empty.getByRole('button', { name: 'Import CSV' })).toHaveClass(/pm-btn-ghost/);
        await expect(empty.getByRole('link', { name: 'View accounts' })).toHaveAttribute('href', '/portfolios/accounts');
    });

    test('x30: a new user adds an account by hand from the empty state', async ({ context, page }) => {
        test.skip(!databaseAuthEnabled, 'requires the database-auth E2E mode');
        await signInAsNewUser(context);
        await gotoAppPage(page, '/portfolios/holdings');
        const empty = page.getByTestId('holdings-empty');
        await empty.getByRole('button', { name: 'New account' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Name').fill('Brokerage');
        await dialog.getByRole('button', { name: 'Add account' }).click();
        await expect(dialog).toBeHidden();
        expect((await (await page.request.get('/api/portfolios/count')).json()).count).toBe(1);
        // Still no positions: the empty state stays, now with an account to import into.
        await expect(empty).toBeVisible();
        // Regression: it still led with New account, steering a user with an
        // account toward a second one. Importing into it is the next step.
        await expect(empty).toContainText('Import a positions export from your broker into your account, or add another account.');
        await expect(empty.getByRole('button', { name: 'Import CSV' })).toHaveClass(/pm-btn-primary/);
        await expect(empty.getByRole('button', { name: 'New account' })).toHaveClass(/pm-btn-ghost/);
        await expect(empty.locator('a[href^="/settings"]')).toHaveCount(0);
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

    test('regression: with holdings, the LEAPS ledger holds no example contracts', async ({ page }) => {
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        const ledger = page.getByTestId('options-risk-ledger');
        await expect(ledger).toContainText('LEAPS and option premium at risk');
        await expect(ledger.getByTestId('sample-tag')).toHaveCount(0);
        // Fixture user A holds no options.
        await expect(ledger.getByTestId('options-ledger-empty')).toHaveText('No option positions yet.');
        await expect(ledger.getByTestId('options-risk-row')).toHaveCount(0);
        await expect(ledger.getByRole('button', { name: 'Add option' })).toBeEnabled();
        await expect(ledger.getByTestId('options-ledger-note')).toContainText("aren't counted in portfolio value or returns yet");
    });
});

/** Launch item i63: the LEAPS ledger from the user's own option positions. */
test.describe('Holdings › LEAPS ledger from your option positions', () => {
    test.skip(!databaseAuthEnabled, 'option positions are saved in the database');

    // Each test adds positions: a user of its own.
    test.beforeEach(async ({ context, page }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/portfolios/holdings');
    });

    async function addOption(page: Page, fields: { underlying: string; strike: string; expiry: string; contracts: string; premium: string; exitRule?: string }) {
        const ledger = page.getByTestId('options-risk-ledger');
        const dialog = page.getByTestId('option-position-dialog');
        await expect(async () => {
            await ledger.getByRole('button', { name: 'Add option' }).click();
            await expect(dialog).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
        await dialog.getByRole('combobox', { name: 'Account', exact: true }).selectOption({ label: 'Main Portfolio' });
        await dialog.getByRole('textbox', { name: 'Underlying', exact: true }).fill(fields.underlying);
        await dialog.getByRole('textbox', { name: 'Strike ($)', exact: true }).fill(fields.strike);
        await dialog.getByRole('textbox', { name: 'Expiry', exact: true }).fill(fields.expiry);
        await dialog.getByRole('textbox', { name: 'Contracts', exact: true }).fill(fields.contracts);
        await dialog.getByRole('textbox', { name: 'Premium paid / share ($)', exact: true }).fill(fields.premium);
        if (fields.exitRule) await dialog.getByRole('textbox', { name: 'Exit, roll or expire rule (optional)', exact: true }).fill(fields.exitRule);
        await dialog.getByRole('button', { name: 'Add position' }).click();
        await expect(dialog).toBeHidden();
    }

    test('a position added by hand is valued at cost, survives a reload, takes a price of your own, and is deleted after asking', async ({ page }) => {
        await addOption(page, { underlying: 'AAPL', strike: '250', expiry: '2027-01-15', contracts: '3', premium: '18.20', exitRule: 'Exit if the premium halves.' });
        const ledger = page.getByTestId('options-risk-ledger');
        const row = ledger.getByTestId('options-risk-row');
        await expect(row).toHaveCount(1);
        await expect(row).toContainText('AAPL 2027-01-15 250C');
        await expect(row).toContainText('3 long CALL contracts · Main Portfolio');
        await expect(row.getByTestId('option-mark-source')).toHaveText('At cost: no price yet');
        // 3 contracts × 100 × $18.20.
        await expect(row).toContainText('$5,460');
        await expect(row).toContainText('Exit if the premium halves.');
        await expect(ledger.getByTestId('options-ledger-empty')).toHaveCount(0);

        await reloadAppPage(page);
        await expect(row).toHaveCount(1);

        const dialog = page.getByTestId('option-position-dialog');
        await row.getByRole('button', { name: 'Edit AAPL Jan 15 2027 250 call' }).click();
        await expect(dialog.getByRole('textbox', { name: 'Strike ($)', exact: true })).toHaveValue('250');
        await expect(dialog.getByRole('textbox', { name: 'Contracts', exact: true })).toHaveValue('3');
        await dialog.getByRole('textbox', { name: 'Your price / share ($, optional)', exact: true }).fill('21.40');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(dialog).toBeHidden();
        await expect(row.getByTestId('option-mark-source')).toHaveText(/^Your price [A-Z][a-z]{2} \d{1,2}$/);
        await expect(row).toContainText('$21.40');
        await expect(row).toContainText('$6,420');

        const asked: string[] = [];
        page.once('dialog', (confirm) => {
            asked.push(confirm.message());
            void confirm.accept();
        });
        await row.getByRole('button', { name: 'Delete AAPL Jan 15 2027 250 call' }).click();
        await expect(ledger.getByTestId('options-ledger-empty')).toBeVisible();
        expect(asked).toEqual(["Delete AAPL Jan 15 2027 250 call from Main Portfolio? This can't be undone."]);
        await reloadAppPage(page);
        await expect(ledger.getByTestId('options-risk-row')).toHaveCount(0);
    });

    test('a contract with a stored close is marked at it', async ({ page }) => {
        await addOption(page, { underlying: 'NVDA', strike: '150', expiry: '2027-01-15', contracts: '2', premium: '25' });
        const row = page.getByTestId('options-risk-ledger').getByTestId('options-risk-row');
        // The fixture close for O:NVDA270115C00150000.
        await expect(row.getByTestId('option-mark-source')).toHaveText('Close Oct 1');
        await expect(row).toContainText('$31.25');
        await expect(row).toContainText('$6,250');
    });

    test('a bad entry is explained in the form', async ({ page }) => {
        await addOption(page, { underlying: 'AAPL', strike: '250', expiry: '2027-01-15', contracts: '1', premium: '10' });
        const dialog = page.getByTestId('option-position-dialog');
        await page.getByTestId('options-risk-ledger').getByRole('button', { name: 'Add option' }).click();
        await dialog.getByRole('textbox', { name: 'Underlying', exact: true }).fill('AAPL');
        await dialog.getByRole('textbox', { name: 'Strike ($)', exact: true }).fill('0');
        await dialog.getByRole('button', { name: 'Add position' }).click();
        await expect(dialog.getByTestId('option-form-error')).toHaveText('Enter a strike above 0.');
        // The same contract twice in one account: the server says to edit it.
        await dialog.getByRole('combobox', { name: 'Account', exact: true }).selectOption({ label: 'Main Portfolio' });
        await dialog.getByRole('textbox', { name: 'Strike ($)', exact: true }).fill('250');
        await dialog.getByRole('textbox', { name: 'Expiry', exact: true }).fill('2027-01-15');
        await dialog.getByRole('textbox', { name: 'Contracts', exact: true }).fill('2');
        await dialog.getByRole('textbox', { name: 'Premium paid / share ($)', exact: true }).fill('12');
        await dialog.getByRole('button', { name: 'Add position' }).click();
        await expect(dialog.getByTestId('option-form-error')).toHaveText('That account already holds this contract. Edit it instead.');
    });

    test("a broker CSV's option rows go to the ledger with its stocks", async ({ page }) => {
        await openImport(page, [
            '"Symbol","Description","Quantity","Cost Basis","Security Type"',
            '"KO","COCA COLA CO","4","$240.00","Equity"',
            '"AAPL 01/15/2027 250.00 C","CALL APPLE INC $250 EXP 01/15/27","3","$5,460.00","Option"',
        ].join('\n'));
        const preview = page.getByTestId('import-preview');
        await expect(preview).toContainText('1 position and 1 option position ready');
        const options = preview.getByRole('table', { name: 'Option positions to import' });
        await expect(options.locator('tbody tr')).toHaveText([/AAPL Jan 15 2027 250 call\s*3\s*\$18\.20\s*\$5,460\.00/]);
        await page.getByTestId('import-dialog').getByRole('combobox').selectOption({ label: 'Main Portfolio' });
        await page.getByRole('button', { name: 'Import 2 positions' }).click();
        await expect(page.getByText('Option positions: 1 new, 0 updated.', { exact: false })).toBeVisible();

        const row = page.getByTestId('options-risk-ledger').getByTestId('options-risk-row');
        await expect(row).toContainText('AAPL 2027-01-15 250C');
        await expect(row).toContainText('3 long CALL contracts · Main Portfolio');
    });

    test('the API changes only your own option positions', async ({ page, playwright }) => {
        const created = await page.request.post('/api/portfolios', { data: { name: 'Options account' } });
        expect(created.status()).toBe(201);
        const { id: portfolioId } = (await created.json()).data;
        const position = { underlying: 'AAPL', contractType: 'call', strike: 250, expiry: '2027-01-15', quantity: 3, premium: 18.2 };

        const added = await page.request.post('/api/portfolio/options', { data: { portfolioId, position } });
        expect(added.status()).toBe(201);
        const { id } = (await added.json()).data;
        const again = await page.request.post('/api/portfolio/options', { data: { portfolioId, position } });
        expect([again.status(), (await again.json()).code]).toEqual([409, 'OPTION_POSITION_EXISTS']);

        const invalid = await page.request.post('/api/portfolio/options', { data: { portfolioId, position: { ...position, strike: 0 } } });
        expect([invalid.status(), (await invalid.json()).error]).toEqual([400, 'Enter a strike above 0, to at most three decimals']);
        expect((await page.request.post('/api/portfolio/options', { data: { portfolioId, position, userId: 'someone-else' } })).status()).toBe(400);
        const tooLarge = await page.request.post('/api/portfolio/options', {
            headers: { 'content-type': 'application/json' },
            data: JSON.stringify({ portfolioId, position, pad: 'x'.repeat(16 * 1024) }),
        });
        expect(tooLarge.status()).toBe(413);

        // Another user's account is not found, and nothing is written.
        const theirs = await page.request.post('/api/portfolio/options', { data: { portfolioId: OTHER_USERS_ACCOUNT, position } });
        expect([theirs.status(), (await theirs.json()).code]).toEqual([404, 'PORTFOLIO_NOT_FOUND']);
        const moved = await page.request.put(`/api/portfolio/options/${id}`, { data: { portfolioId: OTHER_USERS_ACCOUNT, position } });
        expect(moved.status()).toBe(404);

        expect((await page.request.put(`/api/portfolio/options/${id}`, { data: { portfolioId, position: { ...position, quantity: 5 } } })).status()).toBe(200);
        for (const response of [
            await page.request.put(`/api/portfolio/options/${UNKNOWN_ID}`, { data: { portfolioId, position } }),
            await page.request.delete(`/api/portfolio/options/${UNKNOWN_ID}`),
            await page.request.delete('/api/portfolio/options/not-a-uuid'),
        ]) {
            expect([response.status(), (await response.json()).code]).toEqual([404, 'OPTION_POSITION_NOT_FOUND']);
        }

        const anonymous = await playwright.request.newContext({ baseURL: 'http://localhost:3000', storageState: { cookies: [], origins: [] } });
        expect((await anonymous.post('/api/portfolio/options', { data: { portfolioId, position } })).status()).toBe(401);
        expect((await anonymous.put(`/api/portfolio/options/${id}`, { data: { portfolioId, position } })).status()).toBe(401);
        expect((await anonymous.delete(`/api/portfolio/options/${id}`)).status()).toBe(401);
        await anonymous.dispose();

        expect((await page.request.delete(`/api/portfolio/options/${id}`)).status()).toBe(204);
        expect((await page.request.delete(`/api/portfolio/options/${id}`)).status()).toBe(404);
    });
});

test.describe('Holdings › Valued by hand', () => {
    test.skip(!databaseAuthEnabled, 'holdings valued by hand are saved in the database');
    let userId = '';

    test.beforeEach(async ({ context, page }) => {
        userId = await signInAsFreshUser(context);
        await gotoAppPage(page, '/portfolios/holdings');
    });

    test('a holding Atlas cannot price is added, counts in its account, and can be updated and deleted', async ({ page }) => {
        const card = page.getByTestId('manual-holdings');
        await card.getByRole('button', { name: 'Add holding' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Account').selectOption({ label: 'Main Portfolio' });
        await dialog.getByLabel('Holding').fill('Target 2055 Trust');
        await dialog.getByLabel('Value ($)').fill('12,500');
        await dialog.getByLabel('Cost ($, optional)').fill('10000');
        await dialog.getByRole('button', { name: 'Add holding' }).click();
        await expect(dialog).toBeHidden();
        const row = card.getByTestId('manual-holdings-table').getByRole('row').filter({ hasText: 'Target 2055 Trust' });
        await expect(row).toContainText('$12,500.00');
        await expect(row).toContainText('Main Portfolio');

        await page.getByRole('button', { name: 'Actions for Target 2055 Trust' }).click();
        await page.getByRole('menuitem', { name: 'Update value' }).click();
        await page.getByRole('dialog').getByLabel('Value ($)').fill('13000');
        await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
        await expect(row).toContainText('$13,000.00');

        const refused = await page.request.post('/api/portfolio/manual-holdings', {
            data: { portfolioId: '00000000-0000-4000-8000-0000000000ff', holding: { name: 'X', value: 1, valueAsOf: '2026-11-19' } },
        });
        expect(refused.status()).toBe(404);

        page.once('dialog', (d) => void d.accept());
        await page.getByRole('button', { name: 'Actions for Target 2055 Trust' }).click();
        await page.getByRole('menuitem', { name: 'Delete' }).click();
        await expect(card.getByTestId('manual-holdings-table')).toHaveCount(0);
    });

    test('regression: a new name keeps the value\'s date and adds no value; a new value is as of today', async ({ page }) => {
        // The dialog dated every edit today, so a rename recorded a value
        // for a day nothing was valued. A day that can't be today shows it.
        const asOf = '2025-06-30';
        const [account] = await e2eDatabase()<{ id: string }[]>`SELECT id FROM portfolios WHERE user_id = ${userId} AND name = 'Main Portfolio'`;
        const added = await page.request.post('/api/portfolio/manual-holdings', {
            data: { portfolioId: account.id, holding: { name: 'Target 2055 Trust', value: 12500, valueAsOf: asOf } },
        });
        expect(added.status()).toBe(201);
        await reloadAppPage(page);
        // The dialog's today: the browser's own date.
        const today = await page.evaluate(() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        });
        const values = async () => (await e2eDatabase()<{ date: string; value: string }[]>`
            SELECT to_char(v.date, 'YYYY-MM-DD') AS date, v.value::text AS value
            FROM manual_holding_values v JOIN manual_holdings m ON m.id = v.manual_holding_id
            WHERE m.user_id = ${userId}
            ORDER BY v.date`).map((v) => [v.date, Number(v.value)]);

        const table = page.getByTestId('manual-holdings').getByTestId('manual-holdings-table');
        await page.getByRole('button', { name: 'Actions for Target 2055 Trust' }).click();
        await page.getByRole('menuitem', { name: 'Update value' }).click();
        const dialog = page.getByRole('dialog');
        const date = dialog.getByLabel('As of');
        await expect(date).toHaveValue(asOf);
        await dialog.getByLabel('Holding').fill('Target 2055 Trust (old plan)');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(dialog).toBeHidden();
        const row = table.getByRole('row').filter({ hasText: 'Target 2055 Trust (old plan)' });
        await expect(row).toContainText('Jun 30, 2025');
        expect(await values()).toEqual([[asOf, 12500]]);

        // A new value is as of today, and the earlier one stays by its day.
        await page.getByRole('button', { name: 'Actions for Target 2055 Trust (old plan)' }).click();
        await page.getByRole('menuitem', { name: 'Update value' }).click();
        await expect(date).toHaveValue(asOf);
        await dialog.getByLabel('Value ($)').fill('13,000');
        await expect(date).toHaveValue(today);
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(dialog).toBeHidden();
        await expect(row).toContainText('$13,000.00');
        expect(await values()).toEqual([[asOf, 12500], [today, 13000]]);
    });
});

test.describe('Holdings › LEAPS ledger before any position', () => {
    test.skip(!databaseAuthEnabled, 'option positions are saved in the database');

    test('regression: an account with no stocks or options can still add its first option', async ({ context, page }) => {
        await signInAsNewUser(context, { firstSignIn: true });
        await gotoAppPage(page, '/portfolios/holdings');
        // No account: nowhere to put an option, so no ledger.
        await expect(page.getByTestId('holdings-empty')).toBeVisible();
        await expect(page.getByTestId('options-risk-ledger')).toHaveCount(0);

        expect((await page.request.post('/api/portfolios', { data: { name: 'Options only', cashBalance: 10_000 } })).status()).toBe(201);
        await reloadAppPage(page);
        await expect(page.getByTestId('holdings-empty')).toBeVisible();
        const ledger = page.getByTestId('options-risk-ledger');
        await expect(ledger.getByTestId('options-ledger-empty')).toHaveText('No option positions yet.');
        // Nothing measured against an empty book.
        await expect(ledger.getByLabel('Options exposure summary')).toHaveCount(0);

        const dialog = page.getByTestId('option-position-dialog');
        await expect(async () => {
            await ledger.getByRole('button', { name: 'Add option' }).click();
            await expect(dialog).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
        await expect(dialog.getByRole('combobox', { name: 'Account', exact: true })).toHaveValue(/.+/);
        await dialog.getByRole('textbox', { name: 'Underlying', exact: true }).fill('SPY');
        await dialog.getByRole('textbox', { name: 'Strike ($)', exact: true }).fill('550');
        await dialog.getByRole('textbox', { name: 'Expiry', exact: true }).fill('2027-12-17');
        await dialog.getByRole('textbox', { name: 'Contracts', exact: true }).fill('1');
        await dialog.getByRole('textbox', { name: 'Premium paid / share ($)', exact: true }).fill('10');
        await dialog.getByRole('button', { name: 'Add position' }).click();
        await expect(dialog).toBeHidden();
        const row = ledger.getByTestId('options-risk-row');
        await expect(row).toContainText('SPY 2027-12-17 550C');
        await expect(row).toContainText('1 long CALL contract · Options only');
        // Regression: measured against cash and options together, as Today
        // and Trade measure it: $1,000 of premium in $11,000, not 100%.
        await expect(row).toContainText('9.1%');
        await expect(ledger.getByLabel('Options exposure summary')).toContainText('9.1%');
    });
});

test.describe('Holdings › LEAPS ledger with holdings valued by hand', () => {
    test.skip(!databaseAuthEnabled, 'option positions and holdings valued by hand are saved in the database');

    test('regression: premium is measured against the portfolio with its hand-valued holdings', async ({ context, page }) => {
        await signInAsNewUser(context, { firstSignIn: true });
        await gotoAppPage(page, '/portfolios/holdings');
        const created = await page.request.post('/api/portfolios', { data: { name: 'Plan account', cashBalance: 10_000 } });
        expect(created.status()).toBe(201);
        const { id: portfolioId } = (await created.json()).data;
        const position = { underlying: 'SPY', contractType: 'call', strike: 550, expiry: '2027-12-17', quantity: 1, premium: 10 };
        expect((await page.request.post('/api/portfolio/options', { data: { portfolioId, position } })).status()).toBe(201);
        const valuedAsOf = new Date().toISOString().slice(0, 10);
        const fund = await page.request.post('/api/portfolio/manual-holdings', {
            data: { portfolioId, holding: { name: 'Target 2055 Trust', value: 9_000, valueAsOf: valuedAsOf } },
        });
        expect(fund.status()).toBe(201);

        await reloadAppPage(page);
        const ledger = page.getByTestId('options-risk-ledger');
        const row = ledger.getByTestId('options-risk-row');
        await expect(row).toContainText('SPY 2027-12-17 550C');
        // $1,000 of premium in $10,000 cash + $9,000 valued by hand + the
        // option itself: 5.0%, as Today and Trade measure it (not 9.1%).
        await expect(row).toContainText('5.0%');
        await expect(ledger.getByLabel('Options exposure summary')).toContainText('5.0%');
    });
});

test.describe('Holdings › LEAPS ledger from a linked account', () => {
    test.skip(!databaseAuthEnabled, 'a linked account and its synced contracts are set up in the database');

    const EDIT = 'Edit NVDA Jan 15 2027 150 call';
    const DELETE = 'Delete NVDA Jan 15 2027 150 call';
    let userId = '';

    // A linked account that still syncs (launch item i44), holding a contract
    // as a sync leaves it: the institution's contracts, premium and dated
    // price. Set up in the database, without Plaid.
    test.beforeEach(async ({ context, page }) => {
        userId = await signInAsFreshUser(context);
        const sql = e2eDatabase();
        await sql.begin(async (transaction) => {
            // postgres.js types a transaction without its tagged-template call.
            const tx = transaction as unknown as typeof sql;
            const [item] = await tx<{ id: string }[]>`
                INSERT INTO plaid_items (user_id, plaid_item_id, institution_name, access_token_ciphertext, access_token_iv, access_token_auth_tag)
                VALUES (${userId}, ${`item-${userId}`}, 'Example Brokerage', 'x', 'x', 'x') RETURNING id`;
            await tx`
                INSERT INTO plaid_accounts (user_id, plaid_item_record_id, plaid_account_id, name, type, subtype, capabilities, verification_status, sync_status)
                VALUES (${userId}, ${item.id}, ${`acc-${userId}`}, 'Individual', 'investment', 'brokerage', '[]', 'automatically_verified', 'sync_ready')`;
            const [account] = await tx<{ id: string }[]>`
                INSERT INTO portfolios (user_id, name, source, external_account_id)
                VALUES (${userId}, 'Example Brokerage Individual', 'plaid', ${`acc-${userId}`}) RETURNING id`;
            await tx`
                INSERT INTO option_positions (user_id, portfolio_id, contract, underlying, contract_type, strike, expiry, quantity, premium, source, institution_price, institution_price_date)
                VALUES (${userId}, ${account.id}, 'O:NVDA270115C00150000', 'NVDA', 'call', 150, '2027-01-15', 2, 25, 'plaid', 33.10, '2026-10-05')`;
        });
        await gotoAppPage(page, '/portfolios/holdings');
    });

    test("a synced contract says where it's from, is marked at the institution's newer price, and only its plan is yours to edit", async ({ page }) => {
        const ledger = page.getByTestId('options-risk-ledger');
        const row = ledger.getByTestId('options-risk-row');
        await expect(row).toHaveCount(1);
        await expect(row).toContainText('2 long CALL contracts · Example Brokerage Individual · from your linked account');
        // Newer than the fixture close for the contract ($31.25 on Oct 1).
        await expect(row.getByTestId('option-mark-source')).toHaveText("Institution's price Oct 5");
        await expect(row).toContainText('$33.10');
        // 2 contracts × 100 × $33.10.
        await expect(row).toContainText('$6,620');
        // It goes when the account no longer holds it, not from here.
        await expect(row.getByRole('button', { name: EDIT })).toBeVisible();
        await expect(row.getByRole('button', { name: DELETE })).toHaveCount(0);

        const dialog = page.getByTestId('option-position-dialog');
        await expect(async () => {
            await row.getByRole('button', { name: EDIT }).click();
            await expect(dialog).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
        await expect(dialog).toContainText('From your linked account');
        for (const field of ['Account', 'Call or put', 'Position']) {
            await expect(dialog.getByRole('combobox', { name: field, exact: true }), field).toBeDisabled();
        }
        for (const field of ['Underlying', 'Strike ($)', 'Expiry', 'Contracts', 'Premium paid / share ($)']) {
            await expect(dialog.getByRole('textbox', { name: field, exact: true }), field).toBeDisabled();
        }
        // They look it: muted, unlike the fields that are the user's.
        const exitRule = dialog.getByRole('textbox', { name: 'Exit, roll or expire rule (optional)', exact: true });
        const editableColor = await exitRule.evaluate((field) => getComputedStyle(field).color);
        const contracts = dialog.getByRole('textbox', { name: 'Contracts', exact: true });
        await expect(contracts).not.toHaveCSS('color', editableColor);
        await expect(contracts).toHaveCSS('cursor', 'not-allowed');
        await exitRule.fill('Roll at 90 days.');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(dialog).toBeHidden();
        await expect(row).toContainText('Roll at 90 days.');

        await reloadAppPage(page);
        await expect(row).toContainText('Roll at 90 days.');
        await expect(row).toContainText('2 long CALL contracts · Example Brokerage Individual · from your linked account');
    });

    test('the API keeps its contracts and account while the account syncs; once it stops, it is yours to change or delete', async ({ page }) => {
        const sql = e2eDatabase();
        const [{ id, portfolioId }] = await sql<{ id: string; portfolioId: string }[]>`
            SELECT id, portfolio_id AS "portfolioId" FROM option_positions WHERE user_id = ${userId}`;
        const [{ id: mainPortfolio }] = await sql<{ id: string }[]>`SELECT id FROM portfolios WHERE user_id = ${userId} AND name = 'Main Portfolio'`;
        const position = { underlying: 'NVDA', contractType: 'call', strike: 150, expiry: '2027-01-15', quantity: 5, premium: 25 };

        // Saved, but how many is still the institution's.
        expect((await page.request.put(`/api/portfolio/options/${id}`, { data: { portfolioId, position } })).status()).toBe(200);
        const moved = await page.request.put(`/api/portfolio/options/${id}`, { data: { portfolioId: mainPortfolio, position } });
        expect([moved.status(), (await moved.json()).code]).toEqual([409, 'OPTION_POSITION_SYNCED']);
        const deleted = await page.request.delete(`/api/portfolio/options/${id}`);
        expect([deleted.status(), (await deleted.json()).code]).toEqual([409, 'OPTION_POSITION_SYNCED']);
        const twice = await page.request.post('/api/portfolio/options', { data: { portfolioId, position } });
        expect([twice.status(), (await twice.json()).code]).toEqual([409, 'OPTION_POSITION_EXISTS']);
        await reloadAppPage(page);
        const ledger = page.getByTestId('options-risk-ledger');
        const row = ledger.getByTestId('options-risk-row');
        await expect(row).toContainText('2 long CALL contracts · Example Brokerage Individual');

        // Disconnected, or its pick undone: the account no longer syncs.
        await sql`UPDATE plaid_accounts SET sync_status = 'excluded' WHERE user_id = ${userId}`;
        await reloadAppPage(page);
        await expect(row.getByTestId('option-synced')).toHaveCount(0);

        // How many is the user's to change now, and saving makes the row theirs.
        const dialog = page.getByTestId('option-position-dialog');
        await expect(async () => {
            await row.getByRole('button', { name: EDIT }).click();
            await expect(dialog).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
        const contracts = dialog.getByRole('textbox', { name: 'Contracts', exact: true });
        await expect(contracts).toBeEnabled();
        await contracts.fill('3');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(dialog).toBeHidden();
        await expect(row).toContainText('3 long CALL contracts · Example Brokerage Individual');
        const [saved] = await sql<{ source: string; quantity: number }[]>`SELECT source, quantity::float AS quantity FROM option_positions WHERE id = ${id}`;
        expect(saved).toEqual({ source: 'manual', quantity: 3 });

        page.once('dialog', (confirm) => void confirm.accept());
        await row.getByRole('button', { name: DELETE }).click();
        await expect(ledger.getByTestId('options-ledger-empty')).toBeVisible();
        await reloadAppPage(page);
        await expect(ledger.getByTestId('options-risk-row')).toHaveCount(0);
    });

    test("a Delete after the account started syncing again says why, and the row comes back as the linked account's", async ({ page }) => {
        const sql = e2eDatabase();
        // The page loads while the account doesn't sync, so the row has a Delete...
        await sql`UPDATE plaid_accounts SET sync_status = 'excluded' WHERE user_id = ${userId}`;
        await reloadAppPage(page);
        const row = page.getByTestId('options-risk-ledger').getByTestId('options-risk-row');
        await expect(row.getByTestId('option-synced')).toHaveCount(0);
        await expect(row.getByRole('button', { name: DELETE })).toBeVisible();

        // ...and by the time the user deletes it, the account syncs again.
        await sql`UPDATE plaid_accounts SET sync_status = 'sync_ready' WHERE user_id = ${userId}`;
        page.once('dialog', (confirm) => void confirm.accept());
        await row.getByRole('button', { name: DELETE }).click();
        await expect(page.getByText('This contract is from your linked account. It goes when the account no longer holds it.')).toBeVisible();
        await expect(row.getByTestId('option-synced')).toBeVisible();
        await expect(row.getByRole('button', { name: DELETE })).toHaveCount(0);
        await expect(row.getByRole('button', { name: EDIT })).toBeVisible();
    });
});

const OTHER_USERS_ACCOUNT = '00000000-0000-4000-8000-000000000009';
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000006ff';

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
        data: [{ symbol: 'AAPL', price: 190, change: 2, changePercent: 1.06, timestamp, kind: 'close', isRealtime: false }],
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
            data: [{ symbol: 'AAPL', price: 190, change: null, changePercent: null, timestamp: new Date().toISOString(), kind: 'close', isRealtime: false }],
        } }));
        await gotoAppPage(page, '/portfolios/holdings');
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        await expect(todayPnL(page)).toHaveText('$0');
        await expect(aaplToday(page)).toHaveText('—');
    });
});

test.describe('Holdings › By symbol', () => {
    // Launch item i79: one row per symbol across accounts, next to one row per
    // account position.
    const dbMode = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');
    const table = (page: Page) => page.getByTestId('holdings-table');
    const rowsFor = (page: Page, symbol: string) =>
        table(page).locator('tbody tr').filter({ has: page.getByText(symbol, { exact: true }) });
    const rowChoice = (page: Page) => page.getByRole('radiogroup', { name: 'Show holdings' });

    test.beforeEach(async ({ page }) => {
        test.skip(!dbMode, 'needs the seeded E2E database');
        await page.route('**/api/market-data/historical**', (route) => route.fulfill({ status: 200, json: { data: [] } }));
        // One quote for AAPL in every account.
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: {
            data: [{ symbol: 'AAPL', price: 190, change: 2, changePercent: 1.06, timestamp: new Date().toISOString(), kind: 'delayed', isRealtime: false }],
        } }));
    });

    test('a symbol in two accounts is one row, with the shares added up and the cost blended', async ({ context, page }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/portfolios/holdings');
        // The fixture holds 500 AAPL at $165.30 in Main Portfolio; 100 more at $200 elsewhere.
        const res = await page.request.post('/api/portfolio/import', {
            data: { newPortfolioName: 'Roth IRA', rows: [{ symbol: 'AAPL', name: 'Apple Inc.', quantity: 100, avgCost: 200 }] },
        });
        expect(res.status()).toBe(200);

        await gotoAppPage(page, '/portfolios/holdings');
        await expect(rowChoice(page).getByRole('radio', { name: 'By account' })).toHaveAttribute('aria-checked', 'true');
        await expect(rowsFor(page, 'AAPL')).toHaveCount(2);

        await rowChoice(page).getByRole('radio', { name: 'By symbol' }).click();
        await expect(rowsFor(page, 'AAPL')).toHaveCount(1);
        const aapl = rowsFor(page, 'AAPL');
        await expect(aapl.getByRole('cell').nth(3)).toHaveText('600');
        // (500 × $165.30 + 100 × $200) / 600 shares.
        await expect(aapl.getByRole('cell').nth(4)).toHaveText('$171.08');
        await expect(aapl.getByRole('cell').nth(5)).toHaveText('$190.00');
        await expect(aapl.getByTestId('holding-value')).toHaveText('$114,000');
        await expect(aapl.getByTestId('holding-today')).toHaveText('+1.06%');
        await expect(aapl.getByRole('cell').nth(8)).toHaveText('+11.06%');
        const accounts = aapl.getByRole('link', { name: '2 accounts: Main Portfolio, Roth IRA' });
        await expect(accounts).toHaveAttribute('href', '/portfolios/detail/AAPL');
        // A symbol in one account still names it.
        await expect(rowsFor(page, 'MSFT').locator('.pm-account-pill')).toHaveText('Main Portfolio');
        // Today P&L is the same either way: $2 a share on 600 shares.
        await expect(page.locator('.pm-summary-cell').filter({ hasText: 'Today P&L' }).locator('.pm-summary-value')).toHaveText('+$1,200');

        // Kept in the address, so a reload opens the same view.
        await expect(page).toHaveURL(/[?&]view=symbol(&|$)/);
        await reloadAppPage(page);
        await expect(rowChoice(page).getByRole('radio', { name: 'By symbol' })).toHaveAttribute('aria-checked', 'true');
        await expect(rowsFor(page, 'AAPL')).toHaveCount(1);

        await rowChoice(page).getByRole('radio', { name: 'By account' }).click();
        await expect(rowsFor(page, 'AAPL')).toHaveCount(2);
        await expect(page).not.toHaveURL(/view=/);

        // The choice fits a phone without the page scrolling sideways (loaded
        // at that width, as the phone layout checks in smoke.spec.ts are).
        await page.setViewportSize({ width: 390, height: 844 });
        await reloadAppPage(page);
        await expect(rowChoice(page)).toBeVisible();
        const overflow = await page.evaluate(() => {
            const main = document.querySelector('main');
            return {
                doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                main: main ? main.scrollWidth - main.clientWidth : 0,
            };
        });
        expect(overflow.doc).toBeLessThanOrEqual(1);
        expect(overflow.main).toBeLessThanOrEqual(1);
    });

    test('without a symbol in more than one account there is no choice of rows', async ({ context, page }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/portfolios/holdings?view=symbol');
        await expect(rowsFor(page, 'AAPL')).toHaveCount(1);
        await expect(rowChoice(page)).toHaveCount(0);
        await expect(rowsFor(page, 'AAPL').locator('.pm-account-pill')).toHaveText('Main Portfolio');
    });
});

test.describe('Holdings › Small positions', () => {
    // Positions worth very little are one row after the rest that opens in
    // place (src/lib/holdings/small-positions.ts): each under $500 and under
    // 0.5% of the table's market value, three or more, never every position
    // shown. The made-up tickers (ZQA…ZQE, ZQ001…ZQ080) have no reference
    // data or stored prices, so they're valued at cost unless a quote prices
    // them, and their sector is Other.
    test.skip(!databaseAuthEnabled, 'positions are imported into the database');

    const group = (page: Page) => page.getByTestId('small-positions-group');
    const toggle = (page: Page) => group(page).getByRole('button');
    const members = (page: Page) => page.getByTestId('small-position-row');
    const bodyRows = (page: Page) => page.getByTestId('holdings-table').locator('tbody > tr:not([aria-hidden])');
    const symbols = (page: Page) => bodyRows(page).locator('.pm-holdings-sym');
    const summaryValue = (page: Page, label: string) =>
        page.locator('.pm-summary-cell').filter({ hasText: label }).locator('.pm-summary-value');
    /** How much of a row shows inside the table's card, which scrolls once the table draws only part of itself: 1 is all of it. */
    const shownInCard = (row: Locator) => row.evaluate((el) => {
        const card = el.closest('[data-virtualized]')?.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        if (!card || box.height === 0) return 0;
        return Math.max(0, Math.min(box.bottom, card.bottom) - Math.max(box.top, card.top)) / box.height;
    });
    /** The symbols of the rows that show inside the table's card. */
    const symbolsShownInCard = (page: Page) => page.getByTestId('holdings-table').evaluate((table) => {
        const card = table.closest('[data-virtualized]')?.getBoundingClientRect();
        if (!card) return [];
        return [...table.querySelectorAll('tbody > tr:not([aria-hidden])')]
            .filter((tr) => {
                const box = tr.getBoundingClientRect();
                return box.bottom > card.top && box.top < card.bottom;
            })
            .map((tr) => tr.querySelector('.pm-holdings-sym')?.textContent ?? '');
    });
    // $20,000 and $16,000 at cost, and five positions worth $10 to $15 at cost.
    const ROBO_ROWS = [
        { symbol: 'AAPL', name: 'Apple Inc.', quantity: 100, avgCost: 200 },
        { symbol: 'MSFT', name: 'Microsoft Corp', quantity: 40, avgCost: 400 },
        { symbol: 'ZQA', name: 'Fund A', quantity: 2, avgCost: 5 },
        { symbol: 'ZQB', name: 'Fund B', quantity: 1, avgCost: 12 },
        { symbol: 'ZQC', name: 'Fund C', quantity: 2, avgCost: 7 },
        { symbol: 'ZQD', name: 'Fund D', quantity: 0.5, avgCost: 30 },
        { symbol: 'ZQE', name: 'Fund E', quantity: 0.25, avgCost: 44 },
    ];

    async function importInto(page: Page, newPortfolioName: string, rows: readonly object[]): Promise<string> {
        const res = await page.request.post('/api/portfolio/import', { data: { newPortfolioName, rows } });
        expect(res.status()).toBe(200);
        return (await res.json()).data.portfolioId;
    }

    /** Opens the group with Enter, pressed again if the first lands before the page hydrates. */
    async function openWithKeyboard(page: Page) {
        await expect(async () => {
            if ((await toggle(page).getAttribute('aria-expanded')) !== 'true') {
                await toggle(page).focus();
                await page.keyboard.press('Enter');
            }
            await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
    }

    /** Opens the group with a click, again if the first lands before the page hydrates. */
    async function openWithClick(page: Page) {
        await expect(async () => {
            if ((await toggle(page).getAttribute('aria-expanded')) !== 'true') await toggle(page).click();
            await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true', { timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
    }

    test.beforeEach(async ({ context, page }) => {
        // A new user, so the book is exactly what each test imports.
        await signInAsNewUser(context, { firstSignIn: true });
        await page.route('**/api/market-data/historical**', (route) => route.fulfill({ status: 200, json: { data: [] } }));
    });

    test('positions worth very little are one row after the rest, which opens from the keyboard, and every total still counts them', async ({ page }) => {
        // MSFT and ZQD have closes from three days ago: priced, with no move today.
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        const close = (symbol: string, price: number) => ({ symbol, price, change: 0, changePercent: 0, timestamp: threeDaysAgo, kind: 'close', isRealtime: false });
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: { data: [close('MSFT', 440), close('ZQD', 46)] } }));
        const accountId = await importInto(page, 'Robo account', ROBO_ROWS);
        const fund = await page.request.post('/api/portfolio/manual-holdings', {
            data: { portfolioId: accountId, holding: { name: 'Plan fund', value: 5, valueAsOf: new Date().toISOString().slice(0, 10) } },
        });
        expect(fund.status()).toBe(201);
        await gotoAppPage(page, '/portfolios/holdings');

        // $37,670 in all: AAPL $20,000 at cost, MSFT $17,600, and five
        // positions worth $10 to $23, each under 0.5% of it ($188.35). They're
        // at cost until the quotes arrive ($62), then ZQD is at $46.
        await expect(group(page).getByTestId('holding-value')).toHaveText('$70 partly at cost');
        await expect(group(page).getByRole('button', { name: '5 small positions', exact: true })).toHaveAttribute('aria-expanded', 'false');
        await expect(group(page).locator('.pm-small-positions-note')).toHaveText('Each under 0.5% of market value');
        await expect(group(page).getByTestId('holding-today')).toHaveText('—');
        // ZQD's $23 on $15; the others have no price, so no return.
        await expect(group(page).getByRole('cell').nth(3)).toHaveText('+53.33%');
        // Under 1%, an allocation is to a hundredth of a percent.
        await expect(group(page).locator('.pm-alloc-bar-cell')).toHaveText('0.19%');
        await expect(group(page).locator('.pm-account-pill')).toHaveText('Robo account');
        // Closed, its positions aren't drawn, and it comes after every other row.
        await expect(members(page)).toHaveCount(0);
        await expect(symbols(page)).toHaveText(['AAPL', 'MSFT']);
        await expect(bodyRows(page)).toHaveCount(3);
        await expect(bodyRows(page).last()).toHaveAttribute('data-testid', 'small-positions-group');
        // Every total still counts them.
        await expect(summaryValue(page, 'Market value')).toHaveText('$37,670');
        await expect(summaryValue(page, 'Positions')).toHaveText('7');
        // A holding valued by hand stays in its own card, never in the group.
        await expect(page.getByTestId('manual-holdings-table').getByRole('row').filter({ hasText: 'Plan fund' })).toContainText('$5.00');
        await expect(toggle(page)).toHaveText('5 small positions');

        // Enter opens it in place, its positions in the table's order, and
        // the button keeps focus.
        await openWithKeyboard(page);
        await expect(toggle(page)).toBeFocused();
        await expect(bodyRows(page)).toHaveCount(8);
        await expect(bodyRows(page).nth(2)).toHaveAttribute('data-testid', 'small-positions-group');
        await expect(symbols(page)).toHaveText(['AAPL', 'MSFT', 'ZQD', 'ZQC', 'ZQB', 'ZQE', 'ZQA']);
        // To the cent, which counts for positions worth a few dollars; the
        // other rows keep whole dollars and an allocation to a tenth.
        await expect(members(page).getByTestId('holding-value')).toHaveText(['$23.00', '$14.00 at cost', '$12.00 at cost', '$11.00 at cost', '$10.00 at cost']);
        await expect(bodyRows(page).first().getByTestId('holding-value')).toHaveText('$20,000 at cost');
        await expect(bodyRows(page).first().locator('.pm-alloc-bar-cell')).toHaveText('53.1%');

        // Sorted by total return (MSFT +10.00%; AAPL has no price, so none),
        // the group stays last and its positions follow the sort.
        await page.getByLabel('Sort holdings by').selectOption('totalReturnPct');
        await expect(symbols(page)).toHaveText(['MSFT', 'AAPL', 'ZQD', 'ZQA', 'ZQB', 'ZQC', 'ZQE']);
        await expect(bodyRows(page).nth(2)).toHaveAttribute('data-testid', 'small-positions-group');

        // Space closes it, focus staying on the button.
        await toggle(page).focus();
        await page.keyboard.press('Space');
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(toggle(page)).toBeFocused();
        await expect(members(page)).toHaveCount(0);

        // A filter that leaves only small positions lists them: a group
        // never holds every position shown.
        const sectors = page.getByRole('radiogroup', { name: 'Filter by sector' });
        await sectors.getByRole('radio', { name: 'Other' }).click();
        await expect(symbols(page)).toHaveText(['ZQD', 'ZQA', 'ZQB', 'ZQC', 'ZQE']);
        await expect(group(page)).toHaveCount(0);
        await sectors.getByRole('radio', { name: 'All' }).click();
        await expect(toggle(page)).toHaveText('5 small positions');

        // Left open, it's closed again on the next visit.
        await openWithClick(page);
        await reloadAppPage(page);
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(members(page)).toHaveCount(0);

        // The account export keeps every holding, the one valued by hand too.
        const exported = await (await page.request.get('/api/account/export')).json() as {
            accounts: Array<{ name: string; holdings: Array<{ symbol: string }>; manualHoldings: Array<{ name: string }> }>;
        };
        const robo = exported.accounts.find((a) => a.name === 'Robo account');
        expect(robo?.holdings.map((h) => h.symbol).sort()).toEqual(['AAPL', 'MSFT', 'ZQA', 'ZQB', 'ZQC', 'ZQD', 'ZQE']);
        expect(robo?.manualHoldings.map((m) => m.name)).toEqual(['Plan fund']);
    });

    test('By symbol judges a symbol across its accounts, a group in two accounts names both, and an open group stays open across the switch', async ({ page }) => {
        // No quotes: everything is valued at cost.
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: { data: [] } }));
        await importInto(page, 'Robo account', ROBO_ROWS);
        await importInto(page, 'Brokerage', [
            { symbol: 'ZQA', name: 'Fund A', quantity: 100, avgCost: 5 },
            { symbol: 'ZQF', name: 'Fund F', quantity: 1, avgCost: 8 },
        ]);
        await gotoAppPage(page, '/portfolios/holdings');

        // $36,570 in all, so a small position is under $182.85: Robo
        // account's $10 of ZQA is, Brokerage's $500 isn't, and Brokerage's
        // $8 of ZQF is.
        const zqa = bodyRows(page).filter({ has: page.getByText('ZQA', { exact: true }) });
        await expect(symbols(page)).toHaveText(['AAPL', 'MSFT', 'ZQA']);
        await expect(zqa.getByTestId('holding-value')).toHaveText('$500 at cost');
        await expect(zqa.locator('.pm-account-pill')).toHaveText('Brokerage');
        await expect(toggle(page)).toHaveText('6 small positions');
        await expect(group(page).getByTestId('holding-value')).toHaveText('$70 at cost');
        // Its positions are in two accounts: the pill says "2 accounts" and
        // names them in its tooltip and in hidden text a screen reader reads
        // out, as it may not read a title.
        const accounts = group(page).locator('.pm-account-pill');
        await expect(accounts).toHaveText('2 accounts: Brokerage, Robo account');
        await expect(accounts).toHaveAttribute('title', 'Brokerage, Robo account');
        await expect(accounts.locator('.sr-only')).toHaveText(': Brokerage, Robo account');
        // Opened, each of its positions names its account on screen.
        await openWithClick(page);
        await expect(members(page)).toHaveCount(6);
        await expect(members(page).locator('.pm-account-pill')).toHaveText(['Robo account', 'Robo account', 'Robo account', 'Robo account', 'Robo account', 'Brokerage']);
        await expect(members(page).filter({ has: page.getByText('ZQA', { exact: true }) }).getByTestId('holding-value')).toHaveText('$10.00 at cost');

        // By symbol, ZQA is worth $510 across its two accounts: a row of its
        // own. The group is still open, and still in both accounts.
        await page.getByRole('radiogroup', { name: 'Show holdings' }).getByRole('radio', { name: 'By symbol' }).click();
        await expect(page).toHaveURL(/[?&]view=symbol(&|$)/);
        await expect(toggle(page)).toHaveText('5 small positions');
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(group(page).getByTestId('holding-value')).toHaveText('$60 at cost');
        await expect(accounts).toHaveText('2 accounts: Brokerage, Robo account');
        await expect(members(page).locator('.pm-holdings-sym')).toHaveText(['ZQD', 'ZQC', 'ZQB', 'ZQE', 'ZQF']);
        await expect(zqa).toHaveCount(1);
        await expect(zqa.getByTestId('holding-value')).toHaveText('$510 at cost');
        await expect(zqa.getByRole('link', { name: '2 accounts: Brokerage, Robo account' })).toHaveAttribute('href', '/portfolios/detail/ZQA');
    });

    test('a long open group scrolls inside its card with focus kept on its button and the headings in view, is where it was after a filter, and fits a phone', async ({ page }) => {
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: { data: [] } }));
        // Eighty positions worth $2 each, as a robo-advisor's fractional shares can be.
        const funds = Array.from({ length: 80 }, (_, i) => ({ symbol: `ZQ${String(i + 1).padStart(3, '0')}`, name: `Fund ${i + 1}`, quantity: 1, avgCost: 2 }));
        await importInto(page, 'Robo account', [...ROBO_ROWS.slice(0, 2), ...funds]);
        await gotoAppPage(page, '/portfolios/holdings');

        const card = page.locator('[data-virtualized]').filter({ has: page.getByTestId('holdings-table') });
        await expect(toggle(page)).toHaveText('80 small positions');
        await expect(group(page).getByTestId('holding-value')).toHaveText('$160 at cost');
        await expect(group(page).locator('.pm-alloc-bar-cell')).toHaveText('0.44%');
        await expect(card).toHaveAttribute('data-virtualized', 'false');

        // Open, the table's 83 rows scroll inside the card, which draws only
        // the rows around the group's: its button stays, with focus.
        await openWithKeyboard(page);
        await expect(card).toHaveAttribute('data-virtualized', 'true');
        await expect(toggle(page)).toBeFocused();
        await expect(toggle(page)).toBeInViewport();
        await expect(members(page).first()).toBeVisible();
        const drawn = await members(page).count();
        expect(drawn).toBeGreaterThan(0);
        expect(drawn).toBeLessThan(80);
        // Regression: the card stays where it was, so the column headings
        // and the positions above the group are still in view inside it.
        await expect.poll(() => shownInCard(page.getByTestId('holdings-table').locator('thead tr'))).toBeGreaterThan(0.99);
        await expect.poll(() => shownInCard(bodyRows(page).filter({ has: page.getByText('AAPL', { exact: true }) }))).toBeGreaterThan(0.99);

        await page.keyboard.press('Enter');
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(card).toHaveAttribute('data-virtualized', 'false');
        await expect(toggle(page)).toBeFocused();
        await expect(members(page)).toHaveCount(0);

        // Regression: scrolled to its end, then filtered to rows it draws in
        // full and back, the card returns where it was with those rows drawn,
        // not blank space above rows drawn out of sight.
        await openWithClick(page);
        await card.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        await expect.poll(() => symbolsShownInCard(page)).toContain('ZQ080');
        const sectors = page.getByRole('radiogroup', { name: 'Filter by sector' });
        await sectors.getByRole('radio', { name: 'Other' }).click();
        await expect(card).toHaveAttribute('data-virtualized', 'false');
        await sectors.getByRole('radio', { name: 'All' }).click();
        await expect(card).toHaveAttribute('data-virtualized', 'true');
        await expect.poll(() => symbolsShownInCard(page)).toContain('ZQ080');

        // On a phone (loaded at that width, as smoke.spec.ts's phone checks
        // are), it opens without the page scrolling sideways.
        await page.setViewportSize({ width: 390, height: 844 });
        await reloadAppPage(page);
        await expect(toggle(page)).toBeVisible();
        await openWithClick(page);
        await expect(members(page).first()).toBeVisible();
        const overflow = await page.evaluate(() => {
            const main = document.querySelector('main');
            return {
                doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                main: main ? main.scrollWidth - main.clientWidth : 0,
            };
        });
        expect(overflow.doc).toBeLessThanOrEqual(1);
        expect(overflow.main).toBeLessThanOrEqual(1);
    });
});

test.describe('Holdings prices', () => {
    // Launch item i33: one line under the summary says what the prices are.
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/market-data/historical**', (route) => route.fulfill({ status: 200, json: { data: [] } }));
    });
    const aapl = (overrides: Record<string, unknown>) => ({
        data: [{ symbol: 'AAPL', price: 190, change: 2, changePercent: 1.06, timestamp: new Date().toISOString(), kind: 'delayed', isRealtime: false, ...overrides }],
    });

    test('with holdings: a delayed quote is labelled delayed with its time, and is today\'s move', async ({ page }) => {
        const quotedAt = new Date();
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: aapl({ timestamp: quotedAt.toISOString() }) }));
        await gotoAppPage(page, '/portfolios/holdings');
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(quotedAt);
        await expect(page.getByTestId('holdings-price-note')).toHaveText(new RegExp(`^Delayed quotes, as of (\\w{3} \\d{1,2} )?${clock} ET$`));
        await expect(page.getByTestId('holdings-table').locator('tbody tr').filter({ hasText: 'AAPL' }).getByTestId('holding-today')).toHaveText('+1.06%');
    });

    test('with holdings: a close is labelled with its session; without any quote, the stored prices say so', async ({ page }) => {
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: aapl({ kind: 'close', timestamp: '2026-10-30T20:00:00.000Z' }) }));
        await gotoAppPage(page, '/portfolios/holdings');
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        await expect(page.getByTestId('holdings-price-note')).toHaveText(/^Closing prices from Oct 30(, 2026)?$/);

        await page.unroute('**/api/market-data/quotes**');
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: { data: [] } }));
        await gotoAppPage(page, '/portfolios/holdings');
        await expect(page.getByTestId('holdings-price-note')).toHaveText('Prices stored with your holdings');
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

    test('a file covering several accounts previews each one and sends each to its own account', async ({ page }) => {
        let sent: { accounts?: { newPortfolioName?: string; portfolioId?: string; rows: { symbol: string }[] }[] } | undefined;
        await page.route('**/api/portfolio/import', async (route) => {
            sent = route.request().postDataJSON();
            const result = { portfolioId: 'x', createdPortfolio: true, insert: 1, update: 0, unchanged: 0, options: { insert: 0, update: 0, unchanged: 0 } };
            await route.fulfill({ status: 200, json: { data: { accounts: [result, result] } } });
        });
        await gotoAppPage(page, '/portfolios/holdings');
        await openImport(page, 'Account Name,Symbol,Description,Quantity,Average Cost\nRoth IRA Test,VTI,VANGUARD TOTAL,10,200\nHSA Test,AAPL,APPLE INC,5,150\n');
        const preview = page.getByTestId('import-preview');
        await expect(preview).toContainText('2 positions in 2 accounts ready');
        const targets = page.getByTestId('import-account-target');
        await expect(targets).toHaveCount(2);
        await expect(targets.nth(0)).toContainText('Roth IRA Test (1 position)');
        await expect(page.getByLabel('New account name for HSA Test')).toHaveValue('HSA Test');
        await page.getByRole('button', { name: 'Import 2 positions' }).click();
        await expect(page.getByText('Imported 2 positions across 2 accounts', { exact: false })).toBeVisible();
        expect(sent?.accounts?.map((a) => [a.newPortfolioName, a.rows.map((r) => r.symbol)])).toEqual([
            ['Roth IRA Test', ['VTI']],
            ['HSA Test', ['AAPL']],
        ]);
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
        // Nothing valued by hand in the file, so nothing of it is sent.
        expect(sent).not.toHaveProperty('manual');
        expect(sent).not.toHaveProperty('valuesAsOf');
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

    test('a fund with no ticker previews as valued by hand, as of the day chosen, and is sent apart from the positions', async ({ page }) => {
        let sent: Record<string, unknown> = {};
        await page.route('**/api/portfolio/import', async (route) => {
            sent = route.request().postDataJSON();
            await route.fulfill({ status: 200, json: { data: {
                portfolioId: 'p', createdPortfolio: false, insert: 1, update: 0, unchanged: 0,
                options: { insert: 0, update: 0, unchanged: 0 }, manual: { insert: 2, update: 0, unchanged: 0, replacedPositions: 0 },
            } } });
        });
        await gotoAppPage(page, '/portfolios/holdings');
        await openImport(page, [
            'Symbol,Description,Quantity,Average Cost,Market Value',
            'NVDA,NVIDIA Corp,10,450.25,4600.00',
            '--,Target 2055 Trust,120.5,,"12,345.67"',
            '99ZZ12341,Stable Value Fund,,,"$10,000.00"',
        ].join('\n'));
        const dialog = page.getByTestId('import-dialog');
        await expect(page.getByTestId('import-preview')).toContainText('positions.csv: 1 position and 2 valued by hand ready.');
        await expect(dialog.getByRole('table', { name: 'Positions to import' }).locator('tbody tr')).toHaveCount(1);
        const handValued = dialog.getByRole('table', { name: 'Holdings valued by hand to import' }).locator('tbody tr');
        await expect(handValued).toHaveCount(2);
        await expect(handValued.nth(0)).toContainText('Target 2055 Trust');
        await expect(handValued.nth(0)).toContainText('$12,345.67');
        await expect(handValued.nth(0)).toContainText('New');
        // Its CUSIP under its name; no units in the file.
        await expect(handValued.nth(1)).toContainText('Stable Value Fund99ZZ12341');
        await expect(handValued.nth(1).locator('td').nth(1)).toHaveText('—');
        await expect(dialog).toContainText("Atlas can't price these, so each counts at the file's value until the next import or your own update.");

        // The browser's today to start with; a later day isn't allowed.
        const today = await page.evaluate(() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        });
        const date = dialog.getByLabel('Values as of');
        // Holdings, not positions: two of the three are valued by hand.
        const importButton = dialog.getByRole('button', { name: 'Import 3 holdings' });
        await expect(date).toHaveValue(today);
        await date.fill('2099-01-02');
        await expect(dialog.getByRole('alert')).toHaveText("Choose a date that isn't in the future.");
        await expect(date).toHaveAccessibleDescription("Choose a date that isn't in the future.");
        await expect(importButton).toBeDisabled();
        // Cleared, the day is asked for rather than Import just turning off.
        await date.fill('');
        await expect(dialog.getByRole('alert')).toHaveText('Choose the day these values are from.');
        await expect(date).toHaveAccessibleDescription('Choose the day these values are from.');
        await expect(importButton).toBeDisabled();
        await date.fill('2026-11-02');
        await expect(dialog.getByRole('alert')).toHaveCount(0);
        await expect(date).not.toHaveAttribute('aria-describedby');

        await importButton.click();
        await expect(page.getByText('Imported 1 position: 1 new, 0 updated. Valued by hand: 2 new, 0 updated.')).toBeVisible();
        expect(sent.rows).toEqual([{ symbol: 'NVDA', name: 'NVIDIA Corp', quantity: 10, avgCost: 450.25 }]);
        expect(sent.manual).toEqual([
            { name: 'Target 2055 Trust', identifier: null, quantity: 120.5, value: 12345.67, costBasis: null },
            { name: 'Stable Value Fund', identifier: '99ZZ12341', quantity: null, value: 10000, costBasis: null },
        ]);
        expect(sent.valuesAsOf).toBe('2026-11-02');
    });

    test('without a value column, a fund with no ticker is listed with how to bring it in, and nothing can be imported', async ({ page }) => {
        let requests = 0;
        await page.route('**/api/portfolio/import', (route) => {
            requests++;
            return route.fulfill({ status: 500, json: { error: 'unexpected request' } });
        });
        await gotoAppPage(page, '/portfolios/holdings');
        await openImport(page, 'Symbol,Description,Quantity,Average Cost\nMSFT,Microsoft,2,300\n,Target 2055 Trust,120.5,');
        const preview = page.getByTestId('import-preview');
        await expect(preview).toContainText('positions.csv: 1 position ready, 1 row needs attention.');
        await expect(preview.getByRole('list', { name: 'Rows not imported' })).toHaveText(
            'Line 3: Target 2055 Trust: no ticker. Add a market value column to bring it in valued by hand, or add it on Holdings.',
        );
        await expect(page.getByRole('table', { name: 'Holdings valued by hand to import' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Import 1 position', exact: true })).toBeDisabled();
        expect(requests).toBe(0);
    });

    test('database: a 401(k) trust with no ticker comes in valued by hand, and the next statement updates it and keeps both days', async ({ context, page }) => {
        test.skip(!databaseAuthEnabled, 'holdings valued by hand are saved in the database');
        const userId = await signInAsNewUser(context);
        await gotoAppPage(page, '/portfolios/holdings');
        const statement = (value: string) => `Symbol,Description,Quantity,Market Value\n,Target 2055 Trust,120.5,"${value}"`;
        const dialog = page.getByTestId('import-dialog');
        const planned = dialog.getByRole('table', { name: 'Holdings valued by hand to import' }).locator('tbody tr');

        await openImport(page, statement('12,345.67'));
        await expect(page.getByTestId('import-preview')).toContainText('positions.csv: 1 holding valued by hand ready.');
        await expect(planned).toContainText('New');
        await dialog.getByLabel('New account name').fill('Workplace 401k');
        await dialog.getByLabel('Values as of').fill('2026-11-02');
        await dialog.getByRole('button', { name: 'Import 1 holding' }).click();
        await expect(page.getByText('Imported 1 holding valued by hand: 1 new, 0 updated.')).toBeVisible();
        // Nothing with a ticker yet; the trust is on its own card.
        await expect(page.getByTestId('holdings-empty').getByRole('heading')).toHaveText('No holdings with a ticker yet');
        const rows = page.getByTestId('manual-holdings-table').getByRole('row').filter({ hasText: 'Target 2055 Trust' });
        await expect(rows).toHaveCount(1);
        await expect(rows).toContainText('from your CSV import');
        await expect(rows).toContainText('Workplace 401k');
        await expect(rows).toContainText('$12,345.67');
        await expect(rows).toContainText('Nov 2, 2026');

        await openImport(page, statement('12,500.00'));
        await expect(planned).toContainText('Updates');
        await dialog.getByLabel('Values as of').fill('2026-11-03');
        await dialog.getByRole('button', { name: 'Import 1 holding' }).click();
        await expect(page.getByText('Imported 1 holding valued by hand: 0 new, 1 updated.')).toBeVisible();
        await expect(rows).toContainText('$12,500.00');
        await expect(rows).toHaveCount(1);
        const values = await e2eDatabase()<{ date: string; value: string }[]>`
            SELECT to_char(v.date, 'YYYY-MM-DD') AS date, v.value::text AS value
            FROM manual_holding_values v JOIN manual_holdings m ON m.id = v.manual_holding_id
            WHERE m.user_id = ${userId}
            ORDER BY v.date`;
        expect(values.map((v) => [v.date, Number(v.value)])).toEqual([['2026-11-02', 12345.67], ['2026-11-03', 12500]]);

        // A file without the trust says it stays.
        await openImport(page, 'Symbol,Description,Quantity,Market Value\n99ZZ12341,Stable Value Fund,,"$10,000.00"');
        await expect(planned).toContainText('New');
        await expect(dialog.getByTestId('import-not-in-file')).toHaveText(
            "1 holding valued by hand that an earlier file brought into Workplace 401k isn't in this one. It stays as it is; delete it on Holdings if it's gone.",
        );
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(rows).toHaveCount(1);
    });

    test('database: a holding added by hand is the one the next file updates', async ({ context, page }) => {
        test.skip(!databaseAuthEnabled, 'holdings valued by hand are saved in the database');
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/portfolios/holdings');
        const card = page.getByTestId('manual-holdings');
        await card.getByRole('button', { name: 'Add holding' }).click();
        const add = page.getByRole('dialog');
        await add.getByLabel('Account').selectOption({ label: 'Main Portfolio' });
        await add.getByLabel('Holding').fill('Target 2055 Trust');
        await add.getByLabel('Value ($)').fill('12,000');
        await add.getByRole('button', { name: 'Add holding' }).click();
        await expect(add).toBeHidden();
        const rows = card.getByTestId('manual-holdings-table').getByRole('row').filter({ hasText: 'Target 2055 Trust' });
        await expect(rows).toHaveCount(1);
        await expect(rows).not.toContainText('from your CSV import');

        await openImport(page, 'Symbol,Description,Quantity,Market Value\n,Target 2055 Trust,120.5,"12,345.67"\n');
        const dialog = page.getByTestId('import-dialog');
        await dialog.getByLabel('Import into').selectOption({ label: 'Main Portfolio' });
        await expect(dialog.getByRole('table', { name: 'Holdings valued by hand to import' }).locator('tbody tr')).toContainText('Updates');
        await dialog.getByRole('button', { name: 'Import 1 holding' }).click();
        await expect(page.getByText('Imported 1 holding valued by hand: 0 new, 1 updated.')).toBeVisible();
        await expect(rows).toContainText('$12,345.67');
        await expect(rows).toHaveCount(1);
        await expect(rows).toContainText('from your CSV import');
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
            data: JSON.stringify({ newPortfolioName: 'x', rows: [], pad: 'x'.repeat(400 * 1024) }),
        });
        expect(res.status()).toBe(413);
    });

    test('a holding valued by hand with a negative value, or values from a future date, is refused before the database is touched', async ({ page }) => {
        await gotoAppPage(page, '/portfolios/holdings');
        const fund = { name: 'Target 2055 Trust', value: 12345.67 };
        const negative = await page.request.post('/api/portfolio/import', { data: { newPortfolioName: 'Refused import', rows: [], manual: [{ ...fund, value: -1 }] } });
        expect(negative.status()).toBe(400);
        expect(await negative.json()).toMatchObject({ code: 'INVALID_IMPORT', error: "Value can't be negative" });
        const future = await page.request.post('/api/portfolio/import', { data: { newPortfolioName: 'Refused import', rows: [], manual: [fund], valuesAsOf: '2099-01-02' } });
        expect(future.status()).toBe(400);
        expect(await future.json()).toMatchObject({ code: 'INVALID_IMPORT', error: "The values can't be from a future date" });
        if (dbMode) expect((await e2eDatabase()`SELECT 1 FROM portfolios WHERE name = 'Refused import'`).length).toBe(0);
    });

    /**
     * A linked account, "Brokerage Link", with the fund its sync brought in
     * (a holding valued by hand that Plaid keys), set up in the database
     * without Plaid. `syncStatus` is its Plaid account's: "sync_ready" while
     * it syncs, "excluded" once disconnected.
     */
    async function seedLinkedAccount(userId: string, syncStatus: 'sync_ready' | 'excluded') {
        const sql = e2eDatabase();
        return sql.begin(async (transaction) => {
            // postgres.js types a transaction without its tagged-template call.
            const tx = transaction as unknown as typeof sql;
            const [item] = await tx<{ id: string }[]>`
                INSERT INTO plaid_items (user_id, plaid_item_id, institution_name, access_token_ciphertext, access_token_iv, access_token_auth_tag)
                VALUES (${userId}, ${`item-${userId}`}, 'Example Brokerage', 'x', 'x', 'x') RETURNING id`;
            await tx`
                INSERT INTO plaid_accounts (user_id, plaid_item_record_id, plaid_account_id, name, type, subtype, capabilities, verification_status, sync_status)
                VALUES (${userId}, ${item.id}, ${`acc-${userId}`}, 'Individual', 'investment', 'brokerage', '[]', 'automatically_verified', ${syncStatus})`;
            const [linked] = await tx<{ id: string }[]>`
                INSERT INTO portfolios (user_id, name, source, external_account_id)
                VALUES (${userId}, 'Brokerage Link', 'plaid', ${`acc-${userId}`}) RETURNING id`;
            const [fund] = await tx<{ id: string }[]>`
                INSERT INTO manual_holdings (user_id, portfolio_id, name, value, value_as_of, source, external_id)
                VALUES (${userId}, ${linked.id}, 'Target 2055 Trust', 11000, '2026-10-30', 'plaid', ${`${linked.id}:sec_fund`}) RETURNING id`;
            return { linked, fund };
        });
    }
    const LINKED_FILE = 'Symbol,Description,Quantity,Average Cost,Market Value\nNVDA,NVIDIA Corp,10,450.25,4600.00\n,Target 2055 Trust,120.5,,"12,345.67"\n';

    test('database: holdings valued by hand into a linked account that still syncs are refused, the dialog says so first, and its positions alone still import', async ({ context, page }) => {
        test.skip(!dbMode, 'needs the seeded E2E database');
        const userId = await signInAsFreshUser(context);
        const { linked } = await seedLinkedAccount(userId, 'sync_ready');
        const refusal = 'Brokerage Link is linked to your bank, so its holdings without a ticker come from there. Import this file into another account.';
        await gotoAppPage(page, '/portfolios/holdings');
        await openImport(page, LINKED_FILE);
        const dialog = page.getByTestId('import-dialog');
        await dialog.getByLabel('Import into').selectOption({ label: 'Brokerage Link' });
        await expect(dialog.getByRole('alert')).toHaveText(refusal);
        await expect(dialog.getByRole('button', { name: 'Import 2 holdings' })).toBeDisabled();

        const rows = [{ symbol: 'NVDA', name: 'NVIDIA Corp', quantity: 10, avgCost: 450.25 }];
        const written = async () => (await e2eDatabase()<{ n: number }[]>`
            SELECT ((SELECT count(*) FROM holdings WHERE portfolio_id = ${linked.id})
                + (SELECT count(*) FROM manual_holdings WHERE portfolio_id = ${linked.id} AND source <> 'plaid'))::int AS n`)[0].n;
        const refused = await page.request.post('/api/portfolio/import', {
            data: { portfolioId: linked.id, rows, manual: [{ name: 'Target 2055 Trust', quantity: 120.5, value: 12345.67 }], valuesAsOf: '2026-11-02' },
        });
        expect(refused.status()).toBe(409);
        expect(await refused.json()).toMatchObject({ code: 'LINKED_ACCOUNT', error: refusal });
        expect(await written()).toBe(0);

        const positionsOnly = await page.request.post('/api/portfolio/import', { data: { portfolioId: linked.id, rows } });
        expect(positionsOnly.status()).toBe(200);
        expect((await positionsOnly.json()).data).toMatchObject({ insert: 1, manual: { insert: 0, update: 0, unchanged: 0, replacedPositions: 0 } });
        expect(await written()).toBe(1);
    });

    test('database: once a linked account no longer syncs, a file updates the fund its last sync brought in', async ({ context, page }) => {
        test.skip(!dbMode, 'needs the seeded E2E database');
        const userId = await signInAsFreshUser(context);
        const { fund } = await seedLinkedAccount(userId, 'excluded');
        await gotoAppPage(page, '/portfolios/holdings');
        const rows = page.getByTestId('manual-holdings-table').getByRole('row').filter({ hasText: 'Target 2055 Trust' });
        await expect(rows).toContainText('from your linked account');

        await openImport(page, LINKED_FILE);
        const dialog = page.getByTestId('import-dialog');
        await dialog.getByLabel('Import into').selectOption({ label: 'Brokerage Link' });
        await expect(dialog.getByRole('alert')).toHaveCount(0);
        await expect(dialog.getByRole('table', { name: 'Holdings valued by hand to import' }).locator('tbody tr')).toContainText('Updates');
        await dialog.getByLabel('Values as of').fill('2026-11-02');
        await dialog.getByRole('button', { name: 'Import 2 holdings' }).click();
        await expect(page.getByText('Imported 1 position: 1 new, 0 updated. Valued by hand: 0 new, 1 updated.')).toBeVisible();
        // The same holding, now the file's: one row, at the file's value.
        await expect(rows).toHaveCount(1);
        await expect(rows).toContainText('$12,345.67');
        await expect(rows).toContainText('from your CSV import');
        const [saved] = await e2eDatabase()<{ id: string; source: string }[]>`
            SELECT id, source FROM manual_holdings WHERE user_id = ${userId} AND name = 'Target 2055 Trust'`;
        expect(saved).toEqual({ id: fund.id, source: 'csv' });
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

    test('database: past the day\'s CSV imports, holdings and transactions are refused and the dialog says why (launch item i77)', async ({ context, page }) => {
        test.skip(!dbMode, 'needs the seeded E2E database');
        // A user of its own: the quota is per user, and this one spends it all.
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/portfolios/holdings');
        const rows = [{ symbol: 'NVDA', name: 'NVIDIA Corp', quantity: 10, avgCost: 450.25 }];
        const first = await page.request.post('/api/portfolio/import', { data: { newPortfolioName: 'Quota', rows } });
        expect(first.status()).toBe(200);
        const { portfolioId } = (await first.json()).data;
        for (let i = 1; i < 20; i++) {
            expect((await page.request.post('/api/portfolio/import', { data: { portfolioId, rows } })).status(), `import ${i + 1}`).toBe(200);
        }

        const refused = await page.request.post('/api/portfolio/import', { data: { portfolioId, rows } });
        expect(refused.status()).toBe(429);
        expect(Number(refused.headers()['retry-after'])).toBeGreaterThan(0);
        expect(await refused.json()).toMatchObject({ code: 'DAILY_QUOTA_REACHED' });
        // Transactions share it.
        const transactions = await page.request.post('/api/transactions/import', {
            data: { portfolioId, rows: [{ type: 'DEPOSIT', date: '2026-10-01', amount: 1000 }] },
        });
        expect(transactions.status()).toBe(429);

        await gotoAppPage(page, '/portfolios/holdings');
        await openImport(page, SAMPLE_CSV.replace('BAD TICKER,Nope,1,1\n', ''));
        // The account made above: the fresh user's copies of A's have IDs the
        // import's validator doesn't take as UUIDs (md5 in helpers/users.ts).
        await page.getByTestId('import-dialog').getByLabel('Import into').selectOption({ label: 'Quota' });
        await page.getByRole('button', { name: 'Import 2 positions' }).click();
        await expect(page.getByTestId('import-dialog').getByRole('alert')).toContainText('You can import up to 20 CSV files a day. Try again in');
        await expect(page.getByText(/Imported \d+ position/)).toHaveCount(0);
    });
});
