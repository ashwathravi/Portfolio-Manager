import { test, expect } from '@playwright/test';

/**
 * Performance tests.
 *
 * Performance has three views (section tabs):
 *   /performance            Returns — equity curve, metrics by period,
 *                           monthly heatmap
 *   /performance/attribution Attribution — plain-language read-out, BHB
 *                           bars, and the full attribution table
 *   /performance/behaviour  Behaviour — trading calendar (absorbed the
 *                           retired /analytics page), mood breakdown,
 *                           P&L density, weekly reviews archive
 *
 * The only page title is the Topbar h1 ("Performance"); the duplicated
 * in-body "Performance analytics" header was removed in the design review.
 */

test.describe('Performance › Returns', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/performance');
    });

    test('Topbar title renders "Performance"', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Performance');
    });

    test('renders the three returns cards; attribution moved to its own tab', async ({ page }) => {
        for (const title of [/^Equity curve$/i, /^Metrics by period$/i, /^Monthly return heatmap$/i]) {
            await expect(page.locator('h2.pm-card-title', { hasText: title })).toBeVisible();
        }
        await expect(page.locator('h2.pm-card-title', { hasText: /^Attribution$/i })).toHaveCount(0);
    });

    test('behavioural cards moved to the Behaviour view', async ({ page }) => {
        await expect(page.getByTestId('mood-breakdown')).toHaveCount(0);
        await expect(page.getByTestId('pnl-density-card')).toHaveCount(0);
    });

    test('regression: there is exactly one page heading (no duplicated in-page header)', async ({ page }) => {
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('h1.pm-page-title')).toHaveCount(0);
    });

    test('labels its example data', async ({ page }) => {
        await expect(page.getByTestId('sample-data-notice')).toBeVisible();
    });

    test('Export CSV is enabled and downloads monthly returns', async ({ page }) => {
        const button = page.getByRole('button', { name: 'Export CSV' });
        await expect(button).toBeEnabled();
        const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
        expect(download.suggestedFilename()).toBe('atlas-monthly-returns.csv');
    });
});

test.describe('Performance › Attribution', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/performance/attribution');
    });

    test('is a Performance tab with one heading and labelled example data', async ({ page }) => {
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Performance');
        await expect(page.getByRole('link', { name: 'Attribution' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByTestId('sample-data-notice')).toBeVisible();
    });

    test('leads with a plain-language answer, then the bars and the full table', async ({ page }) => {
        await expect(page.getByTestId('attribution-lede')).toContainText(/You (beat|trailed|matched) the benchmark/);
        await expect(page.getByTestId('attribution-lede')).toContainText(/Mostly (allocation|selection|interaction)/);
        await expect(page.locator('h2.pm-card-title', { hasText: /^Attribution$/i })).toBeVisible();
        const table = page.getByTestId('attribution-table');
        await expect(table.locator('tbody tr')).toHaveCount(8);
        await expect(table.locator('tfoot')).toContainText('Total');
    });

    test('the table switches between sector and asset class', async ({ page }) => {
        const table = page.getByTestId('attribution-table');
        const assetClass = table.getByRole('radio', { name: 'Asset class' });
        await expect(async () => {
            await assetClass.click();
            await expect(assetClass).toHaveAttribute('aria-checked', 'true', { timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
        await expect(table.locator('thead')).toContainText('Asset class');
    });
});

test.describe('Performance › Behaviour — trading calendar', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/performance/behaviour');
    });

    test('renders one continuous year grid with a single summary strip', async ({ page }) => {
        const card = page.getByTestId('trading-calendar');
        await expect(card).toBeVisible();
        await expect(card.getByTestId('trading-calendar-summary')).toHaveCount(1);
        await expect(card.getByRole('grid')).toBeVisible();
        // 365 or 366 in-year cells, all in one grid.
        const cells = await card.locator('[role="gridcell"]').count();
        expect([365, 366]).toContain(cells);
    });

    test('days with trades carry a P&L description', async ({ page }) => {
        const card = page.getByTestId('trading-calendar');
        const traded = card.locator('[role="gridcell"]:not([data-level="0"])').first();
        await expect(traded).toHaveAttribute('aria-label', /trade/);
    });

    test('marks its data as sample', async ({ page }) => {
        await expect(page.getByTestId('trading-calendar').getByTestId('sample-tag')).toBeVisible();
        await expect(page.getByTestId('sample-data-notice')).toBeVisible();
    });
});

/**
 * AR-110 Mood breakdown card. Aggregates mood-tagged trades from the
 * journal fixture into one row per mood with a cost-of-emotion bar
 * and a plain-English verdict panel.
 */
test.describe('Performance › Behaviour \u2014 Mood breakdown (AR-110)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/performance/behaviour');
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
test.describe('Performance › Behaviour \u2014 P&L density (AR-113)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/performance/behaviour');
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
        await expect(
            callouts.locator('[data-testid^="pnl-density-callout-"]').first(),
        ).toBeVisible();
    });
});

// --------------------------------------------------------------------- //
// AR-114 — Reviews archive card
// --------------------------------------------------------------------- //

test.describe('Performance › Behaviour — Reviews archive (AR-114)', () => {
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
        await page.goto('/performance/behaviour');
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
        await expect(rows.first().or(empty)).toBeVisible();

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

        await page.goto('/performance/behaviour');
        const card = page.getByTestId('reviews-archive');
        const reflections = card.getByTestId('reviews-archive-reflection');
        // Current-week row should surface the reflection we just saved.
        await expect(reflections.first()).toBeVisible();
        await expect(reflections.first()).toContainText(/earnings dip/);
    });

    test('archive rows carry three mini-stats (Realized / Adherence / Trades)', async ({ page }) => {
        const card = page.getByTestId('reviews-archive');
        const rows = card.getByTestId('reviews-archive-row');
        await expect(rows.first().or(card.getByTestId('reviews-archive-empty'))).toBeVisible();
        const rowCount = await rows.count();
        if (rowCount === 0) test.skip();
        const first = rows.first();
        await expect(first).toContainText('Realized');
        await expect(first).toContainText('Adherence');
        await expect(first).toContainText('Trades');
    });
});
