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

  test('says the watchlist, journal, theses and Ask conversation are saved with the account, not only in the browser', async ({ page }) => {
    const collected = page.getByRole('region', { name: 'What we collect' });
    const added = collected.getByRole('listitem').filter({ hasText: 'Data you add.' });
    await expect(added).toContainText('your watchlist');
    await expect(added).toContainText('your decision journal');
    await expect(added).toContainText('your research theses');
    // Launch item i56.
    await expect(added).toContainText('the questions you ask Ask and its answers (the last 25 of each)');
    const browserOnly = collected.getByText(/stored only in your browser/);
    await expect(browserOnly).not.toContainText('watchlist,');
    await expect(browserOnly).not.toContainText('journal');
    await expect(browserOnly).not.toContainText('theses,');
    await expect(browserOnly).not.toContainText('Ask');
  });

  test('says what stays when you remove a watchlist ticker, journal entry or thesis', async ({ page }) => {
    const retention = page.getByRole('region', { name: 'Keeping and deleting your data' });
    await expect(retention).toContainText('watchlist, journal, theses, Ask questions and settings');
    await expect(retention).toContainText('When you clear your Ask conversation it disappears straight away, and its questions and answers are deleted a day later');
    await expect(retention.getByText(/When you remove a watchlist ticker or delete a journal entry or thesis/)).toContainText('notes and reasoning are erased');
  });

  test('says which linked accounts are synced, how often, and how to stop one', async ({ page }) => {
    // Launch item i44: linked investment accounts are kept as accounts.
    const collected = page.getByRole('region', { name: 'What we collect' });
    const linked = collected.getByRole('listitem').filter({ hasText: 'Accounts you link through Plaid.' });
    await expect(linked).toContainText('For each investment account you choose to connect, we keep its holdings, cash and up to two years of its investment transactions');
    await expect(linked).toContainText('refreshed each weekday evening and whenever you choose Sync now');
    await expect(linked).toContainText('accounts you don’t choose aren’t synced');
    const retention = page.getByRole('region', { name: 'Keeping and deleting your data' });
    await expect(retention).toContainText('To stop syncing a single account, delete it on the Accounts page');
    // Launch item i45: a connection can be ended from Settings.
    await expect(retention).toContainText('disconnect it in Settings (which also ends it at Plaid and erases our token for it)');
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
