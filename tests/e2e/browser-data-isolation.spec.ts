import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { gotoAppPage } from './helpers/app';
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

function storedAskHistory(page: Page, scope = E2E_STORAGE_SCOPE) {
    return page.evaluate((key) => window.localStorage.getItem(key), userKey('pm-ask-v1', scope));
}

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
        await askAQuestion(page);

        await switchToUserB(context);
        await page.goto('/ask');
        await expect(page.getByTestId('ask-suggestion').first()).toBeVisible();
        await expect(page.getByTestId('ask-msg-user')).toHaveCount(0);
        expect(await storedAskHistory(page, USER_B_ID)).toBeNull();

        // The first account's history is still there, under its own key.
        const history = JSON.parse((await storedAskHistory(page)) ?? '{}').history;
        expect(history).toHaveLength(2);
    });

    test('history saved before storage was per user goes to the account that opens it first', async ({ page }) => {
        await page.addInitScript(() => {
            if (window.sessionStorage.getItem('__pm_test_legacy_ask')) return;
            window.sessionStorage.setItem('__pm_test_legacy_ask', '1');
            window.localStorage.setItem('pm-ask-v1', JSON.stringify({
                history: [{ id: 'legacy-1', role: 'user', content: 'A question from before', ts: Date.now() }],
                dayBucket: '2026-01-01',
                dayCount: 1,
            }));
        });

        await page.goto('/ask');
        await expect(page.getByTestId('ask-msg-user')).toHaveCount(1);
        expect(await page.evaluate(() => window.localStorage.getItem('pm-ask-v1'))).toBeNull();
        expect(await storedAskHistory(page)).not.toBeNull();
    });

    test("regression: shared history goes to the account signed in now, even if it never opens Ask", async ({ context, page }) => {
        await page.addInitScript(() => {
            if (window.sessionStorage.getItem('__pm_test_legacy_ask')) return;
            window.sessionStorage.setItem('__pm_test_legacy_ask', '1');
            window.localStorage.setItem('pm-ask-v1', JSON.stringify({
                history: [{ id: 'legacy-1', role: 'user', content: "User A's question", ts: Date.now() }],
                dayBucket: '2026-01-01',
                dayCount: 1,
            }));
        });

        // User A only looks at Today.
        await gotoAppPage(page, '/');
        await expect.poll(() => page.evaluate(() => window.localStorage.getItem('pm-ask-v1'))).toBeNull();
        expect(await storedAskHistory(page)).not.toBeNull();

        await switchToUserB(context);
        await page.goto('/ask');
        await expect(page.getByTestId('ask-suggestion').first()).toBeVisible();
        await expect(page.getByTestId('ask-msg-user')).toHaveCount(0);
    });

    test('signing out removes the Ask transcript from this browser', async ({ page }) => {
        await askAQuestion(page);
        expect(await storedAskHistory(page)).not.toBeNull();
        // Keep the fixture session: answer the sign-out call without ending it.
        await page.route('**/api/auth/signout', (route) =>
            route.fulfill({ json: { url: 'http://localhost:3000/login' } }));

        await page.getByRole('button', { name: /^Account menu for / }).click();
        await page.getByRole('menuitem', { name: 'Sign out' }).click();

        await expect.poll(() => storedAskHistory(page)).toBeNull();
    });
});
