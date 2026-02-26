import { test, expect } from '@playwright/test';

test.describe('Dashboard A11y', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('market status chips should use semantic list structure', async ({ page }) => {
        // This expects the container to have role="list" and aria-label="Market Status"
        const list = page.getByRole('list', { name: 'Market Status' });
        await expect(list).toBeVisible();

        // This expects the children to be listitems
        const items = list.getByRole('listitem');
        await expect(items).toHaveCount(3);
    });

    test('market status ping animation should respect reduced motion', async ({ page }) => {
         // We can use a locator to find the parent list first
         const list = page.getByRole('list', { name: 'Market Status' });

         // Find the element with animate-ping class
         const pingElement = list.locator('.animate-ping');

         // Check if the class contains motion-reduce:hidden
         // We use a regex because other classes might be present
         await expect(pingElement).toHaveClass(/motion-reduce:hidden/);
    });
});
