import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { gotoAppPage } from './helpers/app';
import { signInAsFreshUser } from './helpers/users';
import { E2E_STORAGE_SCOPE, userKey } from './helpers/storage';

// Launch item i39: everything the app keeps in browser storage belongs to one
// signed-in user, so two accounts on one browser never see each other's data.

const databaseAuthEnabled = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');
const USER_B_ID = '00000000-0000-4000-8000-00000000a002';
const USER_B_SESSION_TOKEN = 'e2e-session-user-b';

async function switchToUserB(context: BrowserContext) {
    // Leave the page first: every signed-in response sets the session cookie
    // again, so a request still on its way would bring user A back.
    for (const open of context.pages()) await open.goto('about:blank');
    await context.clearCookies();
    await context.addCookies([{
        name: 'authjs.session-token',
        value: USER_B_SESSION_TOKEN,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
    }]);
}

async function askAQuestion(page: Page) {
    await page.goto('/ask');
    await page.getByTestId('ask-suggestion').filter({ hasText: /overexposed/i }).click();
    await expect(page.getByTestId('ask-msg-assistant')).toHaveCount(1);
}

function stored(page: Page, base: string, scope = E2E_STORAGE_SCOPE) {
    return page.evaluate((key) => window.localStorage.getItem(key), userKey(base, scope));
}

/** Pattern snoozes: kept in this browser, and shared by every account before i39. */
const SNOOZES = 'pm-pattern-snoozed';
const LEGACY_SNOOZES = JSON.stringify({ 'legacy-pattern': { snoozedUntil: '2099-01-01T00:00:00.000Z' } });

test.describe('Browser data per user', () => {
    test.skip(!databaseAuthEnabled, 'requires the database-auth E2E mode');


    test('each page names the signed-in user as its storage scope', async ({ context, page }) => {
        await gotoAppPage(page, '/');
        await expect(page.locator('html')).toHaveAttribute('data-storage-scope', E2E_STORAGE_SCOPE);

        await switchToUserB(context);
        await gotoAppPage(page, '/');
        await expect(page.locator('html')).toHaveAttribute('data-storage-scope', USER_B_ID);
    });

    test("regression: another account on the same browser doesn't see your Ask history", async ({ context, page }) => {
        // Kept in the account (launch item i56): a fresh copy of user A asks.
        await signInAsFreshUser(context);
        await askAQuestion(page);

        await switchToUserB(context);
        await page.goto('/ask');
        await expect(page.getByTestId('ask-suggestion').first()).toBeVisible();
        await expect(page.getByTestId('ask-msg-user')).toHaveCount(0);
        expect(await stored(page, 'pm-ask-v1', USER_B_ID)).toBeNull();
    });

    test('data saved before storage was per user goes to the account that opens it first', async ({ page }) => {
        await page.addInitScript(([key, value]) => {
            if (window.sessionStorage.getItem('__pm_test_legacy')) return;
            window.sessionStorage.setItem('__pm_test_legacy', '1');
            window.localStorage.setItem(key, value);
        }, [SNOOZES, LEGACY_SNOOZES]);

        await gotoAppPage(page, '/');
        await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), SNOOZES)).toBeNull();
        expect(await stored(page, SNOOZES)).not.toBeNull();
    });

    test("regression: shared data goes to the account signed in now, even if it never opens that page", async ({ context, page }) => {
        await page.addInitScript(([key, value]) => {
            if (window.sessionStorage.getItem('__pm_test_legacy')) return;
            window.sessionStorage.setItem('__pm_test_legacy', '1');
            window.localStorage.setItem(key, value);
        }, [SNOOZES, LEGACY_SNOOZES]);

        // User A only looks at Settings, never at Today's patterns.
        await gotoAppPage(page, '/settings');
        await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), SNOOZES)).toBeNull();
        expect(await stored(page, SNOOZES)).not.toBeNull();

        await switchToUserB(context);
        await gotoAppPage(page, '/');
        expect(await stored(page, SNOOZES, USER_B_ID)).toBeNull();
    });

    test('regression: an Ask transcript from before answers came from your data goes, once the account keeps the conversation', async ({ context, page }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/');
        const own = await page.locator('html').getAttribute('data-storage-scope');
        await page.evaluate((key) => window.localStorage.setItem(key, JSON.stringify({
            history: [{ id: 'legacy-1', role: 'user', content: 'A question about example data', ts: Date.now() }],
            dayBucket: '2026-01-01',
            dayCount: 1,
        })), userKey('pm-ask-v1', own!));

        await page.goto('/ask');
        await expect(page.getByTestId('ask-suggestion').first()).toBeVisible();
        await expect(page.getByTestId('ask-msg-user')).toHaveCount(0);
        await expect.poll(() => stored(page, 'pm-ask-v1', own!)).toBeNull();
    });

    test('signing out removes an Ask transcript from this browser', async ({ page }) => {
        // Only an older version kept one here; the account keeps the conversation now.
        await gotoAppPage(page, '/');
        await page.evaluate((key) => window.localStorage.setItem(key, JSON.stringify({ history: [], dayBucket: '2026-01-01', dayCount: 0 })), userKey('pm-ask-v1'));
        // Keep the fixture session: answer the sign-out call without ending it.
        await page.route('**/api/auth/signout', (route) =>
            route.fulfill({ json: { url: 'http://localhost:3000/login' } }));

        await page.getByRole('button', { name: /^Account menu for / }).click();
        await page.getByRole('menuitem', { name: 'Sign out' }).click();

        await expect.poll(() => stored(page, 'pm-ask-v1')).toBeNull();
    });
});
