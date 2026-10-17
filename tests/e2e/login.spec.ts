import { expect, test } from '@playwright/test';

test.describe('Login', () => {
  test('renders the Google sign-in page without the app chrome', async ({ context, page }) => {
    await context.clearCookies();
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue with Google/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  });

  test('links to the public privacy policy', async ({ context, page }) => {
    await context.clearCookies();
    await page.goto('/login');

    await page.getByRole('link', { name: 'Privacy Policy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
  });

  test('keeps the page a deep link asked for through the privacy policy detour', async ({ context, page }) => {
    await context.clearCookies();
    await page.goto('/login?callbackUrl=%2Fexecution');

    await page.getByRole('link', { name: 'Privacy Policy' }).click();
    await expect(page).toHaveURL(/\/privacy\?callbackUrl=%2Fexecution$/);
    await page.getByRole('link', { name: 'Back to sign in' }).click();
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fexecution$/);
  });
});

test.describe('Login — design review fixes', () => {
  test('uses the app brand mark and shows no raw backtick setup text', async ({ context, page }) => {
    await context.clearCookies();
    await page.goto('/login');
    await expect(page.locator('.pm-login-mark svg')).toBeVisible();
    await expect(page.getByText(/`AUTH_SECRET`/)).toHaveCount(0);
  });
});
