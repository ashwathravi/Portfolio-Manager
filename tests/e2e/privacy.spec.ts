import { expect, test } from '@playwright/test';

test.describe('Privacy policy', () => {
  test.beforeEach(async ({ context, page }) => {
    // Google's consent screen and Plaid link here for people who are not
    // signed in, so every check runs signed out.
    await context.clearCookies();
    await page.goto('/privacy');
  });

  test('is public and renders without the app chrome', async ({ page }) => {
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page).toHaveTitle('Privacy Policy | Atlas Wealth');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByText(/^Last updated /)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  });

  test('covers collection, use, sharing, deletion and security', async ({ page }) => {
    for (const name of [
      'What we collect',
      'How we use it',
      'Who we share it with',
      'Keeping and deleting your data',
      'Security',
      'Your choices',
      'Children',
      'Changes to this policy',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
  });

  test('names every service that receives data, including error reports', async ({ page }) => {
    const sharing = page.getByRole('region', { name: 'Who we share it with' });
    for (const service of ['Plaid', 'Google', 'Vercel', 'Upstash', 'Supabase', 'Sentry']) {
      await expect(sharing.getByText(service, { exact: true })).toBeVisible();
    }
    await expect(sharing.getByText(/Reports never include your name, email, cookies/)).toBeVisible();
    await expect(sharing.getByText(/Sentry sees your IP address/)).toBeVisible();
  });

  test('links to the Plaid end user policy and a contact address', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Plaid End User Privacy Policy' }))
      .toHaveAttribute('href', 'https://plaid.com/legal/#end-user-privacy-policy');
    const contact = page.locator('a[href^="mailto:"]').first();
    await expect(contact).toBeVisible();
    await expect(contact).toHaveAttribute('href', /^mailto:[^@\s]+@[^@\s]+$/);
  });

  test('scrolls to the end of the policy and links back to sign in', async ({ page }) => {
    const back = page.getByRole('link', { name: 'Back to sign in' });
    await back.scrollIntoViewIfNeeded();
    await expect(back).toBeInViewport();
    await back.click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Privacy policy — sign-in callback', () => {
  test('drops a callback that points off the site', async ({ context, page }) => {
    await context.clearCookies();
    // "//host", and "/<tab>/host" and "/..//host", which normalize to "//host".
    for (const callback of ['%2F%2Fevil.test', '%2F%09%2Fevil.test', '%2F..%2F%2Fevil.test']) {
      await page.goto(`/privacy?callbackUrl=${callback}`);
      await expect(page.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
    }
  });
});

test.describe('Privacy policy — phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('has no horizontal overflow', async ({ context, page }) => {
    await context.clearCookies();
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
