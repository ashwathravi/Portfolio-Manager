import { test, expect } from '@playwright/test';
import { gotoAppPage } from './helpers/app';

/**
 * Sidebar + information architecture.
 *
 * The design review collapsed 21 routes into eight destinations
 * (src/lib/navigation.ts). The sidebar lists Today, Portfolio,
 * Performance, Research, Strategies, Trade, and Ask under Workspace, with
 * Settings under System; Help is a tab inside Settings. Portfolio,
 * Performance, and Settings expose their views as section tabs under the
 * page title. Retired routes redirect.
 */

test.describe('Sidebar navigation', () => {
    test('navigates to every destination from the sidebar', async ({ page }) => {
        await gotoAppPage(page, '/');
        const sidebar = page.locator('aside.pm-sidebar');
        await expect(sidebar).toBeVisible();
        await expect(sidebar.getByRole('link', { name: /^Today$/ })).toHaveAttribute('aria-current', 'page');

        const journey: Array<[RegExp, RegExp]> = [
            [/^Portfolio$/, /\/portfolios\/holdings$/],
            [/^Performance$/, /\/performance$/],
            [/^Research$/, /\/research(\?|$)/],
            [/^Strategies$/, /\/strategies(\?|$)/],
            [/^Trade$/, /\/execution$/],
            [/^Ask\b/, /\/ask$/],
            [/^Settings$/, /\/settings$/],
        ];
        for (const [name, url] of journey) {
            await sidebar.getByRole('link', { name }).click();
            await expect(page).toHaveURL(url);
            await expect(sidebar.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
        }
    });

    test('exposes both Workspace and System section labels', async ({ page }) => {
        await page.goto('/');
        const sidebar = page.locator('aside.pm-sidebar');
        await expect(sidebar.locator('.pm-nav-label', { hasText: /^Workspace$/i })).toBeVisible();
        await expect(sidebar.locator('.pm-nav-label', { hasText: /^System$/i })).toBeVisible();
    });

    test('the sidebar has exactly eight destinations; Help is inside Settings', async ({ page }) => {
        await gotoAppPage(page, '/');
        const sidebar = page.locator('aside.pm-sidebar');
        await expect(sidebar.locator('a.pm-nav-item')).toHaveCount(8);
        await expect(sidebar.getByRole('link', { name: /^Help$/ })).toHaveCount(0);
        await gotoAppPage(page, '/help');
        await expect(sidebar.getByRole('link', { name: /^Settings$/ })).toHaveAttribute('aria-current', 'page');
        const tabs = page.getByRole('navigation', { name: 'Section', exact: true });
        await expect(tabs.getByRole('link')).toHaveText(['General', 'Help']);
        await expect(tabs.getByRole('link', { name: 'Help' })).toHaveAttribute('aria-current', 'page');
        await tabs.getByRole('link', { name: 'General' }).click();
        await expect(page).toHaveURL(/\/settings$/);
    });

    test('retired destinations are no longer in the sidebar', async ({ page }) => {
        await page.goto('/');
        const sidebar = page.locator('aside.pm-sidebar');
        for (const name of [/^Dashboard$/, /^Holdings$/, /^Execution$/, /^Analytics$/]) {
            await expect(sidebar.getByRole('link', { name })).toHaveCount(0);
        }
    });

    test('regression: the user footer shows the signed-in identity, not a placeholder', async ({ page }) => {
        await gotoAppPage(page, '/');
        const name = page.locator('.pm-user-name');
        await expect(name).not.toHaveText('');
        await expect(name).not.toHaveText('John Doe');
        await expect(page.locator('.pm-user-plan')).not.toContainText('Pro');
    });
});

test.describe('Section tabs', () => {
    test('Portfolio shows Holdings · Accounts · Activity and marks the current view', async ({ page }) => {
        await gotoAppPage(page, '/portfolios/holdings');
        const tabs = page.getByRole('navigation', { name: 'Section' });
        await expect(tabs.getByRole('link')).toHaveText(['Holdings', 'Accounts', 'Activity']);
        await expect(tabs.getByRole('link', { name: 'Holdings' })).toHaveAttribute('aria-current', 'page');

        await tabs.getByRole('link', { name: 'Accounts' }).click();
        await expect(page).toHaveURL(/\/portfolios\/accounts$/);
        await expect(tabs.getByRole('link', { name: 'Accounts' })).toHaveAttribute('aria-current', 'page');

        await tabs.getByRole('link', { name: 'Activity' }).click();
        await expect(page).toHaveURL(/\/portfolios\/activity$/);
        await expect(tabs.getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
    });

    test('Performance shows Returns · Attribution · Behaviour', async ({ page }) => {
        await gotoAppPage(page, '/performance/behaviour');
        const tabs = page.getByRole('navigation', { name: 'Section' });
        await expect(tabs.getByRole('link')).toHaveText(['Returns', 'Attribution', 'Behaviour']);
        await expect(tabs.getByRole('link', { name: 'Behaviour' })).toHaveAttribute('aria-current', 'page');
    });

    test('position detail keeps Portfolio › Holdings selected', async ({ page }) => {
        await gotoAppPage(page, '/portfolios/detail/AAPL');
        await expect(page.locator('aside.pm-sidebar').getByRole('link', { name: /^Portfolio$/ })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByRole('navigation', { name: 'Section' }).getByRole('link', { name: 'Holdings' })).toHaveAttribute('aria-current', 'page');
    });

    test('single-view destinations have no section tabs', async ({ page }) => {
        await gotoAppPage(page, '/research');
        await expect(page.getByRole('navigation', { name: 'Section' })).toHaveCount(0);
    });
});

test.describe('Legacy route redirects', () => {
    const cases: Array<[string, RegExp]> = [
        ['/portfolios', /\/portfolios\/holdings$/],
        ['/portfolios/trade-log', /\/portfolios\/activity$/],
        ['/analytics', /\/performance\/behaviour$/],
        ['/research/journal', /\/research\?tab=journal$/],
        ['/strategies/builder', /\/strategies$/],
        ['/strategies/deploy', /\/strategies$/],
    ];
    for (const [from, to] of cases) {
        test(`${from} redirects to its replacement`, async ({ page }) => {
            await page.goto(from);
            await expect(page).toHaveURL(to);
        });
    }
});
