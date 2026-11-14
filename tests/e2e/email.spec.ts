import { expect, test } from '@playwright/test';
import { gotoAppPage, reloadAppPage } from './helpers/app';
import { databaseAuthEnabled, e2eDatabase, signInAsFreshUser } from './helpers/users';

/**
 * Email (launch item i58): Settings' Email card, kept with the account, and
 * unsubscribing through an email's links, signed out. The nightly job that
 * sends them is tested against a database in scripts/db/email.test.ts. E2E
 * never sends email (no RESEND_API_KEY), so the card says this server
 * doesn't send yet.
 */

async function unsubscribeToken(userId: string): Promise<string> {
    const [row] = await e2eDatabase()<{ unsubscribe_token: string }[]>`SELECT unsubscribe_token FROM email_preferences WHERE user_id = ${userId}`;
    return row.unsubscribe_token;
}

const UNKNOWN_TOKEN = 'x'.repeat(43);

test.describe('Email', () => {
    test('without a database nothing can be saved, and the card says why', async ({ page }) => {
        test.skip(databaseAuthEnabled, 'this server has a database');
        await gotoAppPage(page, '/settings#email');
        const card = page.getByTestId('email-preferences');
        await expect(card.getByTestId('email-not-stored')).toBeVisible();
        await expect(card.getByRole('switch', { name: /Alerts/ })).toBeDisabled();
        await expect(card.getByRole('switch', { name: /Weekly review/ })).toBeDisabled();
    });

    test.describe('with a database', () => {
        test.skip(!databaseAuthEnabled, 'email settings are kept with the account');

        test('both off for a new account; a switch turned on survives reload; this server doesn\'t send yet', async ({ context, page }) => {
            const userId = await signInAsFreshUser(context);
            await gotoAppPage(page, '/settings#email');
            const card = page.getByTestId('email-preferences');
            await expect(card.getByTestId('email-address')).toContainText(`e2e-${userId}@example.test`);
            const alerts = card.getByRole('switch', { name: /Alerts/ });
            const review = card.getByRole('switch', { name: /Weekly review/ });
            await expect(alerts).toBeEnabled();
            await expect(alerts).not.toBeChecked();
            await expect(review).not.toBeChecked();
            await expect(card.getByTestId('email-not-sending')).toBeVisible();

            const saved = page.waitForResponse((r) => r.url().endsWith('/api/email/preferences') && r.request().method() === 'PUT');
            await alerts.click();
            expect((await saved).status()).toBe(200);
            await expect(alerts).toBeChecked();

            await reloadAppPage(page);
            await expect(card.getByRole('switch', { name: /Alerts/ })).toBeChecked();
            await expect(card.getByRole('switch', { name: /Weekly review/ })).not.toBeChecked();
            // The old Weekly Summary switch promised an email that never went.
            await expect(page.getByText('Weekly Summary', { exact: true })).toHaveCount(0);
        });

        test('an email\'s unsubscribe link works signed out: opening it changes nothing, the button stops that one email', async ({ browser, context, page }) => {
            const userId = await signInAsFreshUser(context);
            await gotoAppPage(page, '/settings#email');
            expect((await page.request.put('/api/email/preferences', { data: { alerts: true, weeklyReview: true } })).status()).toBe(200);
            const token = await unsubscribeToken(userId);

            const signedOut = await browser.newContext();
            const visitor = await signedOut.newPage();
            await visitor.goto(`http://localhost:3000/unsubscribe?token=${token}&list=alerts`);
            await expect(visitor.getByRole('heading', { level: 1, name: 'Unsubscribe' })).toBeVisible();
            await expect(visitor.getByText('Stop sending alert emails to you?')).toBeVisible();
            await expect(visitor.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
            // A mail scanner opening the link turns nothing off.
            let preferences = (await (await page.request.get('/api/email/preferences')).json()).data;
            expect(preferences).toMatchObject({ alerts: true, weeklyReview: true });

            await visitor.getByTestId('unsubscribe-confirm').click();
            await expect(visitor.getByRole('heading', { level: 1, name: 'You’re unsubscribed' })).toBeVisible();
            await expect(visitor.getByTestId('unsubscribe-done')).toContainText('You won’t get alert emails anymore.');
            expect(visitor.url()).not.toContain(token);
            preferences = (await (await page.request.get('/api/email/preferences')).json()).data;
            expect(preferences).toMatchObject({ alerts: false, weeklyReview: true });

            await visitor.goto(`http://localhost:3000/unsubscribe?token=${UNKNOWN_TOKEN}&list=weekly_review`);
            await visitor.getByTestId('unsubscribe-confirm').click();
            await expect(visitor.getByTestId('unsubscribe-invalid')).toBeVisible();
            await visitor.goto('http://localhost:3000/unsubscribe?token=short&list=alerts');
            await expect(visitor.getByTestId('unsubscribe-invalid')).toBeVisible();
            await signedOut.close();

            await reloadAppPage(page);
            await expect(page.getByTestId('email-preferences').getByRole('switch', { name: /Alerts/ })).not.toBeChecked();
            await expect(page.getByTestId('email-preferences').getByRole('switch', { name: /Weekly review/ })).toBeChecked();
        });

        test('one click from a mail app: a POST with the link\'s token and no session stops that email', async ({ context, page, playwright }) => {
            const userId = await signInAsFreshUser(context);
            await gotoAppPage(page, '/settings#email');
            expect((await page.request.put('/api/email/preferences', { data: { alerts: true, weeklyReview: true } })).status()).toBe(200);
            const token = await unsubscribeToken(userId);

            const mailApp = await playwright.request.newContext({ baseURL: 'http://localhost:3000', storageState: { cookies: [], origins: [] } });
            const oneClick = await mailApp.post(`/api/email/unsubscribe?token=${token}&list=weekly_review`, { form: { 'List-Unsubscribe': 'One-Click' } });
            expect(oneClick.status()).toBe(200);
            expect(await oneClick.json()).toEqual({ data: { unsubscribed: 'weekly_review' } });
            expect((await (await page.request.get('/api/email/preferences')).json()).data).toMatchObject({ alerts: true, weeklyReview: false });

            const unknown = await mailApp.post(`/api/email/unsubscribe?token=${UNKNOWN_TOKEN}&list=alerts`);
            expect(unknown.status()).toBe(404);
            expect((await unknown.json()).code).toBe('UNSUBSCRIBE_LINK_NOT_FOUND');
            expect((await mailApp.post(`/api/email/unsubscribe?token=${token}&list=everything`)).status()).toBe(400);
            expect((await mailApp.post('/api/email/unsubscribe')).status()).toBe(400);
            expect((await mailApp.get(`/api/email/unsubscribe?token=${token}&list=alerts`)).status()).not.toBe(200);
            await mailApp.dispose();
            expect((await (await page.request.get('/api/email/preferences')).json()).data.alerts).toBe(true);
        });

        test('the API keeps each account\'s choices to itself and refuses what isn\'t a choice', async ({ browser, context, page, playwright }) => {
            await signInAsFreshUser(context);
            await gotoAppPage(page, '/settings#email');
            expect((await page.request.put('/api/email/preferences', { data: { alerts: true } })).status()).toBe(200);

            const empty = await page.request.put('/api/email/preferences', { data: {} });
            expect(empty.status()).toBe(400);
            expect((await empty.json()).error).toBe('Send alerts, weeklyReview or both');
            const notBoolean = await page.request.put('/api/email/preferences', { data: { alerts: 'yes' } });
            expect(notBoolean.status()).toBe(400);
            expect((await notBoolean.json()).error).toMatch(/^alerts: /);
            const extra = await page.request.put('/api/email/preferences', { data: { alerts: true, address: 'someone@example.test' } });
            expect(extra.status()).toBe(400);
            expect((await extra.json()).code).toBe('INVALID_EMAIL_PREFERENCES');
            expect((await page.request.put('/api/email/preferences', { data: { alerts: true, pad: 'x'.repeat(2000) } })).status()).toBe(413);

            const otherContext = await browser.newContext();
            await signInAsFreshUser(otherContext);
            expect((await (await otherContext.request.get('http://localhost:3000/api/email/preferences')).json()).data)
                .toMatchObject({ alerts: false, weeklyReview: false, stored: true, sending: false });
            await otherContext.close();
            expect((await (await page.request.get('/api/email/preferences')).json()).data.alerts).toBe(true);

            const anonymous = await playwright.request.newContext({ baseURL: 'http://localhost:3000', storageState: { cookies: [], origins: [] } });
            expect((await anonymous.get('/api/email/preferences')).status()).toBe(401);
            expect((await anonymous.put('/api/email/preferences', { data: { alerts: false } })).status()).toBe(401);
            await anonymous.dispose();
        });
    });
});
