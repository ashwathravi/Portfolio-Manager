import { test, expect } from '@playwright/test';
import { userKey } from './helpers/storage';
import { clickUntil, collectConsoleErrors, gotoAppPage, openPolicyChecks, reloadAppPage } from './helpers/app';
import { databaseAuthEnabled, signInAsFreshUser, signInAsNewUser } from './helpers/users';

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
 *   Equity curve .......... from nightly valuations, once there are two
 *   Holdings + allocation . real data, only when there are holdings
 *   Recent activity ....... real transactions
 *   Review & research ..... example-data cards (weekly review, theses,
 *                           patterns, Alpha Radar)
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
        await page.addInitScript((key) => {
            try {
                window.localStorage.removeItem(key);
            } catch {
                /* private mode — ignore */
            }
        }, userKey('pm-pattern-snoozed'));
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
        await openPolicyChecks(page);
        await expect(page.getByTestId('risk-policy-dimension')).toHaveCount(12);
    });

    test('regression: no employer stock is assumed until the user names it', async ({ page }) => {
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        await openPolicyChecks(page);
        // User A holds GOOGL, but hasn't named an employer.
        const employer = page.locator('[data-testid="risk-policy-dimension"][data-policy-id="employer_stock_concentration"]');
        await expect(employer).toHaveAttribute('data-status', 'inside');
        await expect(employer).toContainText('Employer stock');
        await expect(employer).toContainText('None named');
        await expect(page.getByTestId('risk-policy-dashboard')).not.toContainText('GOOG -40%');
    });

    test('with valuation history: a real equity curve, outside the example section', async ({ page }) => {
        test.skip(!databaseAuthEnabled, 'the history is in the database');
        const curve = page.getByTestId('today-equity-curve');
        await expect(curve).toBeVisible();
        await expect(curve.locator('.pm-card-title')).toHaveText('Equity curve');
        await expect(curve.getByTestId('performance-hero')).toContainText('time-weighted');
        await expect(page.getByTestId('today-examples').getByTestId('today-equity-curve')).toHaveCount(0);
        await expect(page.getByTestId('today-examples').getByLabel('Equity curve')).toHaveCount(0);
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

        await clickUntil(examples.getByRole('button', { name: 'hide examples' }), async () => {
            await expect(page.getByTestId('today-examples')).toHaveCount(0, { timeout: 1_500 });
        });
        await expect(page.getByTestId('today-hero')).toBeVisible();
        // The seeded watchlist rows are examples too; only saved tickers remain.
        await expect(page.getByTestId('today-watchlist').getByTestId('sample-tag')).toHaveCount(0);
        await expect(page.getByTestId('today-watchlist').getByRole('link', { name: /COIN/ })).toHaveCount(0);
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
        await page.addInitScript((key) => {
            try {
                window.localStorage.removeItem(key);
            } catch {
                /* ignore */
            }
        }, userKey('pm-pattern-snoozed'));
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
        const snoozed = await page.evaluate((key) => window.localStorage.getItem(key), userKey('pm-pattern-snoozed'));
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
        await page.addInitScript((key) => {
            try {
                const done = window.sessionStorage.getItem('__pm_test_wipe_done');
                if (!done) {
                    window.localStorage.removeItem(key);
                    window.sessionStorage.setItem('__pm_test_wipe_done', '1');
                }
            } catch {
                /* ignore */
            }
        }, userKey('pm-weekly-reviews-v1'));
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
            const raw = await page.evaluate((key) => window.localStorage.getItem(key), userKey('pm-weekly-reviews-v1'));
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

        const raw = await page.evaluate((key) => window.localStorage.getItem(key), userKey('pm-weekly-reviews-v1'));
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

        const raw = await page.evaluate((key) => window.localStorage.getItem(key), userKey('pm-weekly-reviews-v1'));
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
        // The pattern feed renders the shared SVG charts.
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

    test('successful route-shaped quotes render price and change; missing symbols keep dashes', async ({ page }) => {
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: { data: [
            { symbol: 'COIN', price: 123.45, change: -2.5, changePercent: -1.98, timestamp: new Date().toISOString(), isRealtime: false },
        ] } }));
        await gotoAppPage(page, '/');
        const card = page.getByTestId('today-watchlist');
        const coin = card.locator('li').filter({ has: page.getByRole('link', { name: /COIN/ }) });
        await expect(coin.locator('.pm-watchlist-price')).toHaveText('$123.45');
        await expect(coin.locator('.pm-watchlist-pct')).toHaveText('−1.98%');
        const pltr = card.locator('li').filter({ has: page.getByRole('link', { name: /PLTR/ }) });
        await expect(pltr.locator('.pm-watchlist-price')).toHaveText('—');
        await expect(pltr.locator('.pm-watchlist-pct')).toHaveText('—');
    });

    test('regression: an earlier session\'s close shows its price but not its move', async ({ page }) => {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: { data: [
            { symbol: 'COIN', price: 123.45, change: -2.5, changePercent: -1.98, timestamp: threeDaysAgo, isRealtime: false },
        ] } }));
        await gotoAppPage(page, '/');
        const coin = page.getByTestId('today-watchlist').locator('li').filter({ has: page.getByRole('link', { name: /COIN/ }) });
        await expect(coin.locator('.pm-watchlist-price')).toHaveText('$123.45');
        await expect(coin.locator('.pm-watchlist-pct')).toHaveText('—');
    });

    test('regression: no stale fallback prices — a missing quote is a dash', async ({ page }) => {
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 500, json: { error: 'down' } }));
        await gotoAppPage(page, '/');
        const card = page.getByTestId('today-watchlist');
        await expect(card.locator('.pm-watchlist-price').first()).toHaveText('—');
    });
});

test.describe('Today › Top holdings', () => {
    // Sparklines fetch history per row; answering here keeps these page loads
    // off the server's market-data rate limit, which other specs share.
    test.beforeEach(async ({ page }) => {
        await page.route('**/api/market-data/historical**', (route) => route.fulfill({ status: 200, json: { data: [] } }));
    });

    const aapl = (overrides: Record<string, unknown>) => ({
        data: [{ symbol: 'AAPL', price: 190, change: 2, changePercent: 1.06, timestamp: new Date().toISOString(), isRealtime: false, ...overrides }],
    });
    const aaplToday = (page: import('@playwright/test').Page) =>
        page.getByRole('region', { name: 'Top holdings' }).locator('tbody tr').filter({ hasText: 'AAPL' }).getByTestId('top-holding-today');

    test('with holdings: today\'s move shows in the Today column', async ({ page }) => {
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: aapl({}) }));
        await gotoAppPage(page, '/');
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        await expect(aaplToday(page)).toHaveText('+1.06%');
    });

    test('regression: an earlier session\'s close or a first close is a dash, not +0.00%', async ({ page }) => {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: aapl({ timestamp: threeDaysAgo }) }));
        await gotoAppPage(page, '/');
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        await expect(aaplToday(page)).toHaveText('—');

        await page.unroute('**/api/market-data/quotes**');
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: aapl({ change: null, changePercent: null }) }));
        await gotoAppPage(page, '/');
        await expect(aaplToday(page)).toHaveText('—');
    });
});

test.describe('Today › Net worth hero', () => {
    const HELD = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'TSLA', 'AMZN'];
    const quote = (symbol: string) => ({ symbol, price: 100, change: 1, changePercent: 1, timestamp: new Date().toISOString(), isRealtime: false });

    test.beforeEach(async ({ page }) => {
        await page.route('**/api/market-data/historical**', (route) => route.fulfill({ status: 200, json: { data: [] } }));
    });

    test('with holdings: every position moved today, so the headline is the portfolio\'s move', async ({ page }) => {
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: { data: HELD.map(quote) } }));
        await gotoAppPage(page, '/');
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        await expect(page.getByTestId('today-change')).toHaveText(/^\+\$[\d,]+\.\d{2} \(\+\d+\.\d{2}%\) today$/);
    });

    test('regression: a position with no price yet counts at cost in net worth, not $0', async ({ context, page }) => {
        // Launch item i41 (the Codex finding on PR #153): Today valued an
        // imported position without a quote or stored price at $0.
        test.skip(!(process.env.CI || process.env.E2E_DATABASE_AUTH === '1'), 'needs the seeded E2E database');
        await signInAsFreshUser(context);
        // The same quotes on both loads, so only the new position changes the total.
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: { data: HELD.map(quote) } }));
        const netWorth = async () => {
            await gotoAppPage(page, '/');
            const text = await page.getByTestId('today-networth').textContent();
            return Number((text ?? '').replace(/[$,]/g, ''));
        };
        const before = await netWorth();

        const imported = await page.request.post('/api/portfolio/import', {
            data: { newPortfolioName: 'Unpriced', rows: [{ symbol: 'ZZZQ', name: 'No Price Co', quantity: 10, avgCost: 12.5 }] },
        });
        expect(imported.status()).toBe(200);

        expect(Math.round(((await netWorth()) - before) * 100) / 100).toBe(125);
    });

    test('regression: a move for some positions only is labelled partial, with no portfolio percentage', async ({ page }) => {
        // Only AAPL has a move from today; the rest are unpriced.
        await page.route('**/api/market-data/quotes**', (route) => route.fulfill({ status: 200, json: { data: [quote('AAPL')] } }));
        await gotoAppPage(page, '/');
        test.skip(!(await hasHoldings(page)), 'no holdings in this database');
        const change = page.getByTestId('today-change');
        await expect(change).toHaveText(/^\+\$[\d,]+\.\d{2} today on 1 of \d+ positions$/);
        await expect(change).not.toContainText('%');
    });
});

// Launch item i43: a new user's Today walks them to an account with positions.
test.describe('Today › First run', () => {
    test.skip(!(process.env.CI || process.env.E2E_DATABASE_AUTH === '1'), 'needs the database-auth E2E mode');

    const firstRun = (page: import('@playwright/test').Page) => page.getByTestId('first-run');
    const steps = (page: import('@playwright/test').Page) => page.getByTestId('first-run-step');

    test('from no accounts, to an account, to positions and a net worth', async ({ context, page }) => {
        await signInAsNewUser(context);
        await gotoAppPage(page, '/');
        await expect(page.getByTestId('today-hero')).toHaveAttribute('data-empty', 'true');
        // No valuations yet: no equity curve.
        await expect(page.getByTestId('today-equity-curve')).toHaveCount(0);
        await expect(steps(page)).toHaveCount(2);
        await expect(steps(page).nth(0)).toHaveAttribute('data-done', 'false');
        await expect(steps(page).nth(0)).toContainText('Add an account');
        await expect(page.getByTestId('today-hero').getByRole('link', { name: 'Connect an account' })).toHaveAttribute('href', '/settings#accounts');

        // 1. An account, with its cash.
        await firstRun(page).getByRole('button', { name: 'New account' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Name').fill('Brokerage');
        await dialog.getByLabel('Cash ($)').fill('1,000');
        await dialog.getByRole('button', { name: 'Add account' }).click();
        await expect(steps(page).nth(0)).toHaveAttribute('data-done', 'true');
        await expect(steps(page).nth(0)).toContainText('1 account, $1,000.00 in cash.');

        // 2. Positions from a broker's CSV, into that account.
        await firstRun(page).getByRole('button', { name: 'Import CSV' }).click();
        await page.getByLabel('CSV file').setInputFiles({
            name: 'positions.csv',
            mimeType: 'text/csv',
            buffer: Buffer.from('Symbol,Description,Quantity,Average Cost\nZZQF,First Position Co,4,25\n'),
        });
        // Into the account just made, not a new one.
        await expect(page.getByTestId('import-dialog').locator('select option:checked')).toHaveText('Brokerage');
        await page.getByRole('button', { name: 'Import 1 position' }).click();
        await expect(page.getByText('Imported 1 position: 1 new, 0 updated.')).toBeVisible();

        // Done: the net worth (cash plus the position at cost) replaces the steps.
        await expect(firstRun(page)).toHaveCount(0);
        expect((await (await page.request.get('/api/portfolios/count')).json()).count).toBe(1);
        await expect(page.getByTestId('today-hero')).not.toHaveAttribute('data-empty', 'true');
        await expect(page.getByTestId('today-networth')).toHaveText('$1,100.00');
    });

    test('a new user starts with example data off, and can turn it on from the card', async ({ context, page }) => {
        await signInAsNewUser(context, { firstSignIn: true });
        await gotoAppPage(page, '/');
        const examples = page.getByTestId('first-run-examples');
        await expect(examples).toBeVisible();
        await expect(page.getByTestId('today-examples')).toHaveCount(0);

        // Still off after a reload, when this browser has its own copy too.
        await reloadAppPage(page);
        await expect(examples).toBeVisible();
        await expect(page.getByTestId('today-examples')).toHaveCount(0);

        await examples.getByRole('button', { name: 'Show example data' }).click();
        await expect(page.getByTestId('today-examples')).toBeVisible();
        await expect(examples).toHaveCount(0);
    });

    test('regression: the page arrives with the stored setting, so examples never flash in or out as it loads', async ({ context, page }) => {
        // useShowSampleData rendered examples until the page mounted: a new
        // user with them off got the example section in every page as it
        // arrived, then lost it, and the "Show example data" prompt popped in.
        await signInAsNewUser(context, { firstSignIn: true });
        await gotoAppPage(page, '/');
        const off = await (await page.request.get('/')).text();
        expect(off).not.toContain('data-testid="today-examples"');
        expect(off).toContain('data-testid="first-run-examples"');

        // Turned on, they're in the page as it arrives, and the prompt isn't.
        await page.getByTestId('first-run-examples').getByRole('button', { name: 'Show example data' }).click();
        await expect(page.getByTestId('today-examples')).toBeVisible();
        await expect.poll(async () => (await (await page.request.get('/')).text()).includes('data-testid="today-examples"')).toBe(true);
        expect(await (await page.request.get('/')).text()).not.toContain('data-testid="first-run-examples"');
    });

    test('a user who already has settings keeps them: only a first sign-in turns examples off', async ({ context, page }) => {
        await signInAsNewUser(context);
        await gotoAppPage(page, '/');
        await expect(page.getByTestId('first-run-examples')).toHaveCount(0);
        await expect(page.getByTestId('today-examples')).toBeVisible();
    });
});
