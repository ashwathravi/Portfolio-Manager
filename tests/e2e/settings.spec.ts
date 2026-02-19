import { test, expect } from '@playwright/test';

test.describe('Settings page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/settings');
    });

    test('should render page heading and description', async ({ page }) => {
        await expect(page.locator('h2', { hasText: 'Settings' })).toBeVisible();
        await expect(page.getByText('Manage your account preferences and application settings')).toBeVisible();
    });

    test('should display all settings tabs', async ({ page }) => {
        await expect(page.getByRole('tab', { name: 'Profile' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Notifications' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Security' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Data & Privacy' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Appearance' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Accounts' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Tags' })).toBeVisible();
    });

    test('should show Profile tab content by default', async ({ page }) => {
        // Profile is the default tab - should show profile form fields
        await expect(page.getByText('Full Name').first()).toBeVisible();
    });

    test('should switch to Notifications tab', async ({ page }) => {
        await page.getByRole('tab', { name: 'Notifications' }).click();

        // Should show notification preferences
        await expect(page.getByText('Portfolio Updates').first()).toBeVisible();
    });

    test('should switch to Security tab', async ({ page }) => {
        await page.getByRole('tab', { name: 'Security' }).click();

        // Should show security settings
        await expect(page.getByText('Two-Factor Authentication').first()).toBeVisible();
    });

    test('should switch to Appearance tab', async ({ page }) => {
        await page.getByRole('tab', { name: 'Appearance' }).click();

        // Should show theme/appearance options
        await expect(page.getByText('Theme').first()).toBeVisible();
    });

    test('should switch to Tags tab', async ({ page }) => {
        await page.getByRole('tab', { name: 'Tags' }).click();

        // Should show default tags from the store
        await expect(page.getByText('Growth').first()).toBeVisible();
        await expect(page.getByText('Dividend').first()).toBeVisible();
        await expect(page.getByText('Speculative').first()).toBeVisible();
    });

    test('should switch to Accounts tab', async ({ page }) => {
        await page.getByRole('tab', { name: 'Accounts' }).click();

        // Should show connected accounts
        await expect(page.getByText('Fidelity').first()).toBeVisible();
    });

    test('should switch to Data & Privacy tab', async ({ page }) => {
        await page.getByRole('tab', { name: 'Data & Privacy' }).click();

        // Should show data management options
        await expect(page.getByText('Export').first()).toBeVisible();
    });
});
