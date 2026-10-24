import { test, expect, type Page } from '@playwright/test';
import { gotoAppPage, reloadAppPage, selectAppTab } from './helpers/app';
import { signInAsFreshUser } from './helpers/users';

// With a database the watchlist and journal are kept in the account
// (launch item i38).
const databaseAuthEnabled = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');

/**
 * Resolves once a save to `collection` containing `text` has landed; at once
 * when research data is kept in the browser.
 */
async function savedTo(page: Page, collection: 'watchlist' | 'journal', text: string) {
    if (!databaseAuthEnabled) return;
    await page.waitForResponse((response) =>
        response.url().includes(`/api/research/${collection}/`)
        && response.request().method() === 'PUT'
        && (response.request().postData() ?? '').includes(text)
        && response.ok());
}

function watchlistSaved(page: Page, text: string) {
    return savedTo(page, 'watchlist', text);
}

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
        await expect(page.getByText('Coinbase Global').first()).toBeVisible();
        await expect(page.getByText('PLTR').first()).toBeVisible();
        await expect(page.getByText('SHOP').first()).toBeVisible();
    });

    test('should show price data on watchlist items', async ({ page }) => {
        await selectAppTab(page, 'Watchlist');

        const list = page.locator('.pm-research-list');
        await expect(list.getByText('Price').first()).toBeVisible();
        await expect(list.getByText('Target entry').first()).toBeVisible();
        await expect(list.getByText('To entry').first()).toBeVisible();
    });

    test('should switch to Decision Journal tab and show entries', async ({ page }) => {
        await selectAppTab(page, 'Journal');

        const list = page.locator('.pm-research-list');
        await expect(list.getByText('Increased position by 50 shares')).toBeVisible();
        await expect(list.getByText('Reduced position by 25 shares')).toBeVisible();
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

test.describe('Research watchlist', () => {
    // Changes are saved to the account, so each test has one of its own,
    // and wait for its list to load.
    test.beforeEach(async ({ context, page }) => {
        await signInAsFreshUser(context);
        const loaded = databaseAuthEnabled
            ? page.waitForResponse((response) => response.url().endsWith('/api/research/watchlist') && response.ok())
            : Promise.resolve();
        await gotoAppPage(page, '/research?tab=watchlist');
        await loaded;
    });

    test('regression: example rows are tagged Sample and the pane is real, not a placeholder', async ({ page }) => {
        const list = page.locator('.pm-research-list');
        await expect(list.getByTestId('sample-tag').first()).toBeVisible();
        await expect(page.getByText(/coming in Phase/)).toHaveCount(0);
        await list.getByRole('button', { name: /PLTR/ }).click();
        const pane = page.locator('.pm-research-pane');
        await expect(pane.locator('.pm-thesis-detail-sym')).toHaveText('PLTR');
        await expect(pane.getByRole('link', { name: 'Draft order' })).toHaveAttribute('href', '/execution?symbol=PLTR');
        await expect(pane.getByLabel('Why it is on the list')).toHaveValue(/AI platform/);
    });

    test('add a ticker, and it is still there after a reload', async ({ page }) => {
        const add = page.getByLabel('Add ticker to watchlist');
        await expect(async () => {
            await add.fill('amd');
            await expect(add).toHaveValue('AMD', { timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
        const saved = watchlistSaved(page, '"AMD"');
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        const pane = page.locator('.pm-research-pane');
        await expect(pane.locator('.pm-thesis-detail-sym')).toHaveText('AMD');
        await saved;
        await reloadAppPage(page);
        await expect(page.locator('.pm-research-list').getByRole('button', { name: /AMD/ })).toBeVisible();
    });

    test('duplicates and malformed tickers are refused with a message', async ({ page }) => {
        const add = page.getByLabel('Add ticker to watchlist');
        const addButton = page.getByRole('button', { name: 'Add', exact: true });
        await expect(async () => {
            await add.fill('intc');
            await expect(add).toHaveValue('INTC', { timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
        await addButton.click();
        await expect(page.locator('.pm-research-pane .pm-thesis-detail-sym')).toHaveText('INTC');
        await add.fill('intc');
        await addButton.click();
        await expect(page.locator('#watch-add-error')).toContainText('already on your watchlist');
        await add.fill('a..b');
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(page.locator('#watch-add-error')).toContainText('Enter a ticker like');
    });

    test('notes and target entry save and survive a reload', async ({ page }) => {
        await page.locator('.pm-research-list').getByRole('button', { name: /SHOP/ }).click();
        const pane = page.locator('.pm-research-pane');
        await pane.getByLabel('Target entry ($)').fill('70');
        const saved = watchlistSaved(page, 'Check margins first');
        await pane.getByRole('textbox', { name: 'Notes' }).fill('Check margins first');
        await pane.getByRole('textbox', { name: 'Notes' }).blur();
        await saved;
        await reloadAppPage(page);
        await page.locator('.pm-research-list').getByRole('button', { name: /SHOP/ }).click();
        await expect(pane.getByRole('textbox', { name: 'Notes' })).toHaveValue('Check margins first');
        await expect(pane.getByLabel('Target entry ($)')).toHaveValue('70');
    });

    test("regression: why and notes stop at what the account keeps", async ({ page }) => {
        // The Codex finding on PR #147: longer text could be typed, then was
        // cut short when saved.
        await page.locator('.pm-research-list').getByRole('button', { name: /PLTR/ }).click();
        const pane = page.locator('.pm-research-pane');
        await expect(pane.getByLabel('Why it is on the list')).toHaveAttribute('maxlength', '500');
        await expect(pane.getByRole('textbox', { name: 'Notes' })).toHaveAttribute('maxlength', '5000');
    });

    test('adding a ticker that is only an example makes it yours (no Sample tag)', async ({ page }) => {
        const add = page.getByLabel('Add ticker to watchlist');
        await expect(async () => {
            await add.fill('coin');
            await expect(add).toHaveValue('COIN', { timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        await expect(page.locator('#watch-add-error')).toHaveCount(0);
        const card = page.locator('.pm-research-list').getByRole('button', { name: /COIN/ });
        await expect(card).toHaveCount(1);
        await expect(card.getByTestId('sample-tag')).toHaveCount(0);
    });

    test('remove takes a ticker off the list, and it stays off after a reload', async ({ page }) => {
        await page.locator('.pm-research-list').getByRole('button', { name: /COIN/ }).click();
        const saved = watchlistSaved(page, '"dismissed":true');
        await page.locator('.pm-research-pane').getByRole('button', { name: 'Remove' }).click();
        await expect(page.locator('.pm-research-list').getByRole('button', { name: /COIN/ })).toHaveCount(0);
        await saved;
        await reloadAppPage(page);
        await expect(page.locator('.pm-research-list').getByRole('button', { name: /PLTR/ })).toBeVisible();
        await expect(page.locator('.pm-research-list').getByRole('button', { name: /COIN/ })).toHaveCount(0);
    });
});

test.describe('Research journal', () => {
    // Changes are saved to the account, so each test has one of its own,
    // and wait for its journal to load.
    test.beforeEach(async ({ context, page }) => {
        await signInAsFreshUser(context);
        const loaded = databaseAuthEnabled
            ? page.waitForResponse((response) => response.url().endsWith('/api/research/journal') && response.ok())
            : Promise.resolve();
        await gotoAppPage(page, '/research?tab=journal');
        await loaded;
    });

    test('selecting an entry shows its rationale beside the linked thesis', async ({ page }) => {
        await expect(page.getByText(/coming in Phase/)).toHaveCount(0);
        const list = page.locator('.pm-research-list');
        await list.getByRole('button', { name: /Reduced position by 25 shares/ }).click();
        const pane = page.locator('.pm-research-pane');
        await expect(pane.getByRole('heading', { level: 2 })).toHaveText('Reduced position by 25 shares');
        await expect(pane.getByRole('region', { name: 'Rationale at the time' })).toBeVisible();
        await expect(pane.getByRole('region', { name: 'Linked thesis' })).toBeVisible();
    });

    test('the entry form stops at what the account keeps', async ({ page }) => {
        await page.getByRole('button', { name: 'New entry' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByPlaceholder('AAPL')).toHaveAttribute('maxlength', '20');
        await expect(dialog.getByPlaceholder('e.g. Opened position with 20 shares')).toHaveAttribute('maxlength', '500');
        await expect(dialog.getByPlaceholder('Why are you making this decision?')).toHaveAttribute('maxlength', '5000');
    });

    test('a new entry is saved and is still there after a reload', async ({ page }) => {
        await page.getByRole('button', { name: 'New entry' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByPlaceholder('AAPL').fill('amd');
        await dialog.getByPlaceholder('e.g. Opened position with 20 shares').fill('Opened a starter position');
        await dialog.getByPlaceholder('Why are you making this decision?').fill('Data-centre GPUs gaining share');
        const saved = savedTo(page, 'journal', 'Opened a starter position');
        await dialog.getByRole('button', { name: 'Add Entry' }).click();
        const list = page.locator('.pm-research-list');
        await expect(list.getByRole('button', { name: /Opened a starter position/ })).toBeVisible();
        await saved;

        await reloadAppPage(page);
        const entry = list.getByRole('button', { name: /Opened a starter position/ });
        await expect(entry).toBeVisible();
        await expect(entry).toContainText('AMD');
    });

    test('an edited entry keeps the change after a reload', async ({ page }) => {
        const list = page.locator('.pm-research-list');
        await list.getByRole('button', { name: /Maintaining position through earnings/ }).click();
        await page.locator('.pm-research-pane').getByRole('button', { name: 'Edit' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByPlaceholder('e.g. Opened position with 20 shares').fill('Trimmed ahead of earnings');
        const saved = savedTo(page, 'journal', 'Trimmed ahead of earnings');
        await dialog.getByRole('button', { name: 'Save Changes' }).click();
        await expect(list.getByRole('button', { name: /Trimmed ahead of earnings/ })).toBeVisible();
        await saved;

        await reloadAppPage(page);
        await expect(list.getByRole('button', { name: /Trimmed ahead of earnings/ })).toBeVisible();
        await expect(list.getByRole('button', { name: /Maintaining position through earnings/ })).toHaveCount(0);
    });

    test('a deleted entry stays deleted after a reload', async ({ page }) => {
        const list = page.locator('.pm-research-list');
        await expect(list.getByRole('button', { name: /Increased position by 50 shares/ })).toBeVisible();
        page.once('dialog', (dialog) => dialog.accept());
        const saved = savedTo(page, 'journal', '"dismissed":true');
        await page.getByRole('button', { name: 'Delete journal entry for AAPL' }).click();
        await expect(list.getByRole('button', { name: /Increased position by 50 shares/ })).toHaveCount(0);
        await saved;

        await reloadAppPage(page);
        await expect(list.getByRole('button', { name: /Reduced position by 25 shares/ })).toBeVisible();
        await expect(list.getByRole('button', { name: /Increased position by 50 shares/ })).toHaveCount(0);
    });
});
