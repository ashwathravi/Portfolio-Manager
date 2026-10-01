import { test, expect } from '@playwright/test';
import { gotoAppPage } from './helpers/app';

/** 404 page: a way back and a way to search. */
test.describe('Not found page', () => {
    test('offers search and a link back to Today', async ({ page }) => {
        await gotoAppPage(page, '/does-not-exist');
        const card = page.getByTestId('not-found');
        await expect(card).toContainText('Page not found');
        await expect(card.getByRole('link', { name: 'Back to Today' })).toHaveAttribute('href', '/');
        await card.getByRole('button', { name: 'Search' }).click();
        await expect(page.getByTestId('command-palette')).toBeVisible();
    });
});
