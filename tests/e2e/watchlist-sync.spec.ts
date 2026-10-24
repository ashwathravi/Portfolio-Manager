import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { gotoAppPage } from './helpers/app';
import { userKey } from './helpers/storage';
import { signInAsFreshUser } from './helpers/users';

// Launch item i38: with a database the watchlist lives in the user's account
// (watchlist_items), and what a browser kept before moves there once.

const databaseAuthEnabled = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');
const WATCHLIST_KEY = 'atlas:research:watchlist';

function list(page: Page) {
    return page.locator('.pm-research-list');
}

async function addTicker(page: Page, ticker: string) {
    const add = page.getByLabel('Add ticker to watchlist');
    await expect(async () => {
        await add.fill(ticker.toLowerCase());
        await expect(add).toHaveValue(ticker, { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    const saved = page.waitForResponse((response) =>
        response.url().includes('/api/research/watchlist/') && response.request().method() === 'PUT' && response.ok());
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await saved;
}

/** Another browser, signed in with the same session. */
async function anotherBrowser(browser: Browser, context: BrowserContext): Promise<Page> {
    const other = await browser.newContext();
    await other.addCookies(await context.cookies());
    return other.newPage();
}

test.describe('Watchlist in the account', () => {
    test.skip(!databaseAuthEnabled, 'requires the database-auth E2E mode');

    test('a ticker you add follows you to another browser', async ({ browser, context, page }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/research?tab=watchlist');
        await addTicker(page, 'NVDA');

        const elsewhere = await anotherBrowser(browser, context);
        await gotoAppPage(elsewhere, '/research?tab=watchlist');
        await expect(list(elsewhere).getByRole('button', { name: /NVDA/ })).toBeVisible();
        // And on Today.
        await gotoAppPage(elsewhere, '/');
        await expect(elsewhere.getByTestId('today-watchlist').getByRole('link', { name: /NVDA/ })).toBeVisible();
        await elsewhere.context().close();
    });

    test("this browser's list moves to the account the first time, examples you removed included", async ({ browser, context, page }) => {
        const scope = await signInAsFreshUser(context);
        // As the browser-only version saved it: one ticker of the user's, an
        // edited example, and COIN removed.
        await page.addInitScript(({ key }) => {
            if (window.sessionStorage.getItem('__pm_test_legacy_watchlist')) return;
            window.sessionStorage.setItem('__pm_test_legacy_watchlist', '1');
            window.localStorage.setItem(key, JSON.stringify({
                version: 1,
                items: [
                    { id: 'w-amzn-lx1', ticker: 'AMZN', companyName: 'Amazon.com, Inc.', reason: 'AWS margins', notes: '', targetEntry: 150, addedAt: '2026-10-01' },
                    { id: 'w-pltr', ticker: 'PLTR', companyName: 'Palantir Technologies Inc.', reason: 'Mine now', notes: '', targetEntry: 16.5, addedAt: '2026-10-10' },
                    { id: 'w-shop', ticker: 'SHOP', companyName: 'Shopify Inc.', reason: 'E-commerce recovery', notes: '', targetEntry: 65, addedAt: '2026-10-17', sample: true },
                ],
            }));
        }, { key: userKey(WATCHLIST_KEY, scope) });
        const imported = page.waitForResponse((response) =>
            response.url().endsWith('/api/research/watchlist/import') && response.ok());
        await gotoAppPage(page, '/research?tab=watchlist');
        await imported;

        await expect(list(page).getByRole('button', { name: /AMZN/ })).toBeVisible();
        await expect(list(page).getByRole('button', { name: /PLTR/ }).getByTestId('sample-tag')).toHaveCount(0);
        await expect(list(page).getByRole('button', { name: /SHOP/ }).getByTestId('sample-tag')).toBeVisible();
        await expect(list(page).getByRole('button', { name: /COIN/ })).toHaveCount(0);
        // The browser's copy is gone once the account has it.
        await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), userKey(WATCHLIST_KEY, scope))).toBeNull();

        const elsewhere = await anotherBrowser(browser, context);
        await gotoAppPage(elsewhere, '/research?tab=watchlist');
        await expect(list(elsewhere).getByRole('button', { name: /AMZN/ })).toBeVisible();
        await list(elsewhere).getByRole('button', { name: /PLTR/ }).click();
        await expect(elsewhere.locator('.pm-research-pane').getByLabel('Why it is on the list')).toHaveValue('Mine now');
        await expect(list(elsewhere).getByRole('button', { name: /COIN/ })).toHaveCount(0);
        await elsewhere.context().close();
    });

    test("one account's watchlist doesn't reach another", async ({ browser, context, page }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/research?tab=watchlist');
        await addTicker(page, 'TSLA');

        const other = await browser.newContext();
        await signInAsFreshUser(other);
        const otherPage = await other.newPage();
        await gotoAppPage(otherPage, '/research?tab=watchlist');
        await expect(list(otherPage).getByRole('button', { name: /COIN/ })).toBeVisible();
        await expect(list(otherPage).getByRole('button', { name: /TSLA/ })).toHaveCount(0);
        await other.close();
    });

    test('the API refuses what it should not store', async ({ context, page, playwright }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/research?tab=watchlist');
        const item = {
            id: 'w-nvda-e2e', ticker: 'NVDA', companyName: '', reason: '', notes: '', targetEntry: null, addedAt: '2026-10-23', dismissed: false,
        };

        const saved = await page.request.put(`/api/research/watchlist/${item.id}`, { data: item });
        expect(saved.status()).toBe(204);

        const duplicate = await page.request.put('/api/research/watchlist/w-nvda-other', { data: { ...item, id: 'w-nvda-other' } });
        expect(duplicate.status()).toBe(409);
        expect((await duplicate.json()).code).toBe('DUPLICATE_TICKER');

        const mismatched = await page.request.put('/api/research/watchlist/w-other', { data: item });
        expect(mismatched.status()).toBe(400);
        expect((await mismatched.json()).code).toBe('INVALID_WATCH_ITEM');

        const extraField = await page.request.put(`/api/research/watchlist/${item.id}`, { data: { ...item, userId: 'someone-else' } });
        expect(extraField.status()).toBe(400);

        const tooMany = await page.request.post('/api/research/watchlist/import', {
            data: { items: Array.from({ length: 501 }, (_, i) => ({ ...item, id: `w-${i}`, ticker: 'AMD' })) },
        });
        expect(tooMany.status()).toBe(400);
        expect((await tooMany.json()).code).toBe('INVALID_WATCHLIST_IMPORT');

        const listed = await page.request.get('/api/research/watchlist');
        expect(listed.headers()['cache-control']).toContain('no-store');
        expect((await listed.json()).data).toEqual({ items: [item], dismissed: [] });

        // A request context of its own: the page's background requests keep
        // setting the session cookie on the shared one.
        const anonymous = await playwright.request.newContext({
            baseURL: 'http://localhost:3000',
            storageState: { cookies: [], origins: [] },
        });
        expect((await anonymous.get('/api/research/watchlist')).status()).toBe(401);
        expect((await anonymous.put(`/api/research/watchlist/${item.id}`, { data: item })).status()).toBe(401);
        expect((await anonymous.delete(`/api/research/watchlist/${item.id}`)).status()).toBe(401);
        expect((await anonymous.post('/api/research/watchlist/import', { data: { items: [] } })).status()).toBe(401);
        await anonymous.dispose();
    });
});
