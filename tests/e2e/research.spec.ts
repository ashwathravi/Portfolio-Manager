import { test, expect } from '@playwright/test';
import { gotoAppPage, selectAppTab } from './helpers/app';

test.describe('Research page', () => {
    test.beforeEach(async ({ page }) => {
        await gotoAppPage(page, '/research');
    });

    test('should render a single page heading with its subtitle in the top bar', async ({ page }) => {
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Research');
        await expect(page.locator('.pm-topbar-sub')).toHaveText('Theses, watchlist, Alpha Radar, and decision journal');
        // Regression: the in-page "Research workspace" header duplicated the top bar.
        await expect(page.getByText('Research workspace')).toHaveCount(0);
    });

    test('regression: research tabs sit on one row (Alpha Radar no longer wraps)', async ({ page }) => {
        const tabs = page.getByRole('tablist', { name: 'Research section' }).getByRole('tab');
        await expect(tabs).toHaveCount(5);
        await page.evaluate(() => document.fonts.ready);
        // Measure once layout settles (fonts swap in after hydration).
        await expect(async () => {
            const tops = new Set<number>();
            for (let i = 0; i < 5; i++) {
                const box = await tabs.nth(i).boundingBox();
                expect(box?.height ?? 0).toBeLessThan(40);
                tops.add(Math.round(box?.y ?? 0));
            }
            expect(tops.size).toBe(1);
        }).toPass({ timeout: 5000 });
    });

    test('regression: delete lives in an overflow menu, not beside Edit', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Delete thesis' })).toHaveCount(0);
        await page.getByRole('button', { name: 'More thesis actions' }).click();
        await expect(page.getByRole('menuitem', { name: 'Delete thesis' })).toBeVisible();
        await expect(page.getByRole('menuitem', { name: 'Archive' })).toBeVisible();
    });

    test('example theses are tagged Sample and recently dated', async ({ page }) => {
        const pane = page.locator('.pm-research-col').first();
        await expect(pane.getByTestId('sample-tag').first()).toBeVisible();
        await expect(page.getByText(/updated .*202[34]/)).toHaveCount(0);
    });

    test('should display tab navigation (Theses, Watchlist, Alpha Radar, Journal, Archive)', async ({ page }) => {
        await expect(page.getByRole('tab', { name: 'Theses' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Watchlist' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Alpha Radar' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Journal' })).toBeVisible();
        await expect(page.getByRole('tab', { name: 'Archive' })).toBeVisible();
    });

    test('should show thesis cards on Active Theses tab', async ({ page }) => {
        const list = page.locator('.pm-research-list');
        // Active Theses is the default tab
        await expect(list.getByText('NVDA').first()).toBeVisible();
        await expect(list.getByText('AI Infrastructure Dominance')).toBeVisible();
        await expect(list.getByText('TSLA').first()).toBeVisible();
        await expect(list.getByText('MSFT').first()).toBeVisible();
    });

    test('should show conviction levels on thesis cards', async ({ page }) => {
        const list = page.locator('.pm-research-list');
        await expect(list.getByText('HIGH').first()).toBeVisible();
        await expect(list.getByText('MEDIUM').first()).toBeVisible();
    });

    test('should display target prices on thesis cards', async ({ page }) => {
        const list = page.locator('.pm-research-list');
        await expect(list.getByText('Target $950')).toBeVisible();
        await expect(list.getByText('Target $180')).toBeVisible();
        await expect(list.getByText('Target $485')).toBeVisible();
    });

    test('should switch to Watchlists tab and show watchlist items', async ({ page }) => {
        await selectAppTab(page, 'Watchlist');

        await expect(page.getByText('COIN').first()).toBeVisible();
        await expect(page.getByText('Coinbase Global')).toBeVisible();
        await expect(page.getByText('PLTR').first()).toBeVisible();
        await expect(page.getByText('SHOP').first()).toBeVisible();
    });

    test('should show price data on watchlist items', async ({ page }) => {
        await selectAppTab(page, 'Watchlist');

        const list = page.locator('.pm-research-list');
        await expect(list.getByText('Price').first()).toBeVisible();
        await expect(list.getByText('Target entry').first()).toBeVisible();
        await expect(list.getByText('Distance').first()).toBeVisible();
    });

    test('should switch to Decision Journal tab and show entries', async ({ page }) => {
        await selectAppTab(page, 'Journal');

        await expect(page.getByText('Increased position by 50 shares')).toBeVisible();
        await expect(page.getByText('Reduced position by 25 shares')).toBeVisible();
    });

    test('should show entry/exit/hold badges in journal', async ({ page }) => {
        await selectAppTab(page, 'Journal');

        await expect(page.getByText('entry').first()).toBeVisible();
        await expect(page.getByText('exit').first()).toBeVisible();
        await expect(page.getByText('hold').first()).toBeVisible();
    });

    test('should switch to Archive tab and show archived theses', async ({ page }) => {
        await selectAppTab(page, 'Archive');

        const list = page.locator('.pm-research-list');
        await expect(list.getByText('META').first()).toBeVisible();
        await expect(list.getByText('Metaverse Pivot Risk')).toBeVisible();
        await expect(page.getByText('Archived')).toBeVisible();
    });

    test('should show New Thesis button on theses tab', async ({ page }) => {
        await expect(page.getByRole('button', { name: /New thesis/ })).toBeVisible();
    });

    test('should render Alpha Radar filer selection and report detail', async ({ page }) => {
        await selectAppTab(page, 'Alpha Radar');

        await expect(page.getByTestId('alpha-radar-filer').first()).toBeVisible();
        await expect(page.getByTestId('alpha-radar-detail')).toBeVisible();
        await expect(page.getByTestId('alpha-radar-report')).toContainText('Alpha Radar');
        await expect(page.getByTestId('alpha-radar-change-row').first()).toBeVisible();
    });

    test('should search Alpha Radar evidence memory with fallback citations', async ({ page }) => {
        await selectAppTab(page, 'Alpha Radar');

        await page.getByTestId('alpha-radar-memory-search').fill('insurance');

        await expect(page.getByTestId('alpha-radar-memory-result').first()).toBeVisible();
        await expect(page.getByTestId('alpha-radar-memory-result').first()).toContainText(/insurance|Chubb/);
        await expect(page.getByTestId('alpha-radar-memory-fallback')).toBeVisible();
    });

    test('should show Alpha Radar clone tracking clusters and fund-style filters', async ({ page }) => {
        await selectAppTab(page, 'Alpha Radar');

        await expect(page.getByTestId('alpha-radar-clone-graph')).toBeVisible();
        await expect(page.getByTestId('alpha-radar-clone-cluster').first()).toBeVisible();
        await expect(page.getByTestId('alpha-radar-clone-cluster').first()).toContainText(/apple|chubb|nvidia/i);

        await page.getByTestId('alpha-radar-clone-style').filter({ hasText: 'Technology growth' }).click();
        await expect(page.getByTestId('alpha-radar-clone-cluster').first()).toContainText(/apple|nvidia/i);
    });

    test('should show Alpha Radar conviction ranking with component scores', async ({ page }) => {
        await selectAppTab(page, 'Alpha Radar');

        await expect(page.getByTestId('alpha-radar-conviction-ranking')).toBeVisible();
        await expect(page.getByTestId('alpha-radar-conviction-row').first()).toBeVisible();
        await expect(page.getByTestId('alpha-radar-conviction-components').first()).toContainText(/Raw \d+ · User \d+ · Evidence \d+/);
    });

    test('should show Alpha Radar external overlays and filter by theme', async ({ page }) => {
        await selectAppTab(page, 'Alpha Radar');

        await expect(page.getByTestId('alpha-radar-overlays')).toBeVisible();
        await expect(page.getByTestId('alpha-radar-overlay-idea').first()).toBeVisible();

        await page.getByTestId('alpha-radar-overlay-filter').filter({ hasText: 'AI infrastructure' }).click();
        await expect(page.getByTestId('alpha-radar-overlay-idea').first()).toContainText(/NVIDIA|NVDA|AI infrastructure/i);
    });

    test('should review Alpha Radar thesis drafts before promotion', async ({ page }) => {
        await selectAppTab(page, 'Alpha Radar');

        await expect(page.getByTestId('alpha-radar-thesis-drafts')).toBeVisible();
        await expect(page.getByTestId('alpha-radar-thesis-draft').first()).toContainText(/citations/i);

        await page.getByTestId('alpha-radar-thesis-edit').first().click();
        await expect(page.getByTestId('alpha-radar-thesis-edit-field').first()).toBeVisible();
        await page.getByTestId('alpha-radar-thesis-edit-field').first().fill('Reviewed Alpha Radar hypothesis with cited evidence.');
        await page.getByTestId('alpha-radar-thesis-save').first().click();
        await expect(page.getByTestId('alpha-radar-thesis-draft').first()).toContainText('Reviewed Alpha Radar hypothesis');

        await page.getByTestId('alpha-radar-thesis-accept').first().click();
        await expect(page.getByTestId('alpha-radar-thesis-draft').first()).toContainText(/accepted/i);
    });

    test('should show Alpha Radar scheduled orchestration status', async ({ page }) => {
        await selectAppTab(page, 'Alpha Radar');

        await expect(page.getByTestId('alpha-radar-scheduler')).toBeVisible();
        await expect(page.getByTestId('alpha-radar-scheduler')).toContainText('Scheduled orchestration');
        await expect(page.getByTestId('alpha-radar-scheduler')).toContainText('In-app delivery');
        await expect(page.getByTestId('alpha-radar-scheduler')).toContainText(/queued|No run due/i);
    });

    test('should show Alpha Radar run operations and provider budgets', async ({ page }) => {
        await selectAppTab(page, 'Alpha Radar');

        await expect(page.getByTestId('alpha-radar-operations')).toBeVisible();
        await expect(page.getByTestId('alpha-radar-operations')).toContainText('Run operations');
        await expect(page.getByTestId('alpha-radar-operations')).toContainText('Retries');
        await expect(page.getByTestId('alpha-radar-provider-budget').first()).toContainText('SEC EDGAR');
        await expect(page.getByTestId('alpha-radar-operations')).toContainText(/warned|blocked|Dry-run ready/i);
    });

    test('should show Alpha Radar exploratory backtest summaries', async ({ page }) => {
        await selectAppTab(page, 'Alpha Radar');

        await expect(page.getByTestId('alpha-radar-backtest')).toBeVisible();
        await expect(page.getByTestId('alpha-radar-backtest')).toContainText('Exploratory backtest');
        await expect(page.getByTestId('alpha-radar-backtest')).toContainText(/not production trading recommendations/i);
        await expect(page.getByTestId('alpha-radar-backtest-summary').first()).toContainText(/Hit rate|Avg relative|Lag-aware/i);
    });

    test('should show Alpha Radar refresh state', async ({ page }) => {
        await page.route('**/api/alpha-radar/filers/*/refresh', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 250));
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        scope: 'filer',
                        startedAt: new Date().toISOString(),
                        completedAt: new Date().toISOString(),
                        totalFilers: 1,
                        fetched: 0,
                        skipped: 0,
                        parsed: 0,
                        changed: 0,
                        memoGenerated: 0,
                        filers: [],
                        errors: [],
                    },
                }),
            });
        });

        await selectAppTab(page, 'Alpha Radar');
        await page.getByTestId('alpha-radar-refresh').click();
        await expect(page.getByTestId('alpha-radar-refresh')).toContainText('Refreshing');
    });

    test('should open Alpha Radar directly from query params', async ({ page }) => {
        await gotoAppPage(page, '/research?tab=alpha-radar');

        await expect(page.getByRole('tab', { name: 'Alpha Radar' })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByTestId('alpha-radar-detail')).toBeVisible();
    });
});

test.describe('Research thesis price strip', () => {
    const strip = (page: import('@playwright/test').Page) =>
        page.getByRole('region', { name: 'Price over the last 30 days' });

    test('regression: without live prices the line is labelled Illustrative and claims no change', async ({ page }) => {
        await page.route('**/api/market-data/historical**', (route) =>
            route.fulfill({ status: 500, json: { error: 'provider unavailable' } }),
        );
        await gotoAppPage(page, '/research');
        await expect(strip(page).getByTestId('sample-tag')).toHaveText('Illustrative');
        await expect(strip(page)).toContainText('Live prices unavailable');
        await expect(strip(page)).toContainText('Last saved');
    });

    test('regression: live daily bars in the { data } envelope replace the illustrative line', async ({ page }) => {
        const bars = Array.from({ length: 21 }, (_, i) => ({
            time: `2026-09-${String(i + 1).padStart(2, '0')}`,
            open: 100 + i,
            high: 101 + i,
            low: 99 + i,
            close: 100 + i,
            volume: 1000,
        }));
        await page.route('**/api/market-data/historical**', (route) =>
            route.fulfill({ status: 200, json: { data: bars } }),
        );
        await gotoAppPage(page, '/research');
        await expect(strip(page)).toContainText('Daily closes');
        await expect(strip(page).getByTestId('sample-tag')).toHaveCount(0);
        await expect(strip(page)).toContainText('$100.00');
        await expect(strip(page)).toContainText('$120.00');
    });
});
