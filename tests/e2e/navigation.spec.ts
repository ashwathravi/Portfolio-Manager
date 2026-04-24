import { test, expect } from '@playwright/test';

/**
 * Phase 9 (AR-94) sidebar navigation tests.
 *
 * The Phase 1 redesign flattened the sidebar — the expandable
 * Portfolio / Research / Strategies sub-menus are gone. The sidebar
 * now has a flat "Workspace" section (Dashboard, Performance,
 * Holdings, Research, Strategies, Execution) and a "System" section
 * (Settings). Page titles moved out of the body and into the Topbar.
 *
 *   - Assertions use the Topbar h1 (`.pm-topbar-title`) for the page
 *     title, which is the single source of truth post-redesign.
 *   - Sub-page navigation happens INSIDE each landing page (not via
 *     sidebar submenus), so those journeys belong in per-section specs.
 */

test.describe('Sidebar navigation', () => {
    test('navigates to all top-level routes from the flat sidebar', async ({ page }) => {
        await page.goto('/');

        const sidebar = page.locator('aside.pm-sidebar');
        await expect(sidebar).toBeVisible();

        // Dashboard (home) is active by default on '/'.
        await expect(sidebar.getByRole('link', { name: /^Dashboard$/ })).toBeVisible();

        // Performance
        await sidebar.getByRole('link', { name: /^Performance$/ }).click();
        await expect(page).toHaveURL(/\/performance$/);
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Performance');

        // Holdings (flat link — no longer behind a Portfolio sub-menu)
        await sidebar.getByRole('link', { name: /^Holdings$/ }).click();
        await expect(page).toHaveURL(/\/portfolios\/holdings$/);

        // Research (flat link)
        await sidebar.getByRole('link', { name: /^Research$/ }).click();
        await expect(page).toHaveURL(/\/research(\/|$)/);

        // Strategies (flat link)
        await sidebar.getByRole('link', { name: /^Strategies$/ }).click();
        await expect(page).toHaveURL(/\/strategies(\/|$)/);

        // Execution (flat link)
        await sidebar.getByRole('link', { name: /^Execution$/ }).click();
        await expect(page).toHaveURL(/\/execution(\/|$)/);

        // Settings (System section)
        await sidebar.getByRole('link', { name: /^Settings$/ }).click();
        await expect(page).toHaveURL(/\/settings$/);
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Settings');
    });

    test('exposes both Workspace and System section labels', async ({ page }) => {
        await page.goto('/');

        const sidebar = page.locator('aside.pm-sidebar');
        // Case-insensitive because the CSS applies text-transform:
        // uppercase; the DOM text stays as "Workspace" / "System".
        await expect(sidebar.locator('.pm-nav-label', { hasText: /^Workspace$/i })).toBeVisible();
        await expect(sidebar.locator('.pm-nav-label', { hasText: /^System$/i })).toBeVisible();
    });

    test('shows the user footer with identity + plan line', async ({ page }) => {
        await page.goto('/');

        // Default store fullName is "John Doe". The plan line shows
        // "Pro" while the portfolio count query is in-flight and
        // "Pro · N accounts" once it resolves.
        await expect(page.getByText('John Doe')).toBeVisible();
        await expect(page.locator('.pm-user-plan')).toContainText(/Pro/);
    });
});
