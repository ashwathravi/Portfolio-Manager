import { expect, test } from '@playwright/test';

/**
 * Terms of Service (launch item i64): public like the privacy policy, and
 * the place that says nothing in Atlas Wealth is investment advice, that it
 * never places trades, and where its data comes from.
 */

test.describe('Terms of Service', () => {
  test.beforeEach(async ({ context, page }) => {
    // The sign-in page links here for people who aren't signed in yet.
    await context.clearCookies();
    await page.goto('/terms');
  });

  test('is public and renders without the app chrome', async ({ page }) => {
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page).toHaveTitle('Terms of Service | Atlas Wealth');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
    await expect(page.getByText(/^Last updated /)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
    await expect(page.getByTestId('app-footer')).toHaveCount(0);
  });

  test('covers use, advice, trading, data, conduct, the beta and liability', async ({ page }) => {
    for (const name of [
      'Using Atlas Wealth',
      'Not investment advice',
      'Atlas Wealth never places trades',
      'Market data and accuracy',
      'Your data',
      'Acceptable use',
      'The beta',
      'Ending your account',
      'No warranties',
      'Limits on liability',
      'Changes to these terms',
      'Contact',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
  });

  test('says nothing in the app is investment advice, naming what could read as it', async ({ page }) => {
    const advice = page.getByRole('region', { name: 'Not investment advice' });
    await expect(advice).toContainText('Nothing in Atlas Wealth is investment, financial, tax or legal advice, or a recommendation to buy, sell or hold any security.');
    for (const surface of ['Today’s list of what needs your attention', 'the checks on orders you draft on Trade', 'Ask’s answers', 'Alpha Radar’s summaries of SEC filings', 'labelled Sample']) {
      await expect(advice).toContainText(surface);
    }
    await expect(advice).toContainText('We are not a registered investment adviser, broker-dealer or financial planner');
  });

  test('says Atlas never places trades or moves money, and drafted orders are plans', async ({ page }) => {
    const trades = page.getByRole('region', { name: 'Atlas Wealth never places trades' });
    await expect(trades).toContainText('Atlas Wealth never places trades, routes orders, holds your money or moves it.');
    await expect(trades).toContainText('An order you draft on Trade is a plan saved for you to place yourself at your broker');
    await expect(trades).toContainText('Accounts you link through Plaid are read-only to us');
  });

  test('credits its data sources and says prices are closes, not live quotes', async ({ page }) => {
    const data = page.getByRole('region', { name: 'Market data and accuracy' });
    await expect(data.getByRole('link', { name: 'Massive' })).toHaveAttribute('href', 'https://massive.com');
    await expect(data.getByRole('link', { name: 'SEC EDGAR' })).toHaveAttribute('href', 'https://www.sec.gov/edgar');
    await expect(data.getByRole('link', { name: 'Plaid End User Privacy Policy' }))
      .toHaveAttribute('href', 'https://plaid.com/legal/#end-user-privacy-policy');
    await expect(data).toContainText('the latest closing prices we’ve stored, not live quotes');
    await expect(data).toContainText('Check the figures that matter with your broker or the source before you act on them.');
  });

  test('points to the privacy policy for data, and to Settings to download or delete it', async ({ page }) => {
    const yours = page.getByRole('region', { name: 'Your data' });
    await expect(yours.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    await expect(yours).toContainText('download all of it, or delete your account and everything in it, at any time in Settings');
    await expect(page.getByRole('region', { name: 'The beta' })).toContainText('we’ll email you at least 30 days before');
  });

  test('gives a contact address', async ({ page }) => {
    const contact = page.getByRole('region', { name: 'Contact' }).locator('a[href^="mailto:"]');
    await expect(contact).toBeVisible();
    await expect(contact).toHaveAttribute('href', /^mailto:[^@\s]+@[^@\s]+$/);
  });

  test('scrolls to the end and links back to sign in and to the privacy policy', async ({ page }) => {
    const footer = page.locator('.pm-legal-footer');
    await expect(footer.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    const back = footer.getByRole('link', { name: 'Back to sign in' });
    await back.scrollIntoViewIfNeeded();
    await expect(back).toBeInViewport();
    await back.click();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Terms of Service — sign-in callback', () => {
  test('drops a callback that points off the site', async ({ context, page }) => {
    await context.clearCookies();
    for (const callback of ['%2F%2Fevil.test', '%2F%09%2Fevil.test', '%2F..%2F%2Fevil.test']) {
      await page.goto(`/terms?callbackUrl=${callback}`);
      const footer = page.locator('.pm-legal-footer');
      await expect(footer.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
      await expect(footer.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    }
  });
});

test.describe('Terms of Service — phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('has no horizontal overflow', async ({ context, page }) => {
    await context.clearCookies();
    await page.goto('/terms');
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
