import { expect, test, type Page } from '@playwright/test';
import { raiseAlert } from './helpers/alerts';
import { clickUntil, gotoAppPage, reloadAppPage } from './helpers/app';
import { databaseAuthEnabled, signInAsFreshUser } from './helpers/users';

/**
 * Alerts kept with the account (launch item i57): the rules in Settings ›
 * Alerts, and the bell in the top bar showing what the nightly alerts job
 * raised. The job itself is tested against a database in
 * scripts/db/alerts.test.ts; here a notification is added as it would add one.
 */

const priceRule = {
    name: 'AAPL above $200',
    metric: 'price',
    symbol: 'AAPL',
    comparator: 'gte',
    threshold: 200,
    enabled: true,
    rearm: 'daily',
};

async function openNewAlert(page: Page) {
    await clickUntil(page.getByRole('button', { name: /New Alert/ }), async () => {
        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1500 });
    });
    return page.getByRole('dialog');
}

const ruleRow = (page: Page, name: string) => page.locator('div.border.rounded-lg').filter({ hasText: name });

test.describe('Alerts', () => {
    test('without a database nothing can be saved, and the page says why', async ({ page }) => {
        test.skip(databaseAuthEnabled, 'this server has a database');
        await gotoAppPage(page, '/settings?tab=alerts');
        await expect(page.getByTestId('alerts-not-stored')).toBeVisible();
        await expect(page.getByRole('button', { name: /New Alert/ })).toBeDisabled();
    });

    test.describe('with a database', () => {
        test.skip(!databaseAuthEnabled, 'alerts are kept with the account');

        test('a new account has no example rules; a rule saved survives reload, can be edited, paused and deleted', async ({ context, page }) => {
            await signInAsFreshUser(context);
            await gotoAppPage(page, '/settings?tab=alerts');
            await expect(page.getByText('No alerts yet')).toBeVisible();
            await expect(page.getByText('Alpha Radar overlap score ≥ 80')).toHaveCount(0);

            let dialog = await openNewAlert(page);
            await dialog.getByLabel('Name').fill('TSLA above $250');
            await dialog.getByLabel('Threshold', { exact: false }).fill('250');
            await dialog.getByRole('button', { name: 'Create', exact: true }).click();
            // A price rule needs its symbol.
            await expect(dialog.getByText('Symbol is required for this metric')).toBeVisible();
            await dialog.getByLabel('Symbol', { exact: false }).fill('tsla');
            const created = page.waitForResponse((r) => r.url().endsWith('/api/alerts/rules') && r.request().method() === 'POST');
            await dialog.getByRole('button', { name: 'Create', exact: true }).click();
            expect((await created).status()).toBe(201);
            await expect(page.getByRole('dialog')).not.toBeVisible();

            const row = ruleRow(page, 'TSLA above $250');
            await expect(row.getByText('TSLA price ≥ $250')).toBeVisible();
            await expect(row.getByText('Each evening')).toBeVisible();
            await expect(row.getByText("Hasn't fired yet")).toBeVisible();

            await reloadAppPage(page);
            await expect(row.getByText('TSLA price ≥ $250')).toBeVisible();

            await row.getByRole('button', { name: 'Edit TSLA above $250' }).click();
            dialog = page.getByRole('dialog');
            await dialog.getByLabel('Threshold', { exact: false }).fill('300');
            await dialog.getByRole('button', { name: 'Save', exact: true }).click();
            await expect(row.getByText('TSLA price ≥ $300')).toBeVisible();

            const paused = page.waitForResponse((r) => r.url().includes('/api/alerts/rules/') && r.request().method() === 'PUT');
            await row.getByRole('switch', { name: 'Toggle TSLA above $250' }).click();
            expect((await paused).ok()).toBe(true);
            await expect(row.getByText('Paused')).toBeVisible();
            await reloadAppPage(page);
            await expect(row.getByText('Paused')).toBeVisible();
            await expect(row.getByText('TSLA price ≥ $300')).toBeVisible();

            await row.getByRole('button', { name: 'Delete TSLA above $250' }).click();
            await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
            await expect(page.getByText('No alerts yet')).toBeVisible();
            await reloadAppPage(page);
            await expect(page.getByText('No alerts yet')).toBeVisible();
        });

        test('the bell shows what the rules raised, newest first; one read, then all, then cleared', async ({ context, page }) => {
            const userId = await signInAsFreshUser(context);
            await gotoAppPage(page, '/');
            await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible();

            const response = await page.request.post('/api/alerts/rules', { data: priceRule });
            expect(response.status()).toBe(201);
            const rule = (await response.json()).data;
            await raiseAlert(userId, rule.id, {
                occurrence: 'session:2026-10-30', symbol: 'AAPL', triggeredAt: '2026-10-30T22:35:00Z',
                message: 'AAPL closed at $201.00 on Oct 30, at or above $200.00.',
            });
            await raiseAlert(userId, rule.id, {
                occurrence: 'session:2026-11-02', symbol: 'AAPL', triggeredAt: '2026-11-02T22:35:00Z',
                message: 'AAPL closed at $210.00 on Nov 2, at or above $200.00.',
            });

            await reloadAppPage(page);
            const bell = page.getByRole('button', { name: '2 unread alerts' });
            await expect(bell).toBeVisible();
            await bell.click();
            const menu = page.getByRole('menu');
            await expect(menu.getByText(/^AAPL closed at/)).toHaveText([
                'AAPL closed at $210.00 on Nov 2, at or above $200.00.',
                'AAPL closed at $201.00 on Oct 30, at or above $200.00.',
            ]);

            // Opening one reads it.
            await menu.getByRole('link', { name: 'Open AAPL' }).first().click();
            await expect(page).toHaveURL(/\/portfolios\/detail\/AAPL$/);
            await expect(page.getByRole('button', { name: '1 unread alerts' })).toBeVisible();
            await reloadAppPage(page);
            await page.getByRole('button', { name: '1 unread alerts' }).click();
            await page.getByRole('menu').getByRole('button', { name: 'Mark all read' }).click();
            await expect(page.getByRole('menu').getByRole('button', { name: 'Mark read' })).toHaveCount(0);
            await page.keyboard.press('Escape');
            await expect(page.getByRole('button', { name: 'Notifications' })).toBeVisible();

            await reloadAppPage(page);
            await page.getByRole('button', { name: 'Notifications' }).click();
            await expect(page.getByRole('menu').getByText(/^AAPL closed at/)).toHaveCount(2);
            await page.getByRole('menu').getByRole('button', { name: 'Clear all alerts' }).click();
            await expect(page.getByRole('menu').getByText('No alerts yet')).toBeVisible();
            await reloadAppPage(page);
            await page.getByRole('button', { name: 'Notifications' }).click();
            await expect(page.getByRole('menu').getByText('No alerts yet')).toBeVisible();

            // The rule stays; its run history shows in Settings.
            await gotoAppPage(page, '/settings?tab=alerts');
            await expect(ruleRow(page, 'AAPL above $200').getByText('AAPL price ≥ $200')).toBeVisible();
        });

        test('the API keeps each account\'s rules and alerts to itself, and refuses what a rule can\'t be', async ({ browser, context, page, playwright }) => {
            await signInAsFreshUser(context);
            await gotoAppPage(page, '/settings?tab=alerts');
            const created = await page.request.post('/api/alerts/rules', { data: priceRule });
            const rule = (await created.json()).data;
            expect(rule).toMatchObject({ name: 'AAPL above $200', metric: 'price', symbol: 'AAPL', source: 'market', enabled: true });

            const extra = await page.request.post('/api/alerts/rules', { data: { ...priceRule, userId: 'someone-else' } });
            expect(extra.status()).toBe(400);
            expect((await extra.json()).code).toBe('INVALID_ALERT_RULE');
            const noSymbol = await page.request.post('/api/alerts/rules', { data: { ...priceRule, symbol: undefined } });
            expect(noSymbol.status()).toBe(400);
            expect((await noSymbol.json()).error).toBe('symbol: Symbol is required for this metric');
            const tooLarge = await page.request.post('/api/alerts/rules', { data: { ...priceRule, note: 'x'.repeat(5000) } });
            expect(tooLarge.status()).toBe(413);
            const badRead = await page.request.patch('/api/alerts/notifications', { data: { ids: ['not-an-id'] } });
            expect(badRead.status()).toBe(400);

            // Another account sees none of it and can't change it.
            const otherContext = await browser.newContext();
            await signInAsFreshUser(otherContext);
            const other = otherContext.request;
            expect((await (await other.get('http://localhost:3000/api/alerts/rules')).json()).data.rules).toEqual([]);
            expect((await other.put(`http://localhost:3000/api/alerts/rules/${rule.id}`, { data: { ...priceRule, threshold: 1 } })).status()).toBe(404);
            expect((await other.delete(`http://localhost:3000/api/alerts/rules/${rule.id}`)).status()).toBe(404);
            expect((await other.delete('http://localhost:3000/api/alerts/rules/not-a-uuid')).status()).toBe(404);
            await otherContext.close();
            const mine = (await (await page.request.get('/api/alerts/rules')).json()).data;
            expect(mine.rules.map((r: { threshold: number }) => r.threshold)).toEqual([200]);
            expect(mine.stored).toBe(true);

            // A request context of its own: the page's background requests keep
            // setting the session cookie on the shared one.
            const anonymous = await playwright.request.newContext({
                baseURL: 'http://localhost:3000',
                storageState: { cookies: [], origins: [] },
            });
            expect((await anonymous.get('/api/alerts/rules')).status()).toBe(401);
            expect((await anonymous.post('/api/alerts/rules', { data: priceRule })).status()).toBe(401);
            expect((await anonymous.put(`/api/alerts/rules/${rule.id}`, { data: priceRule })).status()).toBe(401);
            expect((await anonymous.delete(`/api/alerts/rules/${rule.id}`)).status()).toBe(401);
            expect((await anonymous.get('/api/alerts/notifications')).status()).toBe(401);
            expect((await anonymous.patch('/api/alerts/notifications', { data: { all: true } })).status()).toBe(401);
            expect((await anonymous.delete('/api/alerts/notifications')).status()).toBe(401);
            await anonymous.dispose();
        });
    });
});
