import { test, expect } from '@playwright/test';

/**
 * Performance page tests.
 *
 * Phase 4 (AR-75/76/77) replaced the legacy "Performance Analytics" h1
 * + random metric tiles with a Topbar-driven shell that renders the
 * deep-dive cards:
 *
 *   - EquityCurveCard ........ h2 "Equity curve"
 *   - AttributionBarsCard .... h2 "Attribution"
 *   - MetricsByPeriodTable ... h2 "Metrics by period"
 *   - MonthlyHeatmapCard ..... h2 "Monthly return heatmap"
 *   - MoodBreakdownCard ...... h2 "Mood breakdown" (AR-110)
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

    test('renders the five deep-dive cards', async ({ page }) => {
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
