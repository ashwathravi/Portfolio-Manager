import { randomUUID } from 'node:crypto';

import { test, expect } from '@playwright/test';

import { gotoAppPage, reloadAppPage } from './helpers/app';
import { database, databaseAuthEnabled, signInAsFreshUser } from './helpers/users';

/**
 * Launch item i60: following Alpha Radar filers, with a tracked filer and a
 * report of its own in the database. Filers are shared by every user and the
 * other specs expect none, so this file runs in its own Playwright project
 * after them (playwright.config.ts), one test at a time, and removes the
 * filer when it's done.
 */

test.describe.configure({ mode: 'serial' });

test.describe('Following Alpha Radar filers', () => {
    test.skip(!databaseAuthEnabled, 'Follows are kept with the account: only with database sessions.');

    const filerId = randomUUID();
    const filerName = 'E2E Follow Capital';
    const summary = 'Added to Apple and trimmed Chubb.';
    // Nobody follows this one; its 21 newer reports are more than the
    // latest 20 the reports API returns by default.
    const crowdId = randomUUID();

    test.beforeAll(async () => {
        const sql = database();
        const cik = String(Date.now()).slice(-10).padStart(10, '0');
        await sql`
            INSERT INTO alpha_radar_tracked_filers (id, name, slug, cik, fund_style, enabled)
            VALUES (${filerId}, ${filerName}, ${`e2e-follow-${filerId}`}, ${cik}, 'Concentrated value', true)`;
        await sql`
            INSERT INTO alpha_radar_reports (tracked_filer_id, report_period, title, summary, sections, markdown, source_filing_ids)
            VALUES (${filerId}, '2026-Q3', ${`${filerName} Alpha Radar 2026-Q3`}, ${summary},
                    ${sql.json([{ id: 'summary', title: 'Summary', kind: 'summary', markdown: summary, changeIds: [] }])},
                    ${summary}, ${sql.json([])})`;
        await sql`
            INSERT INTO alpha_radar_tracked_filers (id, name, slug, cik, fund_style, enabled)
            VALUES (${crowdId}, 'E2E Crowd Partners', ${`e2e-crowd-${crowdId}`}, ${String(Number(cik) + 1).padStart(10, '0')}, 'Macro', true)`;
        await sql`
            INSERT INTO alpha_radar_reports (tracked_filer_id, report_period, title, summary, sections, markdown, source_filing_ids)
            SELECT ${crowdId}, (2027 + n / 4)::text || '-Q' || (n % 4 + 1)::text, 'E2E Crowd Partners report', 'A newer report.',
                   ${sql.json([{ id: 'summary', title: 'Summary', kind: 'summary', markdown: 'A newer report.', changeIds: [] }])},
                   'A newer report.', ${sql.json([])}
            FROM generate_series(0, 20) AS n`;
    });

    test.afterAll(async () => {
        // Their reports and every follow go with them.
        await database()`DELETE FROM alpha_radar_tracked_filers WHERE id IN (${filerId}, ${crowdId})`;
    });

    test('a user follows a filer, it stays followed, and Today shows its reports', async ({ page, context }) => {
        await signInAsFreshUser(context);

        // Today, before following anything: no example card, a prompt instead.
        await gotoAppPage(page, '/');
        const card = page.getByTestId('alpha-radar-dashboard-card');
        await expect(card).toHaveCount(1);
        await expect(card.getByTestId('alpha-radar-dashboard-subtitle')).toHaveText('Latest 13F changes from the managers you follow');
        await expect(card.getByTestId('alpha-radar-dashboard-follow-prompt')).toBeVisible();
        await expect(card.getByTestId('alpha-radar-dashboard-fallback')).toHaveCount(0);
        await expect(card.getByTestId('alpha-radar-dashboard-row')).toHaveCount(0);
        await expect(page.getByTestId('today-examples').getByTestId('alpha-radar-dashboard-card')).toHaveCount(0);

        await gotoAppPage(page, '/research?tab=alpha-radar');
        await page.getByTestId('alpha-radar-filer').filter({ hasText: filerName }).click();
        const follow = page.getByTestId('alpha-radar-follow');
        await expect(follow).toHaveText('Follow');
        await expect(follow).toHaveAttribute('aria-pressed', 'false');
        await expect(follow).toBeEnabled();

        const saved = page.waitForResponse((response) => response.url().endsWith(`/api/alpha-radar/follows/${filerId}`) && response.request().method() === 'PUT');
        await follow.click();
        expect((await saved).status()).toBe(200);
        await expect(follow).toHaveText('Following');
        await expect(follow).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId('alpha-radar-filer').filter({ hasText: filerName }).getByTestId('alpha-radar-filer-following')).toBeVisible();

        // Research opens on the first filer by name, so pick it again.
        await reloadAppPage(page);
        await page.getByTestId('alpha-radar-filer').filter({ hasText: filerName }).click();
        await expect(page.getByTestId('alpha-radar-follow')).toHaveText('Following');

        // Its report, though another filer has 21 newer ones (a regression:
        // Today filtered the latest 20 of every filer's).
        await gotoAppPage(page, '/');
        await expect(card.getByTestId('alpha-radar-dashboard-follow-prompt')).toHaveCount(0);
        const row = card.getByTestId('alpha-radar-dashboard-row');
        await expect(row).toHaveCount(1);
        await expect(row).toContainText(filerName);
        await expect(row).toContainText(summary);
        await expect(row).toContainText('2026-Q3');

        // Unfollowing puts it back.
        await gotoAppPage(page, '/research?tab=alpha-radar');
        await page.getByTestId('alpha-radar-filer').filter({ hasText: filerName }).click();
        await page.getByTestId('alpha-radar-follow').click();
        await expect(page.getByTestId('alpha-radar-follow')).toHaveText('Follow');
        await expect.poll(async () => (await (await page.request.get('/api/alpha-radar/follows')).json()).data.filerIds).toEqual([]);
        await reloadAppPage(page);
        await page.getByTestId('alpha-radar-filer').filter({ hasText: filerName }).click();
        await expect(page.getByTestId('alpha-radar-follow')).toHaveText('Follow');
    });

    test('one account\'s follows never reach another', async ({ page, context, browser }) => {
        await signInAsFreshUser(context);
        expect((await page.request.put(`/api/alpha-radar/follows/${filerId}`)).status()).toBe(200);
        expect((await (await page.request.get('/api/alpha-radar/follows')).json()).data.filerIds).toEqual([filerId]);

        const otherContext = await browser.newContext();
        await signInAsFreshUser(otherContext);
        const other = await otherContext.newPage();
        expect((await (await other.request.get('/api/alpha-radar/follows')).json()).data.filerIds).toEqual([]);
        await gotoAppPage(other, '/research?tab=alpha-radar');
        await other.getByTestId('alpha-radar-filer').filter({ hasText: filerName }).click();
        await expect(other.getByTestId('alpha-radar-follow')).toHaveText('Follow');
        await otherContext.close();
    });

    test('a follow that can\'t be saved is put back, and says so', async ({ page, context }) => {
        await signInAsFreshUser(context);
        await page.route(`**/api/alpha-radar/follows/${filerId}`, (route) => route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Unable to follow the filer.', code: 'ALPHA_RADAR_FOLLOW_FAILED' }),
        }));

        await gotoAppPage(page, '/research?tab=alpha-radar');
        await page.getByTestId('alpha-radar-filer').filter({ hasText: filerName }).click();
        await page.getByTestId('alpha-radar-follow').click();

        await expect(page.getByTestId('alpha-radar-follow-error')).toHaveText("Couldn't save that. Try again.");
        await expect(page.getByTestId('alpha-radar-follow')).toHaveText('Follow');
        await expect(page.getByTestId('alpha-radar-follow')).toHaveAttribute('aria-pressed', 'false');
    });

    test('the API follows only filers that exist, and refuses signed-out callers', async ({ page, context, playwright }) => {
        await signInAsFreshUser(context);

        for (const id of ['00000000-0000-4000-8000-0000000f0000', 'not-a-filer']) {
            const response = await page.request.put(`/api/alpha-radar/follows/${id}`);
            expect(response.status(), id).toBe(404);
            expect(await response.json()).toEqual({ error: 'Tracked filer not found', code: 'TRACKED_FILER_NOT_FOUND' });
        }
        // Stopping a follow that isn't there changes nothing.
        const unfollowed = await page.request.delete('/api/alpha-radar/follows/00000000-0000-4000-8000-0000000f0000');
        expect(unfollowed.status()).toBe(200);
        expect((await (await page.request.get('/api/alpha-radar/follows')).json()).data.filerIds).toEqual([]);

        const anonymous = await playwright.request.newContext({
            baseURL: 'http://localhost:3000',
            storageState: { cookies: [], origins: [] },
        });
        expect((await anonymous.get('/api/alpha-radar/follows')).status()).toBe(401);
        expect((await anonymous.put(`/api/alpha-radar/follows/${filerId}`)).status()).toBe(401);
        expect((await anonymous.delete(`/api/alpha-radar/follows/${filerId}`)).status()).toBe(401);
        await anonymous.dispose();
    });
});
