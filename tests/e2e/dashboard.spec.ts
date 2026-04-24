import { test, expect } from '@playwright/test';

/**
 * Phase 9 (AR-94) Dashboard tests.
 *
 * Phase 3 (AR-70/71/72/73) replaced the legacy "Good Morning / stat card
 * / connected accounts / Add Asset" layout with a new workflow:
 *
 *   Topbar h1 ............. "Dashboard" (via PageHeaderSync)
 *   DashboardTopbar ....... crumbs + greeting + market-state subtitle
 *                            + Reconcile / New order actions
 *   DashboardStatRow ...... 4 StatCards (Net Worth, Today's P&L,
 *                            Alpha vs S&P, Cash Runway)
 *   2-col split ........... EquityChartCard + AllocationCard
 *   63/37 split ........... TopHoldingsCard + RecentActivityCard
 *   3-col bottom strip .... WatchlistCard + ActiveThesesCard + DailyBrief
 */

test.describe('Dashboard page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('Topbar title renders "Dashboard"', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Dashboard');
    });

    test('DashboardTopbar renders greeting + market-state subtitle', async ({ page }) => {
        // `<h1 class="pm-greeting">Good {morning|afternoon|evening}, {firstName}</h1>`
        await expect(page.locator('h1.pm-greeting')).toContainText(
            /Good (morning|afternoon|evening)/,
        );
        // Subtitle: "{Weekday} · Markets {open|closed}[ · Updated Ns ago]"
        await expect(page.locator('.pm-greeting-sub')).toContainText(/Markets (open|closed)/);
    });

    test('DashboardTopbar exposes Reconcile + New order quick-actions', async ({ page }) => {
        await expect(page.getByRole('link', { name: /Reconcile/ })).toBeVisible();
        await expect(page.getByRole('link', { name: /New order/ })).toBeVisible();
    });

    test('stat row renders the four headline cards', async ({ page }) => {
        const stats = page.locator('.pm-grid-stats');
        await expect(stats).toBeVisible();
        await expect(stats.getByText('Net Worth', { exact: true })).toBeVisible();
        await expect(stats.getByText("Today's P&L")).toBeVisible();
        await expect(stats.getByText('Alpha vs S&P')).toBeVisible();
        await expect(stats.getByText('Cash Runway')).toBeVisible();
    });

    test('middle row renders Equity Curve + Allocation cards', async ({ page }) => {
        await expect(
            page.locator('.pm-card-title', { hasText: /^Equity Curve$/ }),
        ).toBeVisible();
        await expect(
            page.locator('.pm-card-title', { hasText: /^Allocation$/ }),
        ).toBeVisible();
    });

    test('63/37 split renders Top Holdings + Recent Activity cards', async ({ page }) => {
        await expect(
            page.locator('.pm-card-title', { hasText: /^Top Holdings$/ }),
        ).toBeVisible();
        await expect(
            page.locator('.pm-card-title', { hasText: /^Recent Activity$/ }),
        ).toBeVisible();
    });

    test('bottom 3-col strip shows Watchlist, Active Theses, and Daily Brief', async ({ page }) => {
        await expect(
            page.locator('.pm-card-title', { hasText: /^Watchlist$/ }),
        ).toBeVisible();
        await expect(
            page.locator('.pm-card-title', { hasText: /^Active Theses$/ }),
        ).toBeVisible();
        // Daily Brief uses the "insight" chip rather than a card-title h3.
        await expect(page.locator('.pm-insight-chip', { hasText: 'Daily Brief' })).toBeVisible();
    });
});
