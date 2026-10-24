import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { gotoAppPage } from './helpers/app';
import { researchLoaded } from './helpers/research';
import { userKey } from './helpers/storage';
import { signInAsFreshUser } from './helpers/users';

// Launch item i38: with a database, theses (with their catalysts and
// evidence) live in the user's account, and what a browser kept before
// moves there once.

const databaseAuthEnabled = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');
const THESES_KEY = 'atlas:research:theses';

function list(page: Page) {
    return page.locator('.pm-research-list');
}

/** Another browser, signed in with the same session. */
async function anotherBrowser(browser: Browser, context: BrowserContext): Promise<Page> {
    const other = await browser.newContext();
    await other.addCookies(await context.cookies());
    return other.newPage();
}

const THESIS = {
    id: 'b2c1a0f4-0d7e-4c55-9e1b-5c2c3e7a8f90',
    ticker: 'AMD',
    companyName: 'Advanced Micro Devices',
    title: 'MI300 share gains',
    description: 'Second source for AI accelerators',
    type: 'bull',
    status: 'active',
    conviction: 'MEDIUM',
    targetPrice: 200,
    currentPrice: null,
    timeHorizon: '12 months',
    dateCreated: '2026-10-01',
    dateUpdated: '2026-10-20',
    tags: ['AI'],
    hypothesis: '',
    bullCase: [],
    bearCase: [],
    catalysts: [{ id: 'cat-a', title: 'Earnings', date: 'Q1 2027', impact: 'high' }],
    linkedEvidence: [{ id: 'ev-a', title: 'Teardown', type: 'report', date: '2026-10-02', url: 'https://example.com/a' }],
    healthScore: 60,
    dismissed: false,
};

test.describe('Theses in the account', () => {
    test.skip(!databaseAuthEnabled, 'requires the database-auth E2E mode');

    test('a thesis you add, with its catalysts and evidence, follows you to another browser', async ({ browser, context, page }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/research');
        const order = { session: 'e2e-sync-test', seq: 1 };
        expect((await page.request.put(`/api/research/theses/${THESIS.id}`, { data: { thesis: THESIS, order } })).status()).toBe(204);

        const elsewhere = await anotherBrowser(browser, context);
        const loaded = researchLoaded(elsewhere, 'theses');
        await gotoAppPage(elsewhere, '/research/thesis/AMD');
        await loaded;
        await expect(elsewhere.getByRole('heading', { level: 1 })).toContainText('AMD');
        await expect(elsewhere.getByRole('region', { name: 'Catalysts' }).getByText('Earnings')).toBeVisible();
        await expect(elsewhere.getByRole('region', { name: 'Evidence' }).getByRole('link', { name: /Teardown/ })).toHaveAttribute('href', 'https://example.com/a');
        await elsewhere.context().close();
    });

    test("this browser's theses move to the account the first time, deleted examples included", async ({ browser, context, page }) => {
        const scope = await signInAsFreshUser(context);
        // As the browser-only version saved them: one of the user's, and the
        // examples gone except NVDA, which they edited.
        await page.addInitScript(({ key, thesis }) => {
            if (window.sessionStorage.getItem('__pm_test_legacy_theses')) return;
            window.sessionStorage.setItem('__pm_test_legacy_theses', '1');
            const own = { ...thesis, currentPrice: undefined };
            const nvda = {
                ...own, id: 'seed-nvda', ticker: 'NVDA', companyName: 'NVIDIA Corporation', title: 'AI Infrastructure Dominance (mine)',
                catalysts: [], linkedEvidence: [],
            };
            window.localStorage.setItem(key, JSON.stringify({ version: 2, theses: [own, nvda] }));
        }, { key: userKey(THESES_KEY, scope), thesis: THESIS });
        const imported = page.waitForResponse((response) =>
            response.url().endsWith('/api/research/theses/import') && response.ok());
        await gotoAppPage(page, '/research');
        await imported;

        await expect(list(page).getByText('MI300 share gains')).toBeVisible();
        await expect(list(page).getByText('AI Infrastructure Dominance (mine)')).toBeVisible();
        await expect(list(page).getByText('Azure AI Growth Acceleration')).toHaveCount(0);
        await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), userKey(THESES_KEY, scope))).toBeNull();

        const elsewhere = await anotherBrowser(browser, context);
        const loaded = researchLoaded(elsewhere, 'theses');
        await gotoAppPage(elsewhere, '/research');
        await loaded;
        await expect(list(elsewhere).getByText('MI300 share gains')).toBeVisible();
        await expect(list(elsewhere).getByText('Azure AI Growth Acceleration')).toHaveCount(0);
        await elsewhere.context().close();
    });

    test("one account's theses don't reach another", async ({ browser, context, page }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/research');
        expect((await page.request.put(`/api/research/theses/${THESIS.id}`, { data: { thesis: THESIS, order: { session: 'e2e-iso-test', seq: 1 } } })).status()).toBe(204);

        const other = await browser.newContext();
        await signInAsFreshUser(other);
        const otherPage = await other.newPage();
        const loaded = researchLoaded(otherPage, 'theses');
        await gotoAppPage(otherPage, '/research');
        await loaded;
        await expect(list(otherPage).getByText('AI Infrastructure Dominance')).toBeVisible();
        await expect(list(otherPage).getByText('MI300 share gains')).toHaveCount(0);
        await other.close();
    });

    test('the API refuses what it should not store, and ignores a late older write', async ({ context, page, playwright }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/research');
        const order = { session: 'e2e-api-test', seq: 2 };
        const put = (thesis: unknown, o: unknown = order, id = THESIS.id) =>
            page.request.put(`/api/research/theses/${id}`, { data: { thesis, order: o } });

        expect((await put(THESIS)).status()).toBe(204);

        const mismatched = await put(THESIS, order, 'other-id');
        expect(mismatched.status()).toBe(400);
        expect((await mismatched.json()).code).toBe('INVALID_THESIS');

        const script = await put({ ...THESIS, linkedEvidence: [{ ...THESIS.linkedEvidence[0], url: 'javascript:alert(1)' }] });
        expect(script.status()).toBe(400);
        expect((await script.json()).error).toBe('url must be an http or https link');

        expect((await put({ ...THESIS, userId: 'someone-else' })).status()).toBe(400);
        expect((await page.request.put(`/api/research/theses/${THESIS.id}`, { data: { thesis: THESIS } })).status()).toBe(400);
        expect([401, 405]).toContain((await page.request.delete(`/api/research/theses/${THESIS.id}`)).status());

        // Older writes from the same page are ignored, a deletion included.
        expect((await put({ ...THESIS, title: 'older' }, { ...order, seq: 1 })).status()).toBe(204);
        expect((await put({ ...THESIS, dismissed: true }, { ...order, seq: 1 })).status()).toBe(204);

        const tooMany = await page.request.post('/api/research/theses/import', {
            data: { items: Array.from({ length: 201 }, (_, i) => ({ ...THESIS, id: `t-${i}` })) },
        });
        expect(tooMany.status()).toBe(400);
        expect((await tooMany.json()).code).toBe('INVALID_THESIS_IMPORT');

        const listed = await page.request.get('/api/research/theses');
        expect(listed.headers()['cache-control']).toContain('no-store');
        expect((await listed.json()).data).toEqual({ theses: [THESIS], dismissed: [] });

        const anonymous = await playwright.request.newContext({
            baseURL: 'http://localhost:3000',
            storageState: { cookies: [], origins: [] },
        });
        expect((await anonymous.get('/api/research/theses')).status()).toBe(401);
        expect((await anonymous.put(`/api/research/theses/${THESIS.id}`, { data: { thesis: THESIS, order } })).status()).toBe(401);
        expect((await anonymous.post('/api/research/theses/import', { data: { items: [] } })).status()).toBe(401);
        await anonymous.dispose();
    });
});
