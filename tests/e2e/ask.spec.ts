import { test, expect } from '@playwright/test';
import { gotoAppPage } from './helpers/app';

/**
 * AR-115 — Ask Ledger (NL queries with tool-calling).
 *
 * Coverage:
 *   - ⌘K / the top-bar search box opens the command palette; questions
 *     are handed to the Ask overlay; Escape closes
 *   - Dedicated `/ask` page renders the sheet inline
 *   - Suggested prompts submit and produce a recognisable answer
 *   - History persists across reload under `pm-ask-v1`
 *   - Clear button wipes history
 *   - Sidebar nav item + Beta pill are visible
 *
 * Tests are deterministic: the planner + tool layer run against frozen
 * seed data, so the assistant reply is the same on every run.
 */

const modifier = () => (process.platform === 'darwin' ? 'Meta' : 'Control');

/** ⌘K → choose "Ask Ledger" (first item for an empty query). */
async function openAskOverlay(page: import('@playwright/test').Page) {
    await page.keyboard.press(`${modifier()}+KeyK`);
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('ask-overlay')).toBeVisible();
}

test.describe('Ask Ledger — ⌘K command palette', () => {
    test.beforeEach(async ({ page }) => {
        // Reset persisted chat so every test starts with an empty sheet.
        await page.addInitScript(() => {
            try {
                const done = window.sessionStorage.getItem('__pm_test_ask_wipe');
                if (!done) {
                    window.localStorage.removeItem('pm-ask-v1');
                    window.sessionStorage.setItem('__pm_test_ask_wipe', '1');
                }
            } catch {
                /* ignore */
            }
        });
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

    test('Suggested prompt produces a deterministic assistant reply', async ({ page }) => {
        await openAskOverlay(page);

        // Click the "hurt my alpha" suggestion — keyword planner routes
        // this to `top_alpha_contributors` with direction=negative.
        await page
            .getByTestId('ask-suggestion')
            .filter({ hasText: /hurt my alpha/i })
            .click();

        // Both turns should now exist.
        await expect(page.getByTestId('ask-msg-user')).toHaveCount(1);
        await expect(page.getByTestId('ask-msg-assistant')).toHaveCount(1);

        // Assistant lede for the alpha_hurt intent starts with "Your
        // biggest alpha drags…" (see renderer.ts).
        await expect(page.getByTestId('ask-msg-assistant')).toContainText(
            /biggest alpha drags/i,
        );
        // And the tool-chip footer names the tool that ran.
        await expect(page.getByTestId('ask-msg-assistant')).toContainText(
            'top_alpha_contributors',
        );
    });
});

test.describe('Ask Ledger — dedicated /ask page', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            try {
                const done = window.sessionStorage.getItem('__pm_test_ask_wipe');
                if (!done) {
                    window.localStorage.removeItem('pm-ask-v1');
                    window.sessionStorage.setItem('__pm_test_ask_wipe', '1');
                }
            } catch {
                /* ignore */
            }
        });
    });

    test('/ask renders the AskSheet inline (page variant)', async ({ page }) => {
        await page.goto('/ask');
        await expect(page.getByTestId('ask-page')).toBeVisible();
        const sheet = page.getByTestId('ask-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet).toHaveAttribute('data-variant', 'page');
    });

    test('sending a custom question via the input works', async ({ page }) => {
        await page.goto('/ask');
        const input = page.getByTestId('ask-input');
        await input.fill('Where did last month P&L come from?');
        await page.getByTestId('ask-send').click();

        await expect(page.getByTestId('ask-msg-assistant')).toContainText(
            /P&L .* nets/i,
        );
        // Tool chip should mention pnl_attribution.
        await expect(page.getByTestId('ask-msg-assistant')).toContainText(
            'pnl_attribution',
        );
    });

    test('risk-policy stress questions produce cited tool output', async ({ page }) => {
        await page.goto('/ask');
        const input = page.getByTestId('ask-input');
        await input.fill('What happens if GOOG drops 40%?');
        await page.getByTestId('ask-send').click();

        const assistant = page.getByTestId('ask-msg-assistant');
        await expect(assistant).toContainText(/GOOG -40%/);
        await expect(assistant).toContainText(/stress_test/);
        await expect(assistant.getByTestId('ask-cite').first()).toBeVisible();
    });

    test('history persists across reload under pm-ask-v1', async ({ page }) => {
        await page.goto('/ask');
        await page
            .getByTestId('ask-suggestion')
            .filter({ hasText: /overexposed/i })
            .click();
        await expect(page.getByTestId('ask-msg-assistant')).toHaveCount(1);

        await page.reload();
        await expect(page.getByTestId('ask-msg-user')).toHaveCount(1);
        await expect(page.getByTestId('ask-msg-assistant')).toHaveCount(1);

        const raw = await page.evaluate(() =>
            window.localStorage.getItem('pm-ask-v1'),
        );
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!);
        expect(Array.isArray(parsed.history)).toBe(true);
        expect(parsed.history.length).toBe(2); // user + assistant turns
        expect(parsed.dayCount).toBeGreaterThanOrEqual(1);
    });

    test('Clear button wipes the conversation', async ({ page }) => {
        await page.goto('/ask');
        await page.getByTestId('ask-suggestion').first().click();
        await expect(page.getByTestId('ask-msg-assistant')).toHaveCount(1);
        await page.getByTestId('ask-clear').click();
        await expect(page.getByTestId('ask-msg-assistant')).toHaveCount(0);
        await expect(page.getByTestId('ask-empty')).toBeVisible();
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
