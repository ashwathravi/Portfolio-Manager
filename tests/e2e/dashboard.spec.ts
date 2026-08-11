import { test, expect } from '@playwright/test';
import { clickUntil, gotoAppPage, reloadAppPage } from './helpers/app';

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
        await gotoAppPage(page, '/');
    });

    test('Topbar title renders "Dashboard"', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Dashboard');
    });

    test('dashboard renders its empty state when persistence is unavailable', async ({ page }) => {
        const main = page.getByRole('main');

        await expect(main).not.toContainText('Something went wrong');
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Dashboard');
        await expect(page.getByTestId('risk-policy-dashboard')).toBeVisible();
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

    test('Risk Policy dashboard renders policy dimensions, statuses, and deep links', async ({ page }) => {
        const card = page.getByTestId('risk-policy-dashboard');
        await expect(card).toBeVisible();
        await expect(card.locator('#pm-risk-policy-head')).toHaveText('Portfolio risk policy');
        await expect(card.getByRole('heading', { name: 'GOOG / employer-linked stock' })).toBeVisible();
        await expect(card.getByRole('heading', { name: 'Cash purpose coverage' })).toBeVisible();

        const dimensions = card.getByTestId('risk-policy-dimension');
        await expect(dimensions).toHaveCount(12);
        await expect(
            card.locator('[data-testid="risk-policy-dimension"][data-status="breached"], [data-testid="risk-policy-dimension"][data-status="missing_data"]').first(),
        ).toBeVisible();

        await expect(card.getByTestId('risk-policy-action').first()).toBeVisible();
        await expect(card.getByRole('link', { name: /Holdings/ })).toHaveAttribute('href', '/portfolios/holdings');
        await expect(card.getByRole('link', { name: /Execution/ })).toHaveAttribute('href', '/execution');
        await expect(card.getByRole('link', { name: /Research theses/ })).toHaveAttribute('href', '/research');
        await expect(card.getByRole('link', { name: /Guardrails/ })).toHaveAttribute('href', '/settings');
        await expect(card.getByRole('link', { name: /Weekly review/ })).toHaveAttribute('href', '/#weekly-review');
    });

    test('Risk Policy dashboard runs built-in stress scenarios', async ({ page }) => {
        const panel = page.getByTestId('stress-test-panel');
        await expect(panel).toBeVisible();
        await expect(panel.getByLabel('Stress-test scenario')).toBeVisible();

        await panel.getByLabel('Stress-test scenario').selectOption('ai_basket_30_down');
        await expect(panel).toContainText('AI basket -30%');
        await expect(panel).toContainText('Portfolio drawdown');
        await expect(panel).toContainText(/-\$|0%|-/);
        await expect(panel.getByRole('list', { name: 'Stress test top contributors' })).toBeVisible();
    });

    test('63/37 split renders Top Holdings + Recent Activity cards', async ({ page }) => {
        await expect(
            page.locator('.pm-card-title', { hasText: /^Top Holdings$/ }),
        ).toBeVisible();
        await expect(
            page.locator('.pm-card-title', { hasText: /^Recent Activity$/ }),
        ).toBeVisible();
    });

    test('bottom strip shows Pattern feed alongside Alpha Radar + Watchlist + Active Theses', async ({ page }) => {
        await expect(page.getByTestId('pattern-feed')).toBeVisible();
        await expect(page.getByTestId('alpha-radar-dashboard-card')).toBeVisible();
        await expect(
            page.locator('.pm-card-title', { hasText: /^Watchlist$/ }),
        ).toBeVisible();
        await expect(
            page.locator('.pm-card-title', { hasText: /^Active Theses$/ }),
        ).toBeVisible();
    });

    test('Alpha Radar card shows latest reports and links into Research', async ({ page }) => {
        const card = page.getByTestId('alpha-radar-dashboard-card');
        await expect(card).toBeVisible();
        await expect(card.getByTestId('alpha-radar-dashboard-row').first()).toBeVisible();
        await expect(card.getByRole('link', { name: /Open/ })).toHaveAttribute('href', '/research?tab=alpha-radar');
    });

    test('Alpha Radar dashboard refresh exposes pending state', async ({ page }) => {
        await page.route('**/api/alpha-radar/refresh', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        scope: 'all',
                        startedAt: new Date().toISOString(),
                        completedAt: new Date().toISOString(),
                        totalFilers: 0,
                        fetched: 0,
                        skipped: 0,
                        parsed: 0,
                        changed: 0,
                        memoGenerated: 0,
                        filers: [],
                        errors: [],
                    },
                }),
            });
        });

        const refresh = page.getByTestId('alpha-radar-dashboard-refresh');
        await expect(refresh).toBeEnabled();
        await clickUntil(refresh, async () => {
            await expect(refresh).toContainText('Refreshing', { timeout: 1500 });
        });
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
        await gotoAppPage(page, '/');
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

// --------------------------------------------------------------------- //
// AR-114 — Weekly review ritual
// --------------------------------------------------------------------- //

test.describe('Weekly review ritual (AR-114)', () => {
    test.beforeEach(async ({ page }) => {
        // Wipe the reviews slice exactly once per test. A naive
        // addInitScript would also fire on every reload — sessionStorage
        // sentinels gate the wipe to the first navigation.
        await page.addInitScript(() => {
            try {
                const done = window.sessionStorage.getItem('__pm_test_wipe_done');
                if (!done) {
                    window.localStorage.removeItem('pm-weekly-reviews-v1');
                    window.sessionStorage.setItem('__pm_test_wipe_done', '1');
                }
            } catch {
                /* ignore */
            }
        });
        await gotoAppPage(page, '/');
    });

    test('card renders with eyebrow, week range, and three stat tiles', async ({ page }) => {
        const card = page.getByTestId('weekly-review-card');
        await expect(card).toBeVisible();
        await expect(card).toContainText('Weekly review');
        await expect(card).toContainText(/Week of \w{3}/);
        await expect(card.getByTestId('weekly-review-pnl')).toBeVisible();
        await expect(card.getByTestId('weekly-review-adherence')).toBeVisible();
        await expect(card.getByTestId('weekly-review-best')).toBeVisible();
    });

    test('reflection textarea saves to localStorage on blur', async ({ page }) => {
        const textarea = page.getByTestId('weekly-review-reflection');
        await expect(textarea).toBeVisible();
        await textarea.fill('I cut winners too early this week.');
        await textarea.blur();

        // Trip a tick for the onBlur handler, then read the key back.
        await expect(async () => {
            const raw = await page.evaluate(() =>
                window.localStorage.getItem('pm-weekly-reviews-v1'),
            );
            expect(raw).not.toBeNull();
            const parsed = JSON.parse(raw!);
            const firstEntry = Object.values(parsed)[0] as { reflection?: string };
            expect(firstEntry?.reflection).toContain('cut winners too early');
        }).toPass({ timeout: 2000 });
    });

    test('Done button acknowledges the review and hides the card', async ({ page }) => {
        const card = page.getByTestId('weekly-review-card');
        await expect(card).toBeVisible();
        await page.getByTestId('weekly-review-acknowledge').click();
        await expect(card).toBeHidden();

        const raw = await page.evaluate(() =>
            window.localStorage.getItem('pm-weekly-reviews-v1'),
        );
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!);
        const firstEntry = Object.values(parsed)[0] as { acknowledgedAt?: string };
        expect(firstEntry?.acknowledgedAt).toBeDefined();
    });

    test('Remind-me-later snoozes the card for 24 hours', async ({ page }) => {
        const card = page.getByTestId('weekly-review-card');
        await expect(card).toBeVisible();
        await page.getByTestId('weekly-review-remind').click();
        await expect(card).toBeHidden();

        const raw = await page.evaluate(() =>
            window.localStorage.getItem('pm-weekly-reviews-v1'),
        );
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!);
        const firstEntry = Object.values(parsed)[0] as { remindAt?: string };
        expect(firstEntry?.remindAt).toBeDefined();
        // remindAt must be in the future, roughly 24h out.
        const ts = Date.parse(firstEntry!.remindAt!);
        const deltaHours = (ts - Date.now()) / (60 * 60 * 1000);
        expect(deltaHours).toBeGreaterThan(23);
        expect(deltaHours).toBeLessThan(25);
    });

    test('card stays hidden on reload after acknowledgement', async ({ page }) => {
        await page.getByTestId('weekly-review-acknowledge').click();
        await expect(page.getByTestId('weekly-review-card')).toBeHidden();
        await reloadAppPage(page);
        await expect(page.getByTestId('weekly-review-card')).toBeHidden();
    });
});
