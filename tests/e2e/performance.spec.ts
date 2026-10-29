import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { gotoAppPage } from './helpers/app';
import { userKey } from './helpers/storage';
import { ABNB_REASON, DIS_REASON, seedClosedTrades } from './helpers/trades';
import { databaseAuthEnabled, signInAsFreshUser, signInAsNewUser } from './helpers/users';

/**
 * Performance tests.
 *
 * Performance has three views (section tabs):
 *   /performance            Returns — equity curve, metrics by period,
 *                           monthly heatmap
 *   /performance/attribution Attribution — plain-language read-out, BHB
 *                           bars, and the full attribution table
 *   /performance/behaviour  Behaviour — trading calendar (absorbed the
 *                           retired /analytics page), mood breakdown,
 *                           P&L density, weekly reviews archive
 *
 * The only page title is the Topbar h1 ("Performance"); the duplicated
 * in-body "Performance analytics" header was removed in the design review.
 *
 * Returns shows the user's own history once their accounts have nightly
 * valuations (fixture user A, see scripts/e2e/fixtures.sql), and the
 * labelled example series before that.
 */

const dbMode = Boolean(process.env.CI || process.env.E2E_DATABASE_AUTH === '1');

test.describe('Performance › Returns', () => {
    // A fresh copy of fixture user A has A's accounts but none of its
    // history, so it sees the example series. Without database sessions
    // nobody has history.
    test.beforeEach(async ({ context, page }) => {
        await signInAsFreshUser(context);
        await page.goto('/performance');
    });

    test('Topbar title renders "Performance"', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Performance');
    });

    test('renders the three returns cards; attribution moved to its own tab', async ({ page }) => {
        for (const title of [/^Equity curve$/i, /^Metrics by period$/i, /^Monthly return heatmap$/i]) {
            await expect(page.locator('h2.pm-card-title', { hasText: title })).toBeVisible();
        }
        await expect(page.locator('h2.pm-card-title', { hasText: /^Attribution$/i })).toHaveCount(0);
    });

    test('behavioural cards moved to the Behaviour view', async ({ page }) => {
        await expect(page.getByTestId('mood-breakdown')).toHaveCount(0);
        await expect(page.getByTestId('pnl-density-card')).toHaveCount(0);
    });

    test('regression: there is exactly one page heading (no duplicated in-page header)', async ({ page }) => {
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('h1.pm-page-title')).toHaveCount(0);
    });

    test('labels its example data', async ({ page }) => {
        await expect(page.getByTestId('sample-data-notice')).toBeVisible();
        await expect(page.getByTestId('return-history-note')).toHaveCount(0);
    });

    test('Export CSV is enabled and downloads monthly returns', async ({ page }) => {
        const button = page.getByRole('button', { name: 'Export CSV' });
        await expect(button).toBeEnabled();
        const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
        expect(download.suggestedFilename()).toBe('atlas-monthly-returns.csv');
    });

    test('regression: Export CSV keeps the charted months after a UTC month rollover', async ({ page }) => {
        // The export re-read the clock on click, so a page left open past the
        // end of a UTC month downloaded a different window than the charts.
        const loadedAt = new Date();
        await page.clock.install({ time: loadedAt });
        await page.goto('/performance');
        const button = page.getByRole('button', { name: 'Export CSV' });
        const exportedLastMonth = async () => {
            const [download] = await Promise.all([page.waitForEvent('download', { timeout: 2_000 }), button.click()]);
            const csv = await readFile(await download.path(), 'utf8');
            return csv.trim().split('\n').at(-1)?.split(',')[0];
        };
        // The series ends at the last complete month before the page loaded.
        const expected = new Date(Date.UTC(loadedAt.getUTCFullYear(), loadedAt.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);

        // Retry until hydration attaches the click handler.
        await expect(async () => expect(await exportedLastMonth()).toBe(expected)).toPass({ timeout: 15_000 });

        await page.clock.setSystemTime(Date.UTC(loadedAt.getUTCFullYear(), loadedAt.getUTCMonth() + 1, 1, 0, 1));
        expect(await exportedLastMonth()).toBe(expected);
    });
});

const MAIN = '00000000-0000-4000-8000-000000000001';
const GROWTH = '00000000-0000-4000-8000-000000000002';
const DIVIDEND = '00000000-0000-4000-8000-000000000003';

test.describe('Performance › Returns from your history', () => {
    test.skip(!dbMode, 'requires the database-auth E2E mode');

    const hero = (page: Page) => page.getByTestId('performance-hero');
    const accountSelect = (page: Page) => page.getByRole('combobox', { name: 'Account', exact: true });

    test('shows all accounts\' time-weighted return against the S&P 500, not example data', async ({ page }) => {
        await gotoAppPage(page, '/performance');
        await expect(page.getByTestId('sample-data-notice')).toHaveCount(0);
        await expect(hero(page)).toContainText('+9.31%');
        await expect(hero(page)).toContainText('time-weighted, since Aug 31, 2026 · S&P 500 +3.02% · alpha +6.29%');
        await expect(page.getByTestId('return-history-note')).toContainText(
            'All accounts: 3 closing valuations, Aug 31, 2026 to Oct 1, 2026.',
        );
        for (const title of [/^Equity curve$/i, /^Metrics by period$/i, /^Monthly return heatmap$/i]) {
            await expect(page.locator('h2.pm-card-title', { hasText: title })).toBeVisible();
        }
    });

    test('offers the benchmarks with a close on every date, and switches between them', async ({ page }) => {
        await gotoAppPage(page, '/performance');
        const benchmark = page.getByLabel('Benchmark');
        await expect(benchmark.locator('option')).toHaveText(['S&P 500', 'NASDAQ-100']);
        await benchmark.selectOption({ label: 'NASDAQ-100' });
        await expect(hero(page)).toContainText('NASDAQ-100 +5.00% · alpha +4.31%');
    });

    test('ranges the history doesn\'t reach back to are disabled, and periods show dashes', async ({ page }) => {
        await gotoAppPage(page, '/performance');
        const ranges = page.getByRole('radiogroup', { name: 'Time range' });
        await expect(ranges.getByRole('radio', { name: 'ALL' })).toHaveAttribute('aria-checked', 'true');
        await expect(ranges.getByRole('radio', { name: '1M' })).toBeEnabled();
        for (const range of ['3M', '6M', 'YTD', '1Y', '3Y']) {
            await expect(ranges.getByRole('radio', { name: range })).toBeDisabled();
        }
        const table = page.locator('section', { has: page.locator('h2', { hasText: 'Metrics by period' }) });
        const oneMonth = table.locator('tr', { has: page.locator('td', { hasText: /^1M$/ }) }).locator('td');
        await expect(oneMonth.nth(1)).toHaveText('+9.31%');
        // Two returns are too few for volatility and Sharpe to mean anything.
        await expect(oneMonth.nth(4)).toHaveText('—');
        await expect(oneMonth.nth(5)).toHaveText('—');
        await expect(table.locator('tr', { has: page.locator('td', { hasText: /^3M$/ }) }).locator('td').nth(1)).toHaveText('—');
    });

    test('the heatmap shows each month\'s return, starring a month so far', async ({ page }) => {
        await gotoAppPage(page, '/performance');
        await expect(page.locator('.pm-heatmap td[title^="Sep 2026:"]')).toHaveText('+4.1');
        // October so far (to Oct 1) is starred and explained.
        await expect(page.locator('.pm-heatmap td[title^="Oct 2026 (to Oct 1):"]')).toHaveText('+5.0*');
        await expect(page.getByTestId('heatmap-partial-note')).toBeVisible();
        await expect(page.locator('.pm-heatmap td[title^="Aug 2026:"]')).toHaveText('');
    });

    test('switches to one account through the URL', async ({ page }) => {
        await gotoAppPage(page, '/performance');
        await expect(accountSelect(page).locator('option')).toHaveText([
            'All accounts', 'Dividend Income', 'Growth Portfolio', 'Main Portfolio',
        ]);
        await accountSelect(page).selectOption({ label: 'Main Portfolio' });
        await expect(page).toHaveURL(new RegExp(`/performance\\?account=${MAIN}$`));
        await expect(hero(page)).toContainText('+8.57%');
        await expect(page.getByTestId('return-history-note')).toContainText('Main Portfolio: 3 closing valuations');
        await expect(accountSelect(page)).toHaveValue(MAIN);
    });

    test('regression: moving money between your own accounts isn\'t a return', async ({ page }) => {
        // Main moved 500 of cash to Growth on Oct 1: Main's value fell and
        // Growth's rose by it, but neither return moved with the money.
        await gotoAppPage(page, `/performance?account=${MAIN}`);
        await expect(hero(page)).toContainText('+8.57%');
        await gotoAppPage(page, `/performance?account=${GROWTH}`);
        await expect(hero(page)).toContainText('+10.00%');
    });

    test('an account without history says so', async ({ page }) => {
        await gotoAppPage(page, `/performance?account=${DIVIDEND}`);
        await expect(page.getByTestId('return-history-empty')).toContainText('No history for this account yet');
        await expect(page.getByTestId('sample-data-notice')).toHaveCount(0);
        await expect(accountSelect(page)).toHaveValue(DIVIDEND);
    });

    test('Export CSV downloads the daily history shown', async ({ page }) => {
        await gotoAppPage(page, `/performance?account=${MAIN}`);
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.getByRole('button', { name: 'Export CSV' }).click(),
        ]);
        expect(download.suggestedFilename()).toBe('atlas-daily-returns.csv');
        const csv = (await readFile(await download.path(), 'utf8')).trim().split('\n');
        expect(csv).toEqual([
            'date,account,account_value,return_pct,cumulative_return_pct,benchmark,benchmark_close,benchmark_cumulative_return_pct',
            '2026-08-31,Main Portfolio,7000,,0,S&P 500 (SPY),500,0',
            '2026-09-30,Main Portfolio,7600,8.5714,8.57,S&P 500 (SPY),510,2',
            '2026-10-01,Main Portfolio,7100,0,8.57,S&P 500 (SPY),515.1,3.02',
        ]);
    });

    test('another user sees none of it, even by account ID', async ({ context, page }) => {
        await context.clearCookies();
        await context.addCookies([{
            name: 'authjs.session-token',
            value: 'e2e-session-user-b',
            domain: 'localhost',
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
        }]);
        await gotoAppPage(page, `/performance?account=${MAIN}`);
        await expect(page.getByTestId('sample-data-notice')).toBeVisible();
        await expect(page.getByTestId('return-history-note')).toHaveCount(0);
        await expect(accountSelect(page)).toHaveCount(0);
        await expect(hero(page)).not.toContainText('+8.57%');
    });
});

test.describe('Performance › Attribution', () => {
    // A fresh copy of user A has none of A's history, so it sees the example breakdown.
    test.beforeEach(async ({ context, page }) => {
        await signInAsFreshUser(context);
        await page.goto('/performance/attribution');
    });

    test('is a Performance tab with one heading and labelled example data', async ({ page }) => {
        await expect(page.locator('h1')).toHaveCount(1);
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Performance');
        await expect(page.getByRole('link', { name: 'Attribution' })).toHaveAttribute('aria-current', 'page');
        await expect(page.getByTestId('sample-data-notice')).toBeVisible();
    });

    test('leads with a plain-language answer, then the bars and the full table', async ({ page }) => {
        await expect(page.getByTestId('attribution-lede')).toContainText(/You (beat|trailed|matched) the benchmark/);
        await expect(page.getByTestId('attribution-lede')).toContainText(/Mostly (allocation|selection|interaction)/);
        await expect(page.locator('h2.pm-card-title', { hasText: /^Attribution$/i })).toBeVisible();
        const table = page.getByTestId('attribution-table');
        await expect(table.locator('tbody tr')).toHaveCount(8);
        await expect(table.locator('tfoot')).toContainText('Total');
    });

    test('the table switches between sector and asset class', async ({ page }) => {
        const table = page.getByTestId('attribution-table');
        const assetClass = table.getByRole('radio', { name: 'Asset class' });
        await expect(async () => {
            await assetClass.click();
            await expect(assetClass).toHaveAttribute('aria-checked', 'true', { timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
        await expect(table.locator('thead')).toContainText('Asset class');
    });
});

// Launch item i50: attribution from user A's valuation history (scripts/e2e/fixtures.sql).
test.describe('Performance › Attribution from your history', () => {
    test.skip(!dbMode, 'requires the database-auth E2E mode');

    const table = (page: Page) => page.getByTestId('attribution-table');
    const row = (page: Page, label: string) => table(page).locator('tbody tr', { has: page.locator('th', { hasText: new RegExp(`^${label}$`) }) });

    test('all accounts against the S&P 500 by sector, not example data', async ({ page }) => {
        await gotoAppPage(page, '/performance/attribution');
        await expect(page.getByTestId('sample-data-notice')).toHaveCount(0);
        await expect(page.getByTestId('attribution-note')).toContainText('All accounts, Aug 31, 2026 to Oct 1, 2026, against the S&P 500 by sector');
        await expect(page.getByTestId('attribution-lede')).toContainText('You beat the benchmark by 6.3 pp');
        // The same return as Performance › Returns, against SPY's +3.02%.
        await expect(table(page).locator('tfoot td').nth(1)).toHaveText('9.3%');
        await expect(table(page).locator('tfoot td').nth(2)).toHaveText('3.0%');
        await expect(row(page, 'Consumer').locator('td').first()).toHaveText('93.2%');
        await expect(row(page, 'Cash').locator('td').first()).toHaveText('6.8%');
        // The sectors the benchmark holds, and cash; not the empty "Funds and other".
        await expect(table(page).locator('tbody tr')).toHaveCount(11);
        await expect(row(page, 'Funds and other')).toHaveCount(0);
    });

    test('periods the history doesn\'t reach back to are disabled; asset class compares stocks with the index', async ({ page }) => {
        await gotoAppPage(page, '/performance/attribution');
        const periods = page.getByRole('radiogroup', { name: 'Period' });
        await expect(periods.getByRole('radio', { name: 'ALL' })).toHaveAttribute('aria-checked', 'true');
        await expect(periods.getByRole('radio', { name: '1M' })).toBeEnabled();
        await expect(periods.getByRole('radio', { name: '3M' })).toBeDisabled();

        await table(page).getByRole('radio', { name: 'Asset class' }).click();
        await expect(row(page, 'Stocks').locator('td').nth(0)).toHaveText('93.2%');
        await expect(row(page, 'Stocks').locator('td').nth(1)).toHaveText('100.0%');
        await expect(row(page, 'Cash').locator('td').first()).toHaveText('6.8%');
    });

    test('regression: switching account starts the period choice afresh', async ({ page }) => {
        // The Codex finding on PR #161: the chosen period carried over to an
        // account whose history might not reach back to it.
        await gotoAppPage(page, '/performance/attribution');
        const periods = page.getByRole('radiogroup', { name: 'Period' });
        await periods.getByRole('radio', { name: '1M' }).click();
        await expect(periods.getByRole('radio', { name: '1M' })).toHaveAttribute('aria-checked', 'true');
        await page.getByRole('combobox', { name: 'Account', exact: true }).selectOption({ label: 'Main Portfolio' });
        await expect(page).toHaveURL(new RegExp(`account=${MAIN}$`));
        await expect(periods.getByRole('radio', { name: 'ALL' })).toHaveAttribute('aria-checked', 'true');
    });

    test('one account through the URL, and an account without history says so', async ({ page }) => {
        await gotoAppPage(page, `/performance/attribution?account=${MAIN}`);
        await expect(page.getByRole('combobox', { name: 'Account', exact: true })).toHaveValue(MAIN);
        await expect(page.getByTestId('attribution-note')).toContainText('Main Portfolio, Aug 31, 2026 to Oct 1, 2026');
        await expect(table(page).locator('tfoot td').nth(1)).toHaveText('8.6%');
        await expect(row(page, 'Consumer').locator('td').first()).toHaveText('86.3%');

        await gotoAppPage(page, `/performance/attribution?account=${DIVIDEND}`);
        await expect(page.getByTestId('attribution-empty')).toContainText('No history for this account yet');
    });

    test('another user sees none of it, even by account ID', async ({ context, page }) => {
        await context.clearCookies();
        await context.addCookies([{
            name: 'authjs.session-token',
            value: 'e2e-session-user-b',
            domain: 'localhost',
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
        }]);
        await gotoAppPage(page, `/performance/attribution?account=${MAIN}`);
        await expect(page.getByTestId('sample-data-notice')).toBeVisible();
        await expect(page.getByTestId('attribution-note')).toHaveCount(0);
    });
});

test.describe('Performance › Behaviour — trading calendar', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/performance/behaviour');
    });

    test('renders one continuous year grid with a single summary strip', async ({ page }) => {
        const card = page.getByTestId('trading-calendar');
        await expect(card).toBeVisible();
        await expect(card.getByTestId('trading-calendar-summary')).toHaveCount(1);
        await expect(card.getByRole('grid')).toBeVisible();
        // 365 or 366 in-year cells, all in one grid.
        const cells = await card.locator('[role="gridcell"]').count();
        expect([365, 366]).toContain(cells);
    });

    test('days with trades carry a P&L description', async ({ page }) => {
        const card = page.getByTestId('trading-calendar');
        const traded = card.locator('[role="gridcell"]:not([data-level="0"])').first();
        await expect(traded).toHaveAttribute('aria-label', /trade/);
    });

    test('marks its data as sample', async ({ page }) => {
        await expect(page.getByTestId('trading-calendar').getByTestId('sample-tag')).toBeVisible();
        await expect(page.getByTestId('sample-data-notice')).toBeVisible();
    });
});

/**
 * AR-110 Mood breakdown card. Aggregates mood-tagged trades from the
 * journal fixture into one row per mood with a cost-of-emotion bar
 * and a plain-English verdict panel.
 */
test.describe('Performance › Behaviour \u2014 Mood breakdown (AR-110)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/performance/behaviour');
    });

    test('renders the Mood breakdown card with all six mood rows', async ({ page }) => {
        const card = page.getByTestId('mood-breakdown');
        await expect(card).toBeVisible();

        // Scope label assertions to the row-label spans. The verdict
        // panel also prints the worst caution mood inside a `<strong>`,
        // so an unscoped `getByText(/^Revenge$/)` collides under strict
        // mode. `.pm-mood-label` wraps an emoji + a plain text span, so
        // we match on substring and assert exactly one row per label.
        const labels = card.locator('.pm-mood-label');
        for (const label of ['Calm', 'Focused', 'Neutral', 'Frustrated', 'FOMO', 'Revenge']) {
            await expect(
                labels.filter({ hasText: label }),
            ).toHaveCount(1);
        }
    });

    test('range selector shows 30d / 90d / 1Y / ALL and 90d is the default', async ({ page }) => {
        const card = page.getByTestId('mood-breakdown');
        const range = card.getByRole('tablist', { name: /Range/ });
        for (const label of ['30d', '90d', '1Y', 'ALL']) {
            await expect(range.getByRole('tab', { name: label })).toBeVisible();
        }
        await expect(range.getByRole('tab', { name: '90d' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    test('switching the range re-selects the clicked tab', async ({ page }) => {
        const range = page
            .getByTestId('mood-breakdown')
            .getByRole('tablist', { name: /Range/ });
        await range.getByRole('tab', { name: 'ALL' }).click();
        await expect(range.getByRole('tab', { name: 'ALL' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    test('verdict panel surfaces a caution or ok message', async ({ page }) => {
        const verdict = page.getByTestId('mood-verdict');
        await expect(verdict).toBeVisible();
        // Verdict always has a data-kind — caution / ok / neutral.
        await expect(verdict).toHaveAttribute('data-kind', /caution|ok|neutral/);
    });
});

/**
 * AR-113 P&L density heatmap. 6 rows (Mon–Sat) × 24 columns (0–23
 * local time) tinted by average realised P&L of trades that closed
 * in that window, with a legend and deterministic best/worst callout.
 */
test.describe('Performance › Behaviour \u2014 P&L density (AR-113)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/performance/behaviour');
    });

    test('renders card with title, grid, legend', async ({ page }) => {
        const card = page.getByTestId('pnl-density-card');
        await expect(card).toBeVisible();
        await expect(card.locator('h2#pm-heat-head')).toContainText(/P&L density/);
        await expect(card.getByTestId('pnl-density-grid')).toBeVisible();
        await expect(card.getByTestId('pnl-density-legend')).toBeVisible();
    });

    test('grid holds the full 6\u00d724 cell scaffold', async ({ page }) => {
        const card = page.getByTestId('pnl-density-card');
        // 6 weekdays * 24 hours = 144 cells. Asserting the exact count
        // locks the contract that the scaffold is always complete even
        // when trade counts are uneven.
        await expect(card.locator('[data-testid^="pnl-density-cell-"]')).toHaveCount(144);
    });

    test('range selector shows 30d / 90d / 1Y / ALL with 90d default', async ({ page }) => {
        const card = page.getByTestId('pnl-density-card');
        const range = card.getByRole('tablist', { name: /Time range/ });
        for (const label of ['30d', '90d', '1Y', 'ALL']) {
            await expect(range.getByRole('tab', { name: label })).toBeVisible();
        }
        await expect(range.getByRole('tab', { name: '90d' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    test('switching the range updates the selected tab', async ({ page }) => {
        const card = page.getByTestId('pnl-density-card');
        const range = card.getByRole('tablist', { name: /Time range/ });
        await range.getByRole('tab', { name: 'ALL' }).click();
        await expect(range.getByRole('tab', { name: 'ALL' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        await expect(range.getByRole('tab', { name: '90d' })).toHaveAttribute(
            'aria-selected',
            'false',
        );
    });

    test('seed data produces at least one populated cell on the ALL view', async ({ page }) => {
        const card = page.getByTestId('pnl-density-card');
        // Widen the window so we see the full 25-trade fixture.
        await card.getByRole('tab', { name: 'ALL' }).click();
        const populated = card.locator(
            '[data-testid^="pnl-density-cell-"]:not([data-trades="0"])',
        );
        expect(await populated.count()).toBeGreaterThan(0);
    });

    test('hovering a populated cell reveals the tooltip', async ({ page }) => {
        const card = page.getByTestId('pnl-density-card');
        await card.getByRole('tab', { name: 'ALL' }).click();
        const populated = card
            .locator('[data-testid^="pnl-density-cell-"]:not([data-trades="0"])')
            .first();
        await populated.hover();
        await expect(card.getByTestId('pnl-density-tooltip')).toBeVisible();
        await expect(card.getByTestId('pnl-density-tooltip')).toContainText(
            /(Mon|Tue|Wed|Thu|Fri|Sat)\s+\d{2}:00/,
        );
    });

    test('callouts surface best and/or worst windows', async ({ page }) => {
        const card = page.getByTestId('pnl-density-card');
        await card.getByRole('tab', { name: 'ALL' }).click();
        const callouts = card.getByTestId('pnl-density-callouts');
        await expect(callouts).toBeVisible();
        await expect(
            callouts.locator('[data-testid^="pnl-density-callout-"]').first(),
        ).toBeVisible();
    });
});

/**
 * Launch item i51: Behaviour from the user's own closed trades. A brand-new
 * user (example data off) with two (tests/e2e/helpers/trades.ts) sees them,
 * with the reasons they recorded, never the example journal.
 */
test.describe('Performance › Behaviour — from your closed trades (launch item i51)', () => {
    test.skip(!databaseAuthEnabled, 'closed trades come from the database');

    test('shows your closed trades and their reasons, not the example journal', async ({ context, page }) => {
        await signInAsNewUser(context, { firstSignIn: true });
        const seeded = await seedClosedTrades(page);
        await gotoAppPage(page, '/performance/behaviour');

        await expect(page.getByTestId('sample-data-notice')).toHaveCount(0);
        const calendar = page.getByTestId('trading-calendar');
        await expect(calendar).toBeVisible();
        await expect(calendar.getByTestId('sample-tag')).toHaveCount(0);
        await expect(calendar.locator('[role="gridcell"]:not([data-level="0"])').first()).toHaveAttribute('aria-label', /trade/);

        const closed = page.getByTestId('closed-trades');
        await expect(closed.getByTestId('closed-trades-summary')).toContainText('2 sales matched against the buys before them');
        await expect(closed.getByTestId('closed-trades-summary')).toContainText('2 with a reason you recorded');
        const rows = closed.getByTestId('closed-trade');
        await expect(rows).toHaveCount(2);
        // Newest first: today's ABNB, with the rationale and mood recorded on Trade.
        await expect(rows.first()).toContainText('ABNB · Trading');
        await expect(rows.first()).toContainText('same day');
        await expect(rows.first()).toContainText('Calm');
        await expect(rows.first().getByTestId('closed-trade-why')).toHaveText(ABNB_REASON);
        await expect(rows.first().getByTestId('closed-trade-pnl')).toHaveText('+$50.00');
        // DIS, with the entry decision written in Research › Journal.
        await expect(rows.nth(1)).toContainText('DIS · Trading');
        await expect(rows.nth(1)).toContainText('held 2 days');
        await expect(rows.nth(1).getByTestId('closed-trade-why')).toHaveText(DIS_REASON);
        await expect(rows.nth(1).getByTestId('closed-trade-pnl')).toHaveText('−$100.00');
        await expect(closed.getByTestId('closed-trades-hint')).toHaveCount(0);

        // One trade has a mood: not enough to read anything into.
        const mood = page.getByTestId('mood-breakdown');
        await mood.getByRole('tab', { name: 'ALL' }).click();
        await expect(mood.getByTestId('mood-breakdown-empty')).toContainText('Pick a mood when you draft an order on Trade');
        await expect(mood.getByTestId('mood-breakdown-empty')).toContainText('1 / 10 so far');

        // Trades carry dates, not times: no hour-of-day map.
        const density = page.getByTestId('pnl-density-card');
        await expect(density.getByTestId('pnl-density-untimed')).toBeVisible();
        await expect(density.getByTestId('pnl-density-grid')).toHaveCount(0);

        // The review week DIS was sold in.
        const week = page.getByTestId('reviews-archive').locator(`[data-week-id="${seeded.weekId}"]`);
        await expect(week).toHaveAttribute('data-empty', 'false');
        if (seeded.todayInWeek) {
            await expect(week).toContainText('This week you closed 2 trades.');
            await expect(week).toContainText('-$50');
        } else {
            await expect(week).toContainText('This week you closed 1 trade. Realised P&L of -$100');
            // Nothing recorded on Trade for DIS: no adherence score.
            await expect(week.locator('.pm-reviews-archive-mini', { hasText: 'Adherence' })).toContainText('—');
        }
    });

    test('a trade with nothing recorded says where a reason comes from', async ({ context, page }) => {
        await signInAsNewUser(context, { firstSignIn: true });
        const created = await page.request.post('/api/portfolios', { data: { name: 'Imported' } });
        const portfolioId = (await created.json()).data.id;
        for (const transaction of [
            { type: 'BUY', date: '2026-03-02', symbol: 'KO', quantity: 4, price: 60, fees: 1 },
            { type: 'SELL', date: '2026-03-09', symbol: 'KO', quantity: 4, price: 62, fees: 1 },
        ]) {
            expect((await page.request.post('/api/transactions', { data: { portfolioId, transaction } })).status()).toBe(201);
        }
        await gotoAppPage(page, '/performance/behaviour');

        const closed = page.getByTestId('closed-trades');
        await expect(closed.getByTestId('closed-trade')).toHaveCount(1);
        // Fees count: 4 × (62 − 60) − 2.
        await expect(closed.getByTestId('closed-trade-pnl')).toHaveText('+$6.00');
        await expect(closed.getByTestId('closed-trade-why')).toHaveCount(0);
        await expect(closed.getByTestId('closed-trades-summary')).toContainText('0 with a reason you recorded');
        await expect(closed.getByTestId('closed-trades-hint')).toContainText('mark it placed');
        await expect(closed.getByTestId('closed-trades-hint').getByRole('link', { name: 'Research › Journal' })).toHaveAttribute('href', '/research?tab=journal');
    });

    test('trades that can\'t be matched are named even when they are all there is', async ({ context, page }) => {
        await signInAsNewUser(context, { firstSignIn: true });
        const created = await page.request.post('/api/portfolios', { data: { name: 'Before the split' } });
        const portfolioId = (await created.json()).data.id;
        // IBM's stored closes are about $200 (scripts/e2e/fixtures.sql): trades at ten times
        // that came before a split, so their buys and sales can't be matched.
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
        for (const transaction of [
            { type: 'BUY', date: today, symbol: 'IBM', quantity: 1, price: 2000 },
            { type: 'SELL', date: today, symbol: 'IBM', quantity: 1, price: 2100 },
        ]) {
            expect((await page.request.post('/api/transactions', { data: { portfolioId, transaction } })).status()).toBe(201);
        }
        await gotoAppPage(page, '/performance/behaviour');

        await expect(page.getByTestId('behaviour-left-out')).toContainText('Left out: IBM.');
        await expect(page.getByText('No closed trades to show')).toBeVisible();
        await expect(page.getByTestId('closed-trades')).toHaveCount(0);
    });

    test('another user sees none of your trades', async ({ context, page }) => {
        await signInAsNewUser(context, { firstSignIn: true });
        await seedClosedTrades(page);
        await signInAsNewUser(context, { firstSignIn: true });
        await gotoAppPage(page, '/performance/behaviour');
        await expect(page.getByTestId('closed-trades')).toHaveCount(0);
        await expect(page.getByText('No closed trades yet')).toBeVisible();
    });
});

// --------------------------------------------------------------------- //
// AR-114 — Reviews archive card
// --------------------------------------------------------------------- //

test.describe('Performance › Behaviour — Reviews archive (AR-114)', () => {
    test.beforeEach(async ({ page }) => {
        // Reset the reviews slice exactly once per test, even if the
        // test navigates across pages. Using addInitScript alone would
        // re-wipe the key on every goto — the sessionStorage sentinel
        // gates the clear to the first navigation in the session.
        await page.addInitScript((key) => {
            try {
                const done = window.sessionStorage.getItem('__pm_test_wipe_done');
                if (!done) {
                    window.localStorage.removeItem(key);
                    window.sessionStorage.setItem('__pm_test_wipe_done', '1');
                }
            } catch {
                /* ignore */
            }
        }, userKey('pm-weekly-reviews-v1'));
        await page.goto('/performance/behaviour');
    });

    test('archive card renders with heading and subtitle', async ({ page }) => {
        const card = page.getByTestId('reviews-archive');
        await expect(card).toBeVisible();
        await expect(card).toContainText('Weekly reviews');
        await expect(card).toContainText('Reviews · Archive');
    });

    test('archive renders either populated rows or a clear empty state', async ({ page }) => {
        const card = page.getByTestId('reviews-archive');
        const rows = card.getByTestId('reviews-archive-row');
        const empty = card.getByTestId('reviews-archive-empty');
        await expect(rows.first().or(empty)).toBeVisible();

        const rowCount = await rows.count();
        const emptyVisible = await empty.isVisible().catch(() => false);

        // Exactly one surface should be active — and it should not be
        // both at once.
        expect(rowCount > 0 || emptyVisible).toBeTruthy();
        if (rowCount > 0) {
            // Each row must carry the week id data hook.
            const firstId = await rows.first().getAttribute('data-week-id');
            expect(firstId).toMatch(/^wk:\d{4}-\d{2}-\d{2}$/);
        }
    });

    test('reflections saved on the dashboard appear in the archive', async ({ page }) => {
        // Drop directly onto the dashboard to author a reflection, then
        // navigate to /performance and verify it surfaces.
        await page.goto('/');
        const textarea = page.getByTestId('weekly-review-reflection');
        await textarea.fill('Held through the earnings dip — right call.');
        await textarea.blur();
        // Give onBlur a moment to commit.
        await expect(async () => {
            const raw = await page.evaluate((key) => window.localStorage.getItem(key), userKey('pm-weekly-reviews-v1'));
            expect(raw).not.toBeNull();
        }).toPass({ timeout: 2000 });

        await page.goto('/performance/behaviour');
        const card = page.getByTestId('reviews-archive');
        const reflections = card.getByTestId('reviews-archive-reflection');
        // Current-week row should surface the reflection we just saved.
        await expect(reflections.first()).toBeVisible();
        await expect(reflections.first()).toContainText(/earnings dip/);
    });

    test('archive rows carry three mini-stats (Realized / Adherence / Trades)', async ({ page }) => {
        const card = page.getByTestId('reviews-archive');
        const rows = card.getByTestId('reviews-archive-row');
        await expect(rows.first().or(card.getByTestId('reviews-archive-empty'))).toBeVisible();
        const rowCount = await rows.count();
        if (rowCount === 0) test.skip();
        const first = rows.first();
        await expect(first).toContainText('Realized');
        await expect(first).toContainText('Adherence');
        await expect(first).toContainText('Trades');
    });
});
