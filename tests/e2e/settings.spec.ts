import { test, expect } from '@playwright/test';

/**
 * Phase 9 (AR-94) Settings tests.
 *
 * Phase 8 (AR-87/88/89) replaced the old horizontal-tabs surface with
 * a 2×2 card grid. The default `/settings` now renders
 * `SettingsPageClient` — a grid of ProfileCard, IntegrationsCard,
 * AppearanceCard, and GuardrailsCard plus an "Advanced settings"
 * section linking to the legacy tabbed surface at
 * `/settings?tab=<slug>`. Those legacy flows remain reachable so
 * notifications, API keys, data & privacy, and tags can still be
 * managed until they get their own cards.
 */

test.describe('Settings page (v2 4-card grid)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/settings');
    });

    test('renders Topbar title and the 4 primary cards', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Settings');

        // Grid container (single `role="list"`-like semantics).
        await expect(page.locator('.pm-settings-grid')).toBeVisible();

        // Each of the 4 cards by their card title.
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Profile$/ })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Connected accounts$/i })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Appearance$/ })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Guardrails$/ })).toBeVisible();
    });

    test('exposes an Advanced settings section linking to legacy tabs', async ({ page }) => {
        // Section landmark uses the aria-labelledby heading.
        await expect(page.locator('h2#pm-settings-advanced-head')).toHaveText('Advanced settings');

        // Each advanced link should link out to /settings?tab=<slug>.
        const advanced = page.locator('.pm-settings-advanced-grid');
        await expect(advanced.locator('a[href="/settings?tab=notifications"]')).toBeVisible();
        await expect(advanced.locator('a[href="/settings?tab=alerts"]')).toBeVisible();
        await expect(advanced.locator('a[href="/settings?tab=api-keys"]')).toBeVisible();
        await expect(advanced.locator('a[href="/settings?tab=security"]')).toBeVisible();
        await expect(advanced.locator('a[href="/settings?tab=data"]')).toBeVisible();
        await expect(advanced.locator('a[href="/settings?tab=tags"]')).toBeVisible();
    });

    test('deep-links via ?tab=notifications render the legacy tabbed surface', async ({ page }) => {
        await page.goto('/settings?tab=notifications');

        // Legacy header is preserved with its own h2 at the top of the page.
        await expect(page.locator('h2', { hasText: 'Advanced settings' })).toBeVisible();

        // The tab UI is still there — the Notifications tab becomes the
        // active one when `?tab=notifications` is in the URL.
        await expect(page.getByRole('tab', { name: /Notifications/ })).toBeVisible();
        await expect(page.getByText('Portfolio Updates').first()).toBeVisible();
    });

    test('deep-links via ?tab=tags show the tags manager content', async ({ page }) => {
        await page.goto('/settings?tab=tags');

        await expect(page.getByRole('tab', { name: /Tags/ })).toBeVisible();
        // Default tags from the store.
        await expect(page.getByText('Growth').first()).toBeVisible();
        await expect(page.getByText('Dividend').first()).toBeVisible();
        await expect(page.getByText('Speculative').first()).toBeVisible();
    });

    test('deep-links via ?tab=appearance expose theme controls', async ({ page }) => {
        await page.goto('/settings?tab=appearance');

        // AppearanceSettings card renders inside the legacy surface too.
        await expect(page.getByText('Theme').first()).toBeVisible();
        // Theme radio tiles (Light / Dim / Dark / Auto).
        await expect(page.getByLabel('Light', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Dark', { exact: true })).toBeVisible();
    });
});
