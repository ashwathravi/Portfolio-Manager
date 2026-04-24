import { test, expect } from '@playwright/test';

/**
 * Phase 9 (AR-94) Settings tests, refreshed for JournalPlus (AR-109).
 *
 * Phase 8 (AR-87/88/89) replaced the old horizontal-tabs surface with
 * a card grid. AR-109 added a fifth card — Execution — to host the
 * "Require pre-trade rationale" toggle. The default `/settings` now
 * renders `SettingsPageClient` with ProfileCard, IntegrationsCard,
 * AppearanceCard, GuardrailsCard, and ExecutionCard plus an "Advanced
 * settings" section linking to the legacy tabbed surface at
 * `/settings?tab=<slug>`. Those legacy flows remain reachable so
 * notifications, API keys, data & privacy, and tags can still be
 * managed until they get their own cards.
 */

test.describe('Settings page (v2 card grid)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/settings');
    });

    test('renders Topbar title and the primary cards', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Settings');

        // Grid container (single `role="list"`-like semantics).
        await expect(page.locator('.pm-settings-grid')).toBeVisible();

        // Each primary card by its card title.
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Profile$/ })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Connected accounts$/i })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Appearance$/ })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Guardrails$/ })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Execution$/ })).toBeVisible();
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

    test('Execution card exposes the AR-110 mood cooldown picker with 10s selected', async ({ page }) => {
        const group = page.getByRole('radiogroup', {
            name: /Mood cooldown duration/,
        });
        await expect(group).toBeVisible();

        for (const label of ['Off', '10s', '30s', '60s']) {
            await expect(group.getByRole('radio', { name: label })).toBeVisible();
        }
        await expect(group.getByRole('radio', { name: '10s' })).toHaveAttribute(
            'aria-checked',
            'true',
        );
    });

    test('clicking a cooldown option updates the aria-checked state', async ({ page }) => {
        const group = page.getByRole('radiogroup', {
            name: /Mood cooldown duration/,
        });
        await group.getByRole('radio', { name: '30s' }).click();
        await expect(group.getByRole('radio', { name: '30s' })).toHaveAttribute(
            'aria-checked',
            'true',
        );
        await expect(group.getByRole('radio', { name: '10s' })).toHaveAttribute(
            'aria-checked',
            'false',
        );
    });
});
