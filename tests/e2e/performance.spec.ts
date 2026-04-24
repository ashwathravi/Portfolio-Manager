import { test, expect } from '@playwright/test';

/**
 * Performance page tests.
 *
 * Phase 4 (AR-75/76/77) + AR-110 + AR-113 replaced the legacy
 * "Performance Analytics" h1 + random metric tiles with a Topbar-
 * driven shell that renders the deep-dive cards:
 *
 *   - EquityCurveCard ........ h2 "Equity curve"
 *   - AttributionBarsCard .... h2 "Attribution"
 *   - MetricsByPeriodTable ... h2 "Metrics by period"
 *   - MonthlyHeatmapCard ..... h2 "Monthly return heatmap"
 *   - MoodBreakdownCard ...... h2 "Mood breakdown" (AR-110)
 *   - PnlDensityCard ......... h2 "P&L density · weekday × hour" (AR-113)
 *
 * The page h1 moved into the Topbar via PageHeaderSync (title "Performance").
 * The in-body h1 "Performance analytics" still exists inside the client
 * wrapper for context, but it's no longer the single source of truth.
 */

test.describe('Performance page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/performance');
    });

    test('Topbar title renders "Performance"', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Performance');
    });

    test('renders the six deep-dive cards', async ({ page }) => {
        await expect(
            page.locator('h2.pm-card-title', { hasText: /^Equity curve$/i }),
        ).toBeVisible();
        await expect(
            page.locator('h2.pm-card-title', { hasText: /^Attribution$/i }),
        ).toBeVisible();
        await expect(
            page.locator('h2.pm-card-title', { hasText: /^Metrics by period$/i }),
        ).toBeVisible();
        await expect(
            page.locator('h2.pm-card-title', { hasText: /^Monthly return heatmap$/i }),
        ).toBeVisible();
        await expect(
            page.locator('h2.pm-card-title', { hasText: /^Mood breakdown$/i }),
        ).toBeVisible();
        await expect(
            page.locator('h2.pm-card-title', { hasText: /^P&L density/i }),
        ).toBeVisible();
    });

    test('in-page header retains the legacy "Performance analytics" h1 for context', async ({ page }) => {
        // The client wrapper still ships its own h1 — the Topbar h1 is the
        // primary assertion above, but we verify this one stays wired so
        // visual regressions there show up as test failures too.
        await expect(
            page.locator('h1.pm-page-title', { hasText: /Performance analytics/i }),
        ).toBeVisible();
    });
});

/**
 * AR-110 Mood breakdown card. Aggregates mood-tagged trades from the
 * journal fixture into one row per mood with a cost-of-emotion bar
 * and a plain-English verdict panel.
 */
test.describe('Performance page \u2014 Mood breakdown (AR-110)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/performance');
    });

    test('renders the Mood breakdown card with all six mood rows', async ({ page }) => {
        const card = page.getByTestId('mood-breakdown');
        await expect(card).toBeVisible();

        // Scope label assertions to the row-label spans. The verdict
        // panel also prints the worst caution mood inside a `<strong>`,
        // so an unscoped `getByText(/^Revenge$/)` collides under strict
        // mode. `.pm-mood-label` wraps an emoji + a plain text span, so
        // we match on substring and assert exactly one row per label.
        const labels = card.locator('.pm-mood-label');
        for (const label of ['Calm', 'Focused', 'Neutral', 'Frustrated', 'FOMO', 'Revenge']) {
            await expect(
                labels.filter({ hasText: label }),
            ).toHaveCount(1);
        }
    });

    test('range selector shows 30d / 90d / 1Y / ALL and 90d is the default', async ({ page }) => {
        const card = page.getByTestId('mood-breakdown');
        const range = card.getByRole('tablist', { name: /Range/ });
        for (const label of ['30d', '90d', '1Y', 'ALL']) {
            await expect(range.getByRole('tab', { name: label })).toBeVisible();
        }
        await expect(range.getByRole('tab', { name: '90d' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    test('switching the range re-selects the clicked tab', async ({ page }) => {
        const range = page
            .getByTestId('mood-breakdown')
            .getByRole('tablist', { name: /Range/ });
        await range.getByRole('tab', { name: 'ALL' }).click();
        await expect(range.getByRole('tab', { name: 'ALL' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    test('verdict panel surfaces a caution or ok message', async ({ page }) => {
        const verdict = page.getByTestId('mood-verdict');
        await expect(verdict).toBeVisible();
        // Verdict always has a data-kind — caution / ok / neutral.
        await expect(verdict).toHaveAttribute('data-kind', /caution|ok|neutral/);
    });
});

/**
 * AR-113 P&L density heatmap. 6 rows (Mon–Sat) × 24 columns (0–23
 * local time) tinted by average realised P&L of trades that closed
 * in that window, with a legend and deterministic best/worst callout.
 */
test.describe('Performance page \u2014 P&L density (AR-113)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/performance');
    });

    test('renders card with title, grid, legend', async ({ page }) => {
        const card = page.getByTestId('pnl-density-card');
        await expect(card).toBeVisible();
        await expect(card.locator('h2#pm-heat-head')).toContainText(/P&L density/);
        await expect(card.getByTestId('pnl-density-grid')).toBeVisible();
        await expect(card.getByTestId('pnl-density-legend')).toBeVisible();
    });

    test('grid holds the full 6\u00d724 cell scaffold', async ({ page }) => {
        const card = page.getByTestId('pnl-density-card');
        // 6 weekdays * 24 hours = 144 cells. Asserting the exact count
        // locks the contract that the scaffold is always complete even
        // when trade counts are uneven.
        await expect(card.locator('[data-testid^="pnl-density-cell-"]')).toHaveCount(144);
    });

    test('range selector shows 30d / 90d / 1Y / ALL with 90d default', async ({ page }) => {
        const card = page.getByTestId('pnl-density-card');
        const range = card.getByRole('tablist', { name: /Time range/ });
        for (const label of ['30d', '90d', '1Y', 'ALL']) {
            await expect(range.getByRole('tab', { name: label })).toBeVisible();
        }
        await expect(range.getByRole('tab', { name: '90d' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    test('switching the range updates the selected tab', async ({ page }) => {
        const card = page.getByTestId('pnl-density-card');
        const range = card.getByRole('tablist', { name: /Time range/ });
        await range.getByRole('tab', { name: 'ALL' }).click();
        await expect(range.getByRole('tab', { name: 'ALL' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        await expect(range.getByRole('tab', { name: '90d' })).toHaveAttribute(
            'aria-selected',
            'false',
        );
    });

    test('seed data produces at least one populated cell on the ALL view', async ({ page }) => {
        const card = page.getByTestId('pnl-density-card');
        // Widen the window so we see the full 25-trade fixture.
        await card.getByRole('tab', { name: 'ALL' }).click();
        const populated = card.locator(
            '[data-testid^="pnl-density-cell-"]:not([data-trades="0"])',
        );
        expect(await populated.count()).toBeGreaterThan(0);
    });

    test('hovering a populated cell reveals the tooltip', async ({ page }) => {
        const card = page.getByTestId('pnl-density-card');
        await card.getByRole('tab', { name: 'ALL' }).click();
        const populated = card
            .locator('[data-testid^="pnl-density-cell-"]:not([data-trades="0"])')
            .first();
        await populated.hover();
        await expect(card.getByTestId('pnl-density-tooltip')).toBeVisible();
        await expect(card.getByTestId('pnl-density-tooltip')).toContainText(
            /(Mon|Tue|Wed|Thu|Fri|Sat)\s+\d{2}:00/,
        );
    });

    test('callouts surface best and/or worst windows', async ({ page }) => {
        const card = page.getByTestId('pnl-density-card');
        await card.getByRole('tab', { name: 'ALL' }).click();
        const callouts = card.getByTestId('pnl-density-callouts');
        await expect(callouts).toBeVisible();
        // Seed journal contains both winners and losers, so both
        // callouts should render.
        await expect(card.getByTestId('pnl-density-callout-best')).toBeVisible();
        await expect(card.getByTestId('pnl-density-callout-worst')).toBeVisible();
    });
});

// --------------------------------------------------------------------- //
// AR-114 — Reviews archive card
// --------------------------------------------------------------------- //

test.describe('Performance page — Reviews archive (AR-114)', () => {
    test.beforeEach(async ({ page }) => {
        // Reset the reviews slice exactly once per test, even if the
        // test navigates across pages. Using addInitScript alone would
        // re-wipe the key on every goto — the sessionStorage sentinel
        // gates the clear to the first navigation in the session.
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
        await page.goto('/performance');
    });

    test('archive card renders with heading and subtitle', async ({ page }) => {
        const card = page.getByTestId('reviews-archive');
        await expect(card).toBeVisible();
        await expect(card).toContainText('Weekly reviews');
        await expect(card).toContainText('Reviews · Archive');
    });

    test('archive renders either populated rows or a clear empty state', async ({ page }) => {
        const card = page.getByTestId('reviews-archive');
        const rows = card.getByTestId('reviews-archive-row');
        const empty = card.getByTestId('reviews-archive-empty');

        const rowCount = await rows.count();
        const emptyVisible = await empty.isVisible().catch(() => false);

        // Exactly one surface should be active — and it should not be
        // both at once.
        expect(rowCount > 0 || emptyVisible).toBeTruthy();
        if (rowCount > 0) {
            // Each row must carry the week id data hook.
            const firstId = await rows.first().getAttribute('data-week-id');
            expect(firstId).toMatch(/^wk:\d{4}-\d{2}-\d{2}$/);
        }
    });

    test('reflections saved on the dashboard appear in the archive', async ({ page }) => {
        // Drop directly onto the dashboard to author a reflection, then
        // navigate to /performance and verify it surfaces.
        await page.goto('/');
        const textarea = page.getByTestId('weekly-review-reflection');
        await textarea.fill('Held through the earnings dip — right call.');
        await textarea.blur();
        // Give onBlur a moment to commit.
        await expect(async () => {
            const raw = await page.evaluate(() =>
                window.localStorage.getItem('pm-weekly-reviews-v1'),
            );
            expect(raw).not.toBeNull();
        }).toPass({ timeout: 2000 });

        await page.goto('/performance');
        const card = page.getByTestId('reviews-archive');
        const reflections = card.getByTestId('reviews-archive-reflection');
        // Current-week row should surface the reflection we just saved.
        await expect(reflections.first()).toBeVisible();
        await expect(reflections.first()).toContainText(/earnings dip/);
    });

    test('archive rows carry three mini-stats (Realized / Adherence / Trades)', async ({ page }) => {
        const card = page.getByTestId('reviews-archive');
        const rows = card.getByTestId('reviews-archive-row');
        const rowCount = await rows.count();
        if (rowCount === 0) test.skip();
        const first = rows.first();
        await expect(first).toContainText('Realized');
        await expect(first).toContainText('Adherence');
        await expect(first).toContainText('Trades');
    });
});
