import { test, expect } from '@playwright/test';

/**
 * Phase 9 (AR-94) Performance tests.
 *
 * Phase 4 (AR-75/76/77) replaced the legacy "Performance Analytics" h1
 * + random metric tiles with a Topbar-driven shell that renders the new
 * 4-card deep-dive:
 *
 *   - EquityCurveCard ........ h2 "Equity curve"
 *   - AttributionBarsCard .... h2 "Attribution"
 *   - MetricsByPeriodTable ... h2 "Metrics by period"
 *   - MonthlyHeatmapCard ..... h2 "Monthly return heatmap"
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

    test('renders the four deep-dive cards', async ({ page }) => {
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
