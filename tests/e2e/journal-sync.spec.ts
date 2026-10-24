import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { gotoAppPage } from './helpers/app';
import { userKey } from './helpers/storage';
import { signInAsFreshUser } from './helpers/users';

// Launch item i38: with a database the decision journal lives in the user's
// account (journal_entries), and what a browser kept before moves there once.

const databaseAuthEnabled = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');
const JOURNAL_KEY = 'atlas:research:journal';

function list(page: Page) {
    return page.locator('.pm-research-list');
}

/** Another browser, signed in with the same session. */
async function anotherBrowser(browser: Browser, context: BrowserContext): Promise<Page> {
    const other = await browser.newContext();
    await other.addCookies(await context.cookies());
    return other.newPage();
}

async function addEntry(page: Page, ticker: string, decision: string) {
    await page.getByRole('button', { name: 'New entry' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('AAPL').fill(ticker);
    await dialog.getByPlaceholder('e.g. Opened position with 20 shares').fill(decision);
    await dialog.getByPlaceholder('Why are you making this decision?').fill('Written in an E2E test');
    const saved = page.waitForResponse((response) =>
        response.url().includes('/api/research/journal/') && response.request().method() === 'PUT' && response.ok());
    await dialog.getByRole('button', { name: 'Add Entry' }).click();
    await saved;
}

test.describe('Journal in the account', () => {
    test.skip(!databaseAuthEnabled, 'requires the database-auth E2E mode');

    test('an entry you add follows you to another browser', async ({ browser, context, page }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/research?tab=journal');
        await addEntry(page, 'AMD', 'Opened a starter position');

        const elsewhere = await anotherBrowser(browser, context);
        await gotoAppPage(elsewhere, '/research?tab=journal');
        await expect(list(elsewhere).getByRole('button', { name: /Opened a starter position/ })).toBeVisible();
        await elsewhere.context().close();
    });

    test("this browser's journal moves to the account the first time, deleted examples included", async ({ browser, context, page }) => {
        const scope = await signInAsFreshUser(context);
        // As the browser-only version saved it: an entry of the user's, an
        // edited example, an untouched one, and the other two deleted.
        await page.addInitScript(({ key }) => {
            if (window.sessionStorage.getItem('__pm_test_legacy_journal')) return;
            window.sessionStorage.setItem('__pm_test_legacy_journal', '1');
            window.localStorage.setItem(key, JSON.stringify({
                version: 1,
                entries: [
                    { id: 'b7e1c0de-0000-4000-8000-000000000001', date: '2026-10-01', type: 'hold', ticker: 'AMZN', decision: 'Held through the AWS print', rationale: 'Margins intact', outcome: 'pending' },
                    { id: 'seed-journal-2', date: '2026-02-03', type: 'exit', ticker: 'TSLA', decision: 'Reduced position by 25 shares', rationale: 'Taking profits after 20% gain', outcome: 'loss', thesisId: 'seed-tsla' },
                    { id: 'seed-journal-3', date: '2026-01-28', type: 'entry', ticker: 'NVDA', decision: 'Opened position with 20 shares', rationale: 'AI data center demand exceeding expectations. CUDA moat remains strong. H100 supply constraints supporting ASPs.', outcome: 'pending', thesisId: 'seed-nvda' },
                ],
            }));
        }, { key: userKey(JOURNAL_KEY, scope) });
        const imported = page.waitForResponse((response) =>
            response.url().endsWith('/api/research/journal/import') && response.ok());
        await gotoAppPage(page, '/research?tab=journal');
        await imported;

        await expect(list(page).getByRole('button', { name: /Held through the AWS print/ })).toBeVisible();
        await expect(list(page).getByRole('button', { name: /Opened position with 20 shares/ })).toBeVisible();
        await expect(list(page).getByRole('button', { name: /Increased position by 50 shares/ })).toHaveCount(0);
        await expect(list(page).getByRole('button', { name: /Maintaining position through earnings/ })).toHaveCount(0);
        await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), userKey(JOURNAL_KEY, scope))).toBeNull();

        const elsewhere = await anotherBrowser(browser, context);
        await gotoAppPage(elsewhere, '/research?tab=journal');
        await expect(list(elsewhere).getByRole('button', { name: /Held through the AWS print/ })).toBeVisible();
        // The edited example kept the user's outcome.
        await expect(list(elsewhere).getByRole('button', { name: /Reduced position by 25 shares/ })).toContainText('loss');
        await expect(list(elsewhere).getByRole('button', { name: /Increased position by 50 shares/ })).toHaveCount(0);
        await elsewhere.context().close();
    });

    test("one account's journal doesn't reach another", async ({ browser, context, page }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/research?tab=journal');
        await addEntry(page, 'TSLA', 'Sold covered calls');

        const other = await browser.newContext();
        await signInAsFreshUser(other);
        const otherPage = await other.newPage();
        await gotoAppPage(otherPage, '/research?tab=journal');
        await expect(list(otherPage).getByRole('button', { name: /Increased position by 50 shares/ })).toBeVisible();
        await expect(list(otherPage).getByRole('button', { name: /Sold covered calls/ })).toHaveCount(0);
        await other.close();
    });

    test('the API refuses what it should not store', async ({ context, page, playwright }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/research?tab=journal');
        const entry = {
            id: 'c0ffee00-0000-4000-8000-000000000001', date: '2026-10-23', type: 'entry', ticker: 'NVDA',
            decision: 'Opened a position', rationale: 'Demand', outcome: 'pending', thesisId: null, dismissed: false,
        };

        const order = { session: 'e2e-api-test', seq: 1 };
        expect((await page.request.put(`/api/research/journal/${entry.id}`, { data: { entry, order } })).status()).toBe(204);

        const mismatched = await page.request.put('/api/research/journal/c0ffee00-other', { data: { entry, order } });
        expect(mismatched.status()).toBe(400);
        expect((await mismatched.json()).code).toBe('INVALID_JOURNAL_ENTRY');

        const badType = await page.request.put(`/api/research/journal/${entry.id}`, { data: { entry: { ...entry, type: 'buy' }, order } });
        expect(badType.status()).toBe(400);
        expect((await badType.json()).error).toBe('type must be entry, exit or hold');

        const extraField = await page.request.put(`/api/research/journal/${entry.id}`, { data: { entry: { ...entry, userId: 'someone-else' }, order } });
        expect(extraField.status()).toBe(400);

        expect((await page.request.put(`/api/research/journal/${entry.id}`, { data: { entry } })).status()).toBe(400);
        // There is no DELETE: deleting is a save.
        expect([401, 405]).toContain((await page.request.delete(`/api/research/journal/${entry.id}`)).status());

        // A write older than the last one from the same page is ignored,
        // a deletion included.
        for (const older of [{ ...entry, outcome: 'loss' }, { ...entry, dismissed: true }]) {
            expect((await page.request.put(`/api/research/journal/${entry.id}`, {
                data: { entry: older, order: { ...order, seq: 1 } },
            })).status()).toBe(204);
        }

        const tooMany = await page.request.post('/api/research/journal/import', {
            data: { items: Array.from({ length: 501 }, (_, i) => ({ ...entry, id: `e-${i}` })) },
        });
        expect(tooMany.status()).toBe(400);
        expect((await tooMany.json()).code).toBe('INVALID_JOURNAL_IMPORT');

        const listed = await page.request.get('/api/research/journal');
        expect(listed.headers()['cache-control']).toContain('no-store');
        expect((await listed.json()).data).toEqual({ entries: [entry], dismissed: [] });

        // A request context of its own: the page's background requests keep
        // setting the session cookie on the shared one.
        const anonymous = await playwright.request.newContext({
            baseURL: 'http://localhost:3000',
            storageState: { cookies: [], origins: [] },
        });
        expect((await anonymous.get('/api/research/journal')).status()).toBe(401);
        expect((await anonymous.put(`/api/research/journal/${entry.id}`, { data: { entry, order } })).status()).toBe(401);
        expect((await anonymous.post('/api/research/journal/import', { data: { items: [] } })).status()).toBe(401);
        await anonymous.dispose();
    });

    test("a deletion that lands first isn't undone by the older save", async ({ context, page }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/research?tab=journal');
        const entry = {
            id: 'c0ffee00-0000-4000-8000-000000000002', date: '2026-10-23', type: 'entry', ticker: 'NVDA',
            decision: 'Opened a position', rationale: 'Private reasoning', outcome: 'pending', thesisId: null, dismissed: false,
        };
        const order = (seq: number) => ({ session: 'e2e-deletion-test', seq });

        // Delete (2) arrives before add (1).
        expect((await page.request.put(`/api/research/journal/${entry.id}`, { data: { entry: { ...entry, dismissed: true }, order: order(2) } })).status()).toBe(204);
        expect((await page.request.put(`/api/research/journal/${entry.id}`, { data: { entry, order: order(1) } })).status()).toBe(204);
        const data = (await (await page.request.get('/api/research/journal')).json()).data;
        expect(data.entries).toEqual([]);
        expect(data.dismissed).toEqual([entry.id]);
    });
});
