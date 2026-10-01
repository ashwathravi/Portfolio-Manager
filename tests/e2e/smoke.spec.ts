import { test, expect } from '@playwright/test';

/**
 * Phase 9 (AR-94) smoke test.
 *
 * The Phase 3–8 redesign moved the page title out of the body and into
 * the Topbar (<h1 className="pm-topbar-title">), so the old
 * `h2:has-text("Good morning")` assertion is gone. We now assert on:
 *   1. Document title (unchanged)
 *   2. Topbar h1 with the dashboard title
 *   3. Sidebar brand block + primary nav visible
 */
test('homepage has title, topbar heading, and sidebar chrome', async ({ page }) => {
    await page.goto('/');

    // Document title.
    await expect(page).toHaveTitle(/Atlas Wealth|Portfolio Manager/);

    // Post-redesign page title lives in the Topbar, not the body.
    await expect(page.locator('h1.pm-topbar-title')).toHaveText('Today');

    // Sidebar chrome: aside + brand wordmark.
    await expect(page.locator('aside.pm-sidebar')).toBeVisible();
    await expect(page.locator('.pm-sidebar-title', { hasText: 'Atlas Wealth' })).toBeVisible();
});

test('regression: the app font is loaded (IBM Plex), not a silent system fallback', async ({ page }) => {
    await page.goto('/');
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(family).toMatch(/IBM Plex Sans/i);
    await page.evaluate(() => document.fonts.ready);
    const loaded = await page.evaluate(() => [...document.fonts].some((f) => /IBM Plex Sans/i.test(f.family) && f.status === 'loaded'));
    expect(loaded).toBe(true);
});
