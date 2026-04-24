import { test, expect } from '@playwright/test';

/**
 * Phase 9 (AR-94) + AR-112 Dashboard tests.
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
 *   63/37 bottom strip .... PatternFeed (wide) + side stack with
 *                            WatchlistCard + ActiveThesesCard (AR-112
 *                            replaced the old DailyBriefCard with the
 *                            pattern feed)
 */

test.describe('Dashboard page', () => {
    test.beforeEach(async ({ page }) => {
        // Clear pattern snooze state so dismissal tests are deterministic
        // across runs.
        await page.addInitScript(() => {
            try {
                window.localStorage.removeItem('pm-pattern-snoozed');
            } catch {
                /* private mode — ignore */
            }
        });
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

    test('bottom strip shows Pattern feed alongside Watchlist + Active Theses', async ({ page }) => {
        await expect(page.getByTestId('pattern-feed')).toBeVisible();
        await expect(
            page.locator('.pm-card-title', { hasText: /^Watchlist$/ }),
        ).toBeVisible();
        await expect(
            page.locator('.pm-card-title', { hasText: /^Active Theses$/ }),
        ).toBeVisible();
    });
});

// --------------------------------------------------------------------- //
// AR-112 — Pattern feed card
// --------------------------------------------------------------------- //

test.describe('Pattern feed (AR-112)', () => {
    test.beforeEach(async ({ page }) => {
        // Ensure each test starts with zero snoozed patterns so the
        // seed journal always surfaces the full set of detector hits.
        await page.addInitScript(() => {
            try {
                window.localStorage.removeItem('pm-pattern-snoozed');
            } catch {
                /* ignore */
            }
        });
        await page.goto('/');
    });

    test('feed renders with heading, pill, refresh + at least one row', async ({ page }) => {
        const feed = page.getByTestId('pattern-feed');
        await expect(feed).toBeVisible();
        await expect(feed.locator('#pm-pattern-feed-head')).toHaveText('Pattern feed');
        await expect(feed.getByTestId('pattern-feed-refresh')).toBeVisible();
        // Seed journal reliably surfaces at least one pattern.
        await expect(feed.getByTestId('pattern-row').first()).toBeVisible();
    });

    test('pattern row exposes severity + detector data attributes', async ({ page }) => {
        const firstRow = page.getByTestId('pattern-row').first();
        await expect(firstRow).toBeVisible();
        await expect(firstRow).toHaveAttribute('data-severity', /^(warn|caution|positive|info)$/);
        await expect(firstRow).toHaveAttribute('data-detector', /.+/);
    });

    test('each row carries a dismiss control', async ({ page }) => {
        const firstRow = page.getByTestId('pattern-row').first();
        const dismiss = firstRow.getByTestId('pattern-row-dismiss');
        await expect(dismiss).toBeVisible();
        await expect(dismiss).toHaveAttribute(
            'aria-label',
            /Dismiss pattern for 30 days/,
        );
    });

    test('refresh button re-runs detectors without error', async ({ page }) => {
        const feed = page.getByTestId('pattern-feed');
        // Wait for the initial detector pass to settle — the card
        // starts with the skeleton on first paint and fills in async.
        await expect(feed.getByTestId('pattern-row').first()).toBeVisible();
        const countBefore = await feed.getByTestId('pattern-row').count();
        expect(countBefore).toBeGreaterThan(0);
        await feed.getByTestId('pattern-feed-refresh').click();
        // Detector set is deterministic on the seed — count should be
        // stable through the refresh.
        await expect(async () => {
            const countAfter = await feed.getByTestId('pattern-row').count();
            expect(countAfter).toBe(countBefore);
        }).toPass({ timeout: 2000 });
    });

    test('dismissing a pattern removes the row and persists in localStorage', async ({ page }) => {
        const feed = page.getByTestId('pattern-feed');
        const firstRow = feed.getByTestId('pattern-row').first();
        const firstDetector = await firstRow.getAttribute('data-detector');
        expect(firstDetector).not.toBeNull();

        const countBefore = await feed.getByTestId('pattern-row').count();
        await firstRow.getByTestId('pattern-row-dismiss').click();

        // The specific detector should be gone from the visible list.
        await expect(
            feed.locator(`[data-testid="pattern-row"][data-detector="${firstDetector}"]`),
        ).toHaveCount(0);
        // And total count should have shrunk by exactly one.
        await expect(feed.getByTestId('pattern-row')).toHaveCount(countBefore - 1);

        // Snooze state is written to localStorage under the documented key.
        const snoozed = await page.evaluate(() =>
            window.localStorage.getItem('pm-pattern-snoozed'),
        );
        expect(snoozed).not.toBeNull();
        const parsed = JSON.parse(snoozed!);
        expect(Object.keys(parsed).length).toBeGreaterThanOrEqual(1);
    });

    test('feed shows at most six patterns collapsed; expands to show the rest', async ({ page }) => {
        const feed = page.getByTestId('pattern-feed');
        const collapsedCount = await feed.getByTestId('pattern-row').count();
        expect(collapsedCount).toBeLessThanOrEqual(6);

        const expand = feed.getByTestId('pattern-feed-expand');
        // If there are no extra patterns, the expand button doesn't render —
        // that's fine; the collapsed invariant alone is the contract.
        const hasMore = (await expand.count()) > 0;
        if (hasMore) {
            await expect(expand).toHaveAttribute('aria-expanded', 'false');
            await expand.click();
            await expect(expand).toHaveAttribute('aria-expanded', 'true');
            const expandedCount = await feed.getByTestId('pattern-row').count();
            expect(expandedCount).toBeGreaterThanOrEqual(collapsedCount);
        }
    });
});
