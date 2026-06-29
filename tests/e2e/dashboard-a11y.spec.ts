import { test, expect } from '@playwright/test';

test.describe('Dashboard A11y', () => {
    test('market status chips should use semantic list structure', async ({ page }) => {
        await page.goto('/');

        const list = page.getByRole('list', { name: 'Market Status' });
        await expect(list).toBeVisible();

        const items = list.getByRole('listitem');
        await expect(items).toHaveCount(3);
    });

    test('market status ping animation should respect reduced motion', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/');

        const dot = page.locator('.pm-live-dot').first();
        await expect(dot).toBeVisible();

        const afterAnimationName = await dot.evaluate((element) =>
            getComputedStyle(element, '::after').animationName,
        );
        expect(afterAnimationName).toBe('none');
    });
});
