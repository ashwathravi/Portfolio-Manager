import { test, expect } from '@playwright/test';
import { clickUntil, gotoAppPage } from './helpers/app';

test.describe('Help page', () => {
    test.beforeEach(async ({ page }) => {
        await gotoAppPage(page, '/help');
    });

    test('opens with getting started and a glossary; one page heading', async ({ page }) => {
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Help');
        const steps = page.getByTestId('help-getting-started').locator('ol > li');
        await expect(steps).toHaveCount(5);
        await expect(steps.first().getByRole('link', { name: /Connect an account/ })).toHaveAttribute('href', '/settings#accounts');
        const glossary = page.getByTestId('help-glossary');
        for (const term of ['Bucket', 'Churn', 'Re-underwrite', 'Sample']) {
            await expect(glossary.locator('dt', { hasText: new RegExp(`^${term}$`) })).toBeVisible();
        }
        // Regression: nested <main> landmarks.
        await expect(page.locator('main main')).toHaveCount(0);
    });

    test('renders Alpha Radar v1 and v2 release notes and guides', async ({ page }) => {
        await expect(page.getByTestId('help-page')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Alpha Radar release notes and guide' })).toBeVisible();

        await expect(page.getByTestId('alpha-radar-help-v1')).toContainText('Alpha Radar v1');
        await expect(page.getByTestId('alpha-radar-help-v1')).toContainText('Release notes');
        await expect(page.getByTestId('alpha-radar-help-v1')).toContainText('How to use it');
        await expect(page.getByTestId('alpha-radar-help-v1')).toContainText('tracked filers');
        await expect(page.getByTestId('alpha-radar-help-v1')).toContainText('alerts');

        await expect(page.getByTestId('alpha-radar-help-v2')).toContainText('Alpha Radar v2');
        await expect(page.getByTestId('alpha-radar-help-v2')).toContainText('semantic memory');
        await expect(page.getByTestId('alpha-radar-help-v2')).toContainText('clone tracking');
        await expect(page.getByTestId('alpha-radar-help-v2')).toContainText('Exploratory backtest');
        await expect(page.getByText('Data freshness and maturity notes')).toBeVisible();
    });

    test('links Help to Alpha Radar product surfaces', async ({ page }) => {
        await page.getByRole('link', { name: 'Open Alpha Radar in Research' }).click();
        await expect(page).toHaveURL(/\/research\?tab=alpha-radar$/);
        await expect(page.getByTestId('alpha-radar-detail')).toBeVisible();

        await gotoAppPage(page, '/help');
        await page.getByRole('link', { name: 'Configure alert rules' }).click();
        await expect(page).toHaveURL(/\/settings\?tab=alerts$/);
        await expect(page.getByText('Alert Rules')).toBeVisible();
    });

    test('is reachable from the Dashboard Alpha Radar card', async ({ page }) => {
        await gotoAppPage(page, '/');
        const helpLink = page.getByTestId('alpha-radar-dashboard-help');
        await expect(helpLink).toHaveAttribute('href', '/help#alpha-radar-v1');
        await clickUntil(helpLink, async () => {
            await expect(page).toHaveURL(/\/help#alpha-radar-v1$/, { timeout: 1500 });
        });
        await expect(page.getByTestId('alpha-radar-help-v1')).toBeVisible();
    });

    test('is reachable from the Research Alpha Radar workflow', async ({ page }) => {
        await gotoAppPage(page, '/research?tab=alpha-radar');
        await page.getByTestId('alpha-radar-help-link').click();
        await expect(page).toHaveURL(/\/help#alpha-radar-v2$/);
        await expect(page.getByTestId('alpha-radar-help-v2')).toBeVisible();
    });

    test('is reachable from Alpha Radar notification settings', async ({ page }) => {
        await gotoAppPage(page, '/settings?tab=notifications');
        const helpLink = page.getByTestId('alpha-radar-delivery-help');
        await expect(helpLink).toHaveAttribute('href', '/help#alpha-radar-v2');
        await clickUntil(helpLink, async () => {
            await expect(page).toHaveURL(/\/help#alpha-radar-v2$/, { timeout: 1500 });
        });
        await expect(page.getByTestId('alpha-radar-help-v2')).toBeVisible();
    });

    test('keeps guide content visible on mobile width', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await gotoAppPage(page, '/help');

        await expect(page.getByTestId('help-page')).toBeVisible();
        await expect(page.getByTestId('alpha-radar-help-v1')).toBeVisible();
        await expect(page.getByTestId('alpha-radar-help-v2')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Open Alpha Radar in Research' })).toBeVisible();
    });
});
