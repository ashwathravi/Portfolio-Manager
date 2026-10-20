import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { clickUntil, gotoAppPage, reloadAppPage } from './helpers/app';
import { signInAsFreshUser } from './helpers/users';

// Launch item i37: settings live in the user's user_settings row, with this
// browser's copy kept in step (src/lib/settings/sync.ts).

const databaseAuthEnabled = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');
const DARK = /(^|\s)dark(\s|$)/;
// As in smoke.spec.ts: how next dev and a production build report it.
const HYDRATION_ERROR = /Hydration|did not match|Minified React error #(418|421|422|423|425)\b|react\.dev\/errors\/(418|421|422|423|425)\b/i;

async function chooseDarkTheme(page: Page) {
    await gotoAppPage(page, '/settings?tab=appearance');
    await clickUntil(
        page.getByRole('radiogroup', { name: 'Color theme' }).getByRole('radio', { name: 'Dark', exact: true }),
        async () => {
            await expect(page.locator('html')).toHaveClass(DARK, { timeout: 1000 });
        },
    );
}

function savedSettings(page: Page) {
    return page.waitForResponse((response) =>
        response.url().endsWith('/api/settings') && response.request().method() === 'PUT' && response.ok());
}

/** Another browser, signed in with the same session. */
async function anotherBrowser(browser: Browser, context: BrowserContext): Promise<Page> {
    const other = await browser.newContext();
    await other.addCookies(await context.cookies());
    return other.newPage();
}

test.describe('Settings sync', () => {
    test.skip(!databaseAuthEnabled, 'requires the database-auth E2E mode');

    test.beforeEach(async ({ context }) => {
        await signInAsFreshUser(context);
    });

    test('a change is saved to the server and follows you to another browser', async ({ browser, context, page }) => {
        const saved = savedSettings(page);
        await chooseDarkTheme(page);
        await saved;

        const elsewhere = await anotherBrowser(browser, context);
        await gotoAppPage(elsewhere, '/');
        await expect(elsewhere.locator('html')).toHaveClass(DARK);
        await elsewhere.context().close();
    });

    test("an edit made just before a reload isn't lost", async ({ page }) => {
        await chooseDarkTheme(page);
        // No waiting for the save: the browser copy keeps it until the
        // server has it.
        await reloadAppPage(page);

        await expect(page.locator('html')).toHaveClass(DARK);
    });

    test("this browser's settings become the user's the first time", async ({ browser, context, page }) => {
        // As the persist middleware stored them, under the shared key.
        await page.addInitScript(() => {
            if (window.sessionStorage.getItem('__pm_test_legacy_settings')) return;
            window.sessionStorage.setItem('__pm_test_legacy_settings', '1');
            window.localStorage.setItem('atlas-settings', JSON.stringify({
                state: { appearance: { theme: 'dark', density: 'comfortable', accent: '#1f6f4a', compactMode: false, animationsEnabled: true } },
                version: 15,
            }));
        });
        const saved = savedSettings(page);
        await gotoAppPage(page, '/');
        await saved;
        await expect(page.locator('html')).toHaveClass(DARK);
        expect(await page.evaluate(() => window.localStorage.getItem('atlas-settings'))).toBeNull();

        const elsewhere = await anotherBrowser(browser, context);
        await gotoAppPage(elsewhere, '/');
        await expect(elsewhere.locator('html')).toHaveClass(DARK);
        await elsewhere.context().close();
    });

    test('regression: a stale tab takes the newer settings instead of reverting them', async ({ browser, context, page }) => {
        // Opened before the other browser saved, so its copy is stale.
        const stale = await anotherBrowser(browser, context);
        await gotoAppPage(stale, '/settings?tab=appearance');

        const saved = savedSettings(page);
        await chooseDarkTheme(page);
        await saved;

        // A change in the stale tab is refused (409), and the tab shows the
        // saved settings instead of sending its old ones back.
        const refused = stale.waitForResponse((response) => response.url().endsWith('/api/settings') && response.status() === 409);
        await clickUntil(
            stale.getByRole('radiogroup', { name: 'Interface density' }).getByRole('radio', { name: 'Compact', exact: true }),
            async () => {
                await expect(stale.getByRole('radiogroup', { name: 'Interface density' }).getByRole('radio', { name: 'Compact', exact: true }))
                    .toHaveAttribute('aria-checked', 'true', { timeout: 1000 });
            },
        );
        await refused;
        await expect(stale.locator('html')).toHaveClass(DARK);
        await expect(stale.getByText('Your settings were changed in another tab or device.')).toBeVisible();

        await gotoAppPage(page, '/');
        await expect(page.locator('html')).toHaveClass(DARK);
        await stale.context().close();
    });

    test("one account's settings don't reach another", async ({ browser, page }) => {
        const saved = savedSettings(page);
        await chooseDarkTheme(page);
        await saved;

        const other = await browser.newContext();
        await signInAsFreshUser(other);
        const otherPage = await other.newPage();
        await gotoAppPage(otherPage, '/');
        await expect(otherPage.locator('html')).not.toHaveClass(DARK);
        await other.close();
    });

    test('pages hydrate cleanly with saved settings that differ from the defaults', async ({ page }) => {
        // The server renders the defaults; the browser starts from these.
        const save = await page.request.put('/api/settings', {
            data: {
                version: 15,
                settings: {
                    profile: { fullName: 'Grace Hopper', email: '', phone: '' },
                    appearance: { theme: 'dark', density: 'compact', compactMode: true, animationsEnabled: true, accent: '#17cf54' },
                    demo: { showSampleData: false },
                },
                baseUpdatedAt: null,
            },
        });
        expect(save.ok()).toBe(true);

        for (const path of ['/', '/settings', '/research', '/execution', '/performance']) {
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(String(error)));
            page.on('console', (message) => {
                if (message.type() === 'error' && HYDRATION_ERROR.test(message.text())) errors.push(message.text());
            });
            await gotoAppPage(page, path);
            await page.waitForTimeout(1000);
            expect(errors.filter((error) => HYDRATION_ERROR.test(error)), path).toEqual([]);
            page.removeAllListeners('pageerror');
            page.removeAllListeners('console');
        }
        // And the saved settings are the ones showing.
        await expect(page.locator('html')).toHaveClass(DARK);
        await expect(page.getByText('Grace Hopper').first()).toBeVisible();
    });

    test('PUT /api/settings refuses what it should not store', async ({ page, playwright }) => {
        await gotoAppPage(page, '/');

        const apiKeys = await page.request.put('/api/settings', {
            data: { version: 15, settings: { apiKeys: { polygon: 'pk-should-not-store' } }, baseUpdatedAt: null },
        });
        expect(apiKeys.status()).toBe(400);
        expect((await apiKeys.json()).code).toBe('INVALID_SETTINGS');

        const future = await page.request.put('/api/settings', { data: { version: 999, settings: {}, baseUpdatedAt: null } });
        expect(future.status()).toBe(400);

        // A field the app could never write: an optional field of the wrong kind.
        const account = {
            id: 'manual-1', name: 'Brokerage', type: 'Brokerage', accountMask: '****1234', holdings: 1,
            accountValue: 1000, lastSynced: 'Oct 19, 2026', status: 'error', errorMessage: {},
        };
        const mistyped = await page.request.put('/api/settings', {
            data: { version: 15, settings: { accounts: [account] }, baseUpdatedAt: null },
        });
        expect(mistyped.status()).toBe(400);
        expect(await mistyped.json()).toMatchObject({
            code: 'INVALID_SETTINGS',
            error: 'settings.accounts[0].errorMessage must be text',
        });

        // Nor a version older than any browser saves.
        const older = await page.request.put('/api/settings', {
            data: { version: 14, settings: { profile: { fullName: 'Jane', apiKey: 'secret' } }, baseUpdatedAt: null },
        });
        expect(older.status()).toBe(400);

        // A request context of its own: the page's background requests keep
        // setting the session cookie on the shared one.
        const anonymous = await playwright.request.newContext({
            baseURL: 'http://localhost:3000',
            storageState: { cookies: [], origins: [] },
        });
        const signedOut = await anonymous.put('/api/settings', { data: { version: 15, settings: {}, baseUpdatedAt: null } });
        expect(signedOut.status()).toBe(401);
        await anonymous.dispose();
    });
});
