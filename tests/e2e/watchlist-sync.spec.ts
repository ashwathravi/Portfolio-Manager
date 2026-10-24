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

        const order = { session: 'e2e-api-test', seq: 1 };

        const saved = await page.request.put(`/api/research/watchlist/${item.id}`, { data: { item, order } });
        expect(saved.status()).toBe(204);

        const duplicate = await page.request.put('/api/research/watchlist/w-nvda-other', {
            data: { item: { ...item, id: 'w-nvda-other' }, order: { ...order, seq: 2 } },
        });
        expect(duplicate.status()).toBe(409);
        expect((await duplicate.json()).code).toBe('DUPLICATE_TICKER');

        const mismatched = await page.request.put('/api/research/watchlist/w-other', { data: { item, order } });
        expect(mismatched.status()).toBe(400);
        expect((await mismatched.json()).code).toBe('INVALID_WATCH_ITEM');

        const extraField = await page.request.put(`/api/research/watchlist/${item.id}`, {
            data: { item: { ...item, userId: 'someone-else' }, order },
        });
        expect(extraField.status()).toBe(400);

        const unordered = await page.request.put(`/api/research/watchlist/${item.id}`, { data: { item } });
        expect(unordered.status()).toBe(400);

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
        expect((await anonymous.put(`/api/research/watchlist/${item.id}`, { data: { item, order } })).status()).toBe(401);
        expect((await anonymous.post('/api/research/watchlist/import', { data: { items: [] } })).status()).toBe(401);
        await anonymous.dispose();
    });

    test("regression: a page's older write that arrives late doesn't undo its newer one", async ({ context, page }) => {
        // The Codex finding on PR #147: two writes in flight as a page
        // closes can land in either order.
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/research?tab=watchlist');
        const item = {
            id: 'w-amd-e2e', ticker: 'AMD', companyName: '', reason: '', notes: 'newer', targetEntry: null, addedAt: '2026-10-23', dismissed: false,
        };
        const session = 'e2e-order-test';
        const put = (notes: string, seq: number, dismissed = false) =>
            page.request.put(`/api/research/watchlist/${item.id}`, { data: { item: { ...item, notes, dismissed }, order: { session, seq } } });
        const stored = async () => (await (await page.request.get('/api/research/watchlist')).json()).data;

        expect((await put('newer', 2)).status()).toBe(204);
        // The older one lands second: accepted, but ignored.
        expect((await put('older', 1)).status()).toBe(204);
        // A removal made before the last save is ignored too.
        expect((await put('newer', 1, true)).status()).toBe(204);
        expect((await stored()).items).toEqual([item]);

        // Another page's write isn't held to this page's count.
        expect((await page.request.put(`/api/research/watchlist/${item.id}`, {
            data: { item: { ...item, notes: 'elsewhere' }, order: { session: 'e2e-other-page', seq: 1 } },
        })).status()).toBe(204);
        expect((await stored()).items[0].notes).toBe('elsewhere');
    });

    test("regression: a removal that lands first isn't undone by the older save", async ({ context, page }) => {
        // The Codex finding on PR #147: a DELETE that landed before the
        // add it followed left nothing to compare with, and the add then
        // put the item back.
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/research?tab=watchlist');
        const item = {
            id: 'w-tsla-e2e', ticker: 'TSLA', companyName: 'Tesla', reason: 'Robotaxi', notes: 'private', targetEntry: 200, addedAt: '2026-10-23', dismissed: false,
        };
        const order = (seq: number) => ({ session: 'e2e-removal-test', seq });

        // Remove (2) arrives before add (1).
        expect((await page.request.put(`/api/research/watchlist/${item.id}`, { data: { item: { ...item, dismissed: true }, order: order(2) } })).status()).toBe(204);
        expect((await page.request.put(`/api/research/watchlist/${item.id}`, { data: { item, order: order(1) } })).status()).toBe(204);
        const data = (await (await page.request.get('/api/research/watchlist')).json()).data;
        expect(data.items).toEqual([]);
        expect(data.dismissed).toEqual([item.id]);

        // There is no DELETE: removing is a save.
        expect([401, 405]).toContain((await page.request.delete(`/api/research/watchlist/${item.id}`)).status());

        // And the same ticker can be added again under a new id.
        expect((await page.request.put('/api/research/watchlist/w-tsla-again', {
            data: { item: { ...item, id: 'w-tsla-again' }, order: order(3) },
        })).status()).toBe(204);
        expect((await (await page.request.get('/api/research/watchlist')).json()).data.items.map((i: { id: string }) => i.id)).toEqual(['w-tsla-again']);
    });

    test('regression: changes wait until the account list has loaded', async ({ context, page }) => {
        // The Codex finding on PR #147: an edit to the examples shown while
        // the list loaded could replace the user's saved copy of that row.
        await signInAsFreshUser(context);
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        await page.route('**/api/research/watchlist', async (route) => {
            await held;
            await route.continue();
        });
        const writes: string[] = [];
        page.on('request', (request) => {
            if (request.url().includes('/api/research/watchlist/') && request.method() !== 'GET') writes.push(request.url());
        });

        await gotoAppPage(page, '/research?tab=watchlist');
        const add = page.getByLabel('Add ticker to watchlist');
        await expect(async () => {
            await add.fill('amd');
            await expect(add).toHaveValue('AMD', { timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(page.locator('#watch-add-error')).toContainText('still loading');
        expect(writes).toEqual([]);

        release();
        await expect(list(page).getByRole('button', { name: /COIN/ })).toBeVisible();
        await expect(async () => {
            await page.getByRole('button', { name: 'Add', exact: true }).click();
            await expect(list(page).getByRole('button', { name: /AMD/ })).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
    });
});
