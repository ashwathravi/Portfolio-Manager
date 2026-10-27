import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { userKey } from './helpers/storage';
import { gotoAppPage } from './helpers/app';
import { databaseAuthEnabled, signInAsFreshUser } from './helpers/users';

/**
 * AR-115 — Ask Ledger (NL queries with tool-calling), answered from the
 * user's own data (launch item i56).
 *
 * Coverage:
 *   - ⌘K / the top-bar search box opens the command palette; questions
 *     are handed to the Ask overlay; Escape closes
 *   - Dedicated `/ask` page renders the sheet inline
 *   - Answers come from the user's holdings, trades and policy (POST
 *     /api/ask), never example data: with no holdings the answer says so
 *   - With a database the conversation is kept in the account: it survives
 *     reload, follows the user to another browser, clears, and counts
 *     against a daily limit; another account never sees it. Without one,
 *     this browser keeps it under `pm-ask-v1`
 *   - Sidebar nav item + Beta pill are visible
 *
 * Tests that ask sign in as a fresh user (a copy of fixture user A): the
 * conversation is kept per user on the server.
 */

const modifier = () => (process.platform === 'darwin' ? 'Meta' : 'Control');

/** ⌘K → choose "Ask Ledger" (first item for an empty query). */
async function openAskOverlay(page: Page) {
    await page.keyboard.press(`${modifier()}+KeyK`);
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('ask-overlay')).toBeVisible();
}

async function ask(page: Page, question: string) {
    const input = page.getByTestId('ask-input');
    await input.fill(question);
    await page.getByTestId('ask-send').click();
}

/** Another browser, signed in with the same session. */
async function anotherBrowser(browser: Browser, context: BrowserContext): Promise<Page> {
    const other = await browser.newContext();
    await other.addCookies(await context.cookies());
    return other.newPage();
}

test.describe('Ask Ledger — ⌘K command palette', () => {
    test.beforeEach(async ({ context, page }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/');
    });

    test('regression: the top-bar search box opens the command palette (was inert)', async ({ page }) => {
        await page.getByRole('button', { name: 'Search or jump to' }).click();
        await expect(page.getByTestId('command-palette')).toBeVisible();
    });

    test('Cmd+K opens the palette; Escape closes it', async ({ page }) => {
        await expect(page.getByTestId('command-palette')).toHaveCount(0);
        await page.keyboard.press(`${modifier()}+KeyK`);
        await expect(page.getByTestId('command-palette')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('command-palette')).toHaveCount(0);
    });

    test('typing a page name and pressing Enter navigates there', async ({ page }) => {
        await page.keyboard.press(`${modifier()}+KeyK`);
        await page.getByLabel('Search or jump to').last().fill('activity');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/\/portfolios\/activity$/);
        await expect(page.getByTestId('command-palette')).toHaveCount(0);
    });

    test('a ticker opens its position detail', async ({ page }) => {
        await page.keyboard.press(`${modifier()}+KeyK`);
        await page.getByLabel('Search or jump to').last().fill('nvda');
        await page.getByTestId('command-item').filter({ hasText: 'Open NVDA' }).click();
        await expect(page).toHaveURL(/\/portfolios\/detail\/NVDA$/);
    });

    test('a question is handed to Ask Ledger and answered', async ({ page }) => {
        await page.keyboard.press(`${modifier()}+KeyK`);
        await page.getByLabel('Search or jump to').last().fill('Am I overexposed to AI?');
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('ask-overlay')).toBeVisible();
        await expect(page.getByTestId('ask-msg-user')).toContainText('Am I overexposed to AI?');
        await expect(page.getByTestId('ask-msg-assistant')).toHaveCount(1);
    });

    test('Close button dismisses the Ask overlay', async ({ page }) => {
        await openAskOverlay(page);
        await page.getByTestId('ask-close').click();
        await expect(page.getByTestId('ask-overlay')).toHaveCount(0);
    });

    test('a suggested prompt is answered from the user\'s holdings', async ({ page }) => {
        await openAskOverlay(page);
        await page.getByTestId('ask-suggestion').filter({ hasText: /hurt my alpha/i }).click();

        await expect(page.getByTestId('ask-msg-user')).toHaveCount(1);
        const answer = page.getByTestId('ask-msg-assistant');
        await expect(answer).toHaveCount(1);
        await expect(answer).toContainText('top_alpha_contributors');
        if (databaseAuthEnabled) {
            // User A is up on everything: the weakest gain leads, by unrealized gain or loss.
            await expect(answer).toContainText(/biggest drags right now, by unrealized gain or loss/);
        } else {
            await expect(answer).toContainText(/no holdings to answer from yet/);
        }
    });
});

test.describe('Ask Ledger — dedicated /ask page', () => {
    test.beforeEach(async ({ context }) => {
        await signInAsFreshUser(context);
    });

    test('/ask renders the AskSheet inline (page variant)', async ({ page }) => {
        await page.goto('/ask');
        await expect(page.getByTestId('ask-page')).toBeVisible();
        const sheet = page.getByTestId('ask-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet).toHaveAttribute('data-variant', 'page');
        await expect(sheet).not.toContainText(/example data/i);
        // The empty state's worked example is labelled as one.
        await expect(page.getByTestId('ask-example')).toContainText('Example');
    });

    test('a P&L question is answered from closed trades', async ({ page }) => {
        await page.goto('/ask');
        await ask(page, 'Where did last month P&L come from?');
        const answer = page.getByTestId('ask-msg-assistant');
        await expect(answer).toContainText('pnl_attribution');
        // User A has bought but never sold: nothing closed.
        await expect(answer).toContainText(/No closed trades in that window/);
    });

    test('a stress question runs on the user\'s own position', async ({ page }) => {
        test.skip(!databaseAuthEnabled, 'the holdings are in the database');
        await page.goto('/ask');
        await ask(page, 'What happens if NVDA drops 40%?');
        const answer = page.getByTestId('ask-msg-assistant');
        // User A holds $102,560 of NVDA.
        await expect(answer).toContainText('NVDA -40%');
        await expect(answer).toContainText('-$41,024');
        await expect(answer).toContainText(/stress_test/);
        await expect(answer.getByTestId('ask-cite').first()).toBeVisible();
    });

    test('regression: no employer stock is assumed', async ({ page }) => {
        test.skip(!databaseAuthEnabled, 'the holdings are in the database');
        await page.goto('/ask');
        await ask(page, 'What happens if my employer stock drops?');
        const answer = page.getByTestId('ask-msg-assistant');
        await expect(answer).toContainText("You haven't named your employer's stock yet");
        await expect(answer.getByTestId('ask-cite').first()).toHaveAttribute('href', '/settings#employer-stock');
        await expect(answer).not.toContainText('GOOG');
    });

    test('the conversation is kept in the account: reload, another browser, clear', async ({ browser, context, page }) => {
        test.skip(!databaseAuthEnabled, 'the conversation is kept in the database');
        await page.goto('/ask');
        await page.getByTestId('ask-suggestion').filter({ hasText: /overexposed/i }).click();
        await expect(page.getByTestId('ask-msg-assistant')).toHaveCount(1);

        await page.reload();
        await expect(page.getByTestId('ask-msg-user')).toHaveCount(1);
        await expect(page.getByTestId('ask-msg-assistant')).toHaveCount(1);
        expect(await page.evaluate((key) => window.localStorage.getItem(key), userKey('pm-ask-v1'))).toBeNull();

        const elsewhere = await anotherBrowser(browser, context);
        await elsewhere.goto('/ask');
        await expect(elsewhere.getByTestId('ask-msg-user')).toContainText('Am I overexposed to AI?');
        await elsewhere.context().close();

        await page.getByTestId('ask-clear').click();
        await expect(page.getByTestId('ask-msg-assistant')).toHaveCount(0);
        await expect(page.getByTestId('ask-empty')).toBeVisible();
        await page.reload();
        await expect(page.getByTestId('ask-empty')).toBeVisible();
        await expect(page.getByTestId('ask-msg-user')).toHaveCount(0);
    });

    test('without a database, this browser keeps the conversation', async ({ page }) => {
        test.skip(databaseAuthEnabled, 'with a database the account keeps it');
        await page.goto('/ask');
        await page.getByTestId('ask-suggestion').filter({ hasText: /overexposed/i }).click();
        await expect(page.getByTestId('ask-msg-assistant')).toHaveCount(1);
        await page.reload();
        await expect(page.getByTestId('ask-msg-assistant')).toHaveCount(1);
        const raw = await page.evaluate((key) => window.localStorage.getItem(key), userKey('pm-ask-v1'));
        expect(JSON.parse(raw!).history).toHaveLength(2);
    });

    test('Clear button wipes the conversation', async ({ page }) => {
        await page.goto('/ask');
        await page.getByTestId('ask-suggestion').first().click();
        await expect(page.getByTestId('ask-msg-assistant')).toHaveCount(1);
        await page.getByTestId('ask-clear').click();
        await expect(page.getByTestId('ask-msg-assistant')).toHaveCount(0);
        await expect(page.getByTestId('ask-empty')).toBeVisible();
    });

    test('a day\'s questions are limited, and clearing doesn\'t reset the count', async ({ page }) => {
        test.skip(!databaseAuthEnabled, 'the count is kept in the database');
        for (let asked = 0; asked < 30; asked++) {
            const response = await page.request.post('/api/ask', { data: { question: 'How much cash is unassigned to jobs?' } });
            expect(response.status()).toBe(200);
        }
        expect((await page.request.delete('/api/ask')).status()).toBe(200);
        const refused = await page.request.post('/api/ask', { data: { question: 'Am I overexposed to AI?' } });
        expect(refused.status()).toBe(429);
        expect((await refused.json()).code).toBe('ASK_DAILY_LIMIT');

        await page.goto('/ask');
        await expect(page.getByText("You've asked 30 questions in the last 24 hours. Try again later.")).toBeVisible();
        await expect(page.getByTestId('ask-input')).toBeDisabled();
    });
});

test.describe('Ask Ledger — the API', () => {
    test.skip(!databaseAuthEnabled, 'requires the database-auth E2E mode');

    test('refuses a question that isn\'t one, and signed-out callers', async ({ context, page, playwright }) => {
        await signInAsFreshUser(context);
        const empty = await page.request.post('/api/ask', { data: { question: '   ' } });
        expect(empty.status()).toBe(400);
        expect(await empty.json()).toMatchObject({ code: 'INVALID_QUESTION', error: 'Ask a question' });
        const long = await page.request.post('/api/ask', { data: { question: 'x'.repeat(501) } });
        expect(long.status()).toBe(400);
        const extra = await page.request.post('/api/ask', { data: { question: 'Hi', history: [] } });
        expect(extra.status()).toBe(400);

        // A request context of its own, without the configured session cookie.
        const signedOut = await playwright.request.newContext({
            baseURL: 'http://localhost:3000',
            storageState: { cookies: [], origins: [] },
        });
        expect((await signedOut.get('/api/ask')).status()).toBe(401);
        expect((await signedOut.post('/api/ask', { data: { question: 'Am I overexposed to AI?' } })).status()).toBe(401);
        expect((await signedOut.delete('/api/ask')).status()).toBe(401);
        await signedOut.dispose();
    });

    test('one account\'s conversation never reaches another', async ({ browser, context, page }) => {
        await signInAsFreshUser(context);
        const asked = await page.request.post('/api/ask', { data: { question: 'Which positions have no written thesis?' } });
        expect(asked.status()).toBe(200);
        const { data } = await asked.json();
        expect(data.stored).toBe(true);
        expect(data.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);

        const other = await browser.newContext();
        await signInAsFreshUser(other);
        const history = await (await other.request.get('/api/ask')).json();
        expect(history.data.messages).toEqual([]);
        await other.close();

        const own = await (await page.request.get('/api/ask')).json();
        expect(own.data.messages.map((m: { content: string }) => m.content)[0]).toBe('Which positions have no written thesis?');
        expect(own.data.questionsToday).toBe(1);
    });
});

test.describe('Ask Ledger — sidebar nav', () => {
    test('sidebar exposes the Ask link with Beta pill', async ({ page }) => {
        await page.goto('/');
        const link = page.locator('aside.pm-sidebar').getByRole('link', { name: /^Ask\b/ });
        await expect(link).toBeVisible();
        await expect(link).toContainText(/Beta/i);
        await link.click();
        await expect(page).toHaveURL(/\/ask$/);
        await expect(page.getByTestId('ask-page')).toBeVisible();
    });
});
