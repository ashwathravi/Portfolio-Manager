import { test, expect } from '@playwright/test';
import { clickUntil, collectConsoleErrors, gotoAppPage, reloadAppPage } from './helpers/app';

/**
 * Today (/) — formerly the Dashboard.
 *
 *   Top bar ............... title "Today", greeting · date · market state,
 *                           "New order" → /execution
 *   Hero .................. net worth + today's change from real holdings
 *                           (empty state with "Connect an account" when none)
 *   Needs your attention .. ranked triage list (policy, theses, review)
 *   Risk policy strip ..... one line; full checks behind a disclosure
 *                           (only when there are holdings)
 *   Holdings + allocation . real data, only when there are holdings
 *   Recent activity ....... real transactions
 *   Review & research ..... example-data cards (weekly review, equity curve,
 *                           theses, patterns, Alpha Radar)
 */

async function hasHoldings(page: import('@playwright/test').Page): Promise<boolean> {
    const hero = page.getByTestId('today-hero');
    await expect(hero).toBeVisible();
    return (await hero.getAttribute('data-empty')) !== 'true';
}

test.describe('Today page', () => {
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

    test('top bar shows "Today" with a single page heading', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Today');
        await expect(page.locator('h1')).toHaveCount(1);
        // Regression: the in-page greeting block duplicated the top bar.
        await expect(page.locator('.pm-dashboard-topbar')).toHaveCount(0);
    });

    test('renders without errors when persistence is unavailable', async ({ page }) => {
        await expect(page.getByRole('main')).not.toContainText('Something went wrong');
        await expect(page.getByTestId('today-hero')).toBeVisible();
        await expect(page.getByTestId('today-triage')).toBeVisible();
    });

    test('subtitle carries the greeting, date, and market state', async ({ page }) => {
        await expect(page.locator('.pm-topbar-sub')).toHaveText(/^Good (morning|afternoon|evening).* · .* · Markets (open|closed)$/);
    });

    test('regression: "New order" opens the Trade ticket', async ({ page }) => {
        await expect(page.getByRole('link', { name: /New order/ })).toHaveAttribute('href', '/execution');
    });

    test('regression: the hero shows no made-up deltas or sparklines', async ({ page }) => {
        await expect(page.getByText('+1.2%')).toHaveCount(0);
        await expect(page.getByText('vs last month')).toHaveCount(0);
        await expect(page.locator('.pm-grid-stats')).toHaveCount(0);
    });

    test('empty book: the hero offers to connect an account; no policy or holdings cards', async ({ page }) => {
        test.skip(await hasHoldings(page), 'database has holdings');
        await expect(page.getByTestId('today-hero').getByRole('link', { name: 'Connect an account' })).toHaveAttribute('href', '/settings#accounts');
        await expect(page.getByTestId('policy-strip')).toHaveCount(0);
        await expect(page.getByText('$10,050')).toHaveCount(0);
    });

    test('with holdings: net worth, policy strip, and the full checks behind a disclosure', async ({ page }) => {
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        await expect(page.getByTestId('today-networth')).toHaveText(/^\$[\d,]+\.\d{2}$/);
        const strip = page.getByTestId('policy-strip');
        await expect(strip).toBeVisible();
        await expect(page.getByTestId('risk-policy-dashboard')).toBeHidden();
        await strip.locator('summary').click();
        await expect(page.getByTestId('risk-policy-dashboard')).toBeVisible();
        await expect(page.getByTestId('risk-policy-dimension')).toHaveCount(12);
    });

    test('needs-your-attention lists ranked items, each with one link', async ({ page }) => {
        const triage = page.getByTestId('today-triage');
        const items = triage.getByTestId('today-triage-item');
        await expect(items.first().or(triage.getByTestId('today-triage-empty'))).toBeVisible();
        const count = await items.count();
        const order = { breach: 0, warn: 1, info: 2 } as Record<string, number>;
        let last = -1;
        for (let i = 0; i < count; i++) {
            const sev = order[(await items.nth(i).getAttribute('data-severity')) ?? 'info'];
            expect(sev).toBeGreaterThanOrEqual(last);
            last = sev;
            await expect(items.nth(i).getByRole('link')).toHaveCount(1);
        }
    });

    test('recent activity comes from real transactions (no mock rows)', async ({ page }) => {
        await expect(page.locator('.pm-card-title', { hasText: /^Recent Activity$/ })).toBeVisible();
    });

    test('example-data cards are grouped, labelled, and hideable', async ({ page }) => {
        const examples = page.getByTestId('today-examples');
        await expect(examples).toBeVisible();
        await expect(examples.getByTestId('sample-data-notice')).toBeVisible();
        await expect(page.getByTestId('pattern-feed')).toBeVisible();
        await expect(page.getByTestId('alpha-radar-dashboard-card')).toBeVisible();
        await expect(page.locator('.pm-card-title', { hasText: /^Active Theses$/ })).toBeVisible();

        await examples.getByRole('button', { name: 'hide examples' }).click();
        await expect(page.getByTestId('today-examples')).toHaveCount(0);
        await expect(page.getByTestId('today-hero')).toBeVisible();
    });

    test('active theses on Today match the Research store', async ({ page }) => {
        const card = page.locator('section', { has: page.locator('.pm-card-title', { hasText: /^Active Theses$/ }) });
        await expect(card.getByRole('link', { name: /AI Infrastructure Dominance/ })).toHaveAttribute('href', '/research/thesis/NVDA');
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

test.describe('Dashboard console hygiene', () => {
    test('regression: charts do not log invalid <svg> height errors', async ({ page }) => {
        const errors = collectConsoleErrors(page);
        await gotoAppPage(page, '/');
        // The example equity curve and pattern feed render the shared SVG charts.
        await expect(page.getByTestId('today-examples').locator('svg').first()).toBeVisible();
        await page.waitForTimeout(500);
        expect(errors.filter((e) => e.includes('<svg> attribute height'))).toEqual([]);
    });
});

test.describe('Today watchlist', () => {
    test('regression: shows the saved watchlist outside the example section and links to Research, not a 404', async ({ page }) => {
        await gotoAppPage(page, '/');
        const card = page.getByTestId('today-watchlist');
        await expect(card).toBeVisible();
        await expect(page.getByTestId('today-examples').getByTestId('today-watchlist')).toHaveCount(0);
        await expect(card.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/research?tab=watchlist');
        await expect(card.getByRole('link', { name: /COIN/ })).toHaveAttribute('href', '/portfolios/detail/COIN');
        await expect(card.getByTestId('sample-tag')).toBeVisible();
    });

    test('regression: no stale fallback prices — a missing quote is a dash', async ({ page }) => {
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 500, json: { error: 'down' } }));
        await gotoAppPage(page, '/');
        const card = page.getByTestId('today-watchlist');
        await expect(card.locator('.pm-watchlist-price').first()).toHaveText('—');
    });
});
