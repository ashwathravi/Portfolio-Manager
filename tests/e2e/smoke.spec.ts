
import { test, expect } from '@playwright/test';

test('homepage has title and critical elements', async ({ page }) => {
    await page.goto('/');

    // Expect a title "to contain" a substring.
    await expect(page).toHaveTitle(/Atlas Wealth|Portfolio Manager/);

    // Check for main heading (Greeting)
    await expect(page.locator('h2', { hasText: 'Good' })).toBeVisible();

    // Check for sidebar navigation
    await expect(page.locator('nav')).toBeVisible();
    await expect(page.getByText('Atlas Wealth')).toBeVisible();
});
