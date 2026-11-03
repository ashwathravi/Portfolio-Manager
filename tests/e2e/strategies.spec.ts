import { test, expect } from '@playwright/test';
import { gotoAppPage, reloadAppPage } from './helpers/app';
import { databaseAuthEnabled, signInAsFreshUser } from './helpers/users';

/**
 * Phase 6 Strategy Builder tests (AR-80/81/82) + AR-111 coverage.
 *
 * The /strategies page is a single-surface builder: a row of three
 * strategy cards on top, then a 64/36 split with the rule builder +
 * adherence editor on the left, and the backtest panel on the right.
 * AR-111 added:
 *   - a rolling 30-day adherence pill on each StrategyCard
 *   - an AdherenceRulesPanel under the rule builder
 *   - an AdherenceImpactCard under the builder surface
 *
 * Selectors lean on `data-testid` / stable classes rather than copy so
 * this suite survives prose tweaks.
 */

test.describe('Strategies page — Phase 6 builder shell', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/strategies');
    });

    test('renders the Strategies title without automation copy', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Strategies');
        await expect(page.getByText(/Earn automation/)).toHaveCount(0);
        await expect(page.getByText(/Deploy live/i)).toHaveCount(0);
    });

    test('labels the strategies as example data', async ({ page }) => {
        await expect(page.getByTestId('sample-data-notice')).toBeVisible();
    });

    test('regression: Duplicate creates and selects a copy (was a dead button)', async ({ context, page }) => {
        // With a database the copy is saved to the account: a user of its own.
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/strategies');
        await expect(page.getByTestId('strategies-empty')).toBeVisible();
        await page.getByRole('button', { name: 'Duplicate' }).click();
        const mine = page.getByTestId('my-strategies').locator('.pm-strategy-card');
        await expect(mine).toHaveCount(1);
        await expect(mine.first()).toHaveAttribute('aria-pressed', 'true');
        await expect(mine.first()).toContainText('Momentum + Trend (copy)');
        await expect(mine.first()).toContainText('Not backtested');
        await expect(page.getByTestId('example-strategies').locator('.pm-strategy-card')).toHaveCount(3);
    });

    test('an example has no Run backtest button: only a saved strategy runs one', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Run backtest' })).toHaveCount(0);
    });

    test('editing a rule flags the backtest as out of date', async ({ page }) => {
        await expect(page.getByTestId('backtest-stale')).toHaveCount(0);
        await page.getByLabel('Value').first().fill('0.95');
        await expect(page.getByTestId('backtest-stale')).toBeVisible();
    });

    test('renders three example strategy cards, labelled Sample', async ({ page }) => {
        const cards = page.locator('.pm-strategy-card');
        await expect(cards).toHaveCount(3);
        // Scoped to the switcher: the selected name is also in the breadcrumb.
        const row = page.getByTestId('example-strategies');
        await expect(page.getByRole('region', { name: 'Example strategies' }).getByTestId('sample-data-notice')).toBeVisible();
        await expect(row.getByText('Momentum + Trend')).toBeVisible();
        await expect(row.getByText('Mean Reversion')).toBeVisible();
        await expect(row.getByText('Sector Rotation')).toBeVisible();
    });

    test('selects the first strategy by default and updates on click', async ({ page }) => {
        const cards = page.locator('.pm-strategy-card');
        await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');

        // Click the second card; pressed flips.
        await cards.nth(1).click();
        await expect(cards.first()).toHaveAttribute('aria-pressed', 'false');
        await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
    });

    test('regression: a click made while the page hydrates on a slow device still lands', async ({ page }) => {
        // A request-time hook that switched to the live clock after hydration
        // re-rendered the builder as it hydrated, which swallowed clicks made
        // during hydration on slow CPUs (every CI run, never a fast laptop).
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
        await page.goto('/strategies', { waitUntil: 'commit' });
        const cards = page.locator('.pm-strategy-card');
        await cards.nth(1).click();
        await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
        await page.waitForTimeout(2_000);
        await expect(cards.first()).toHaveAttribute('aria-pressed', 'false');
        await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
    });

    test('renders the rule builder, adherence editor, and backtest panel', async ({
        page,
    }) => {
        await expect(page.getByTestId('adherence-rules-panel')).toBeVisible();
        // Rule builder section — heading is the terse "Rules" (shared with
        // the Universe/Guardrails section headers on the same panel).
        await expect(page.locator('h3#rb-rules')).toHaveText('Rules');
        // Backtest panel — rendered as `pm-bt-panel pm-card` on the right
        // column of the 64/36 split.
        await expect(page.locator('.pm-bt-panel').first()).toBeVisible();
    });
});

/**
 * AR-111 — StrategyCard rolling 30d adherence pill.
 *
 * Every card renders its own score pill computed from the example journal. The
 * pill carries `data-tier` so downstream styling is tier-aware. We don't
 * assert on an exact number — seed data can tweak over time — but we
 * assert structural invariants.
 */
test.describe('Strategies page — StrategyCard adherence pill (AR-111)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/strategies');
    });

    test('every card that has journal activity shows a 30d adherence pill', async ({
        page,
    }) => {
        const pills = page.getByTestId('strategy-card-adherence');
        // At least the seeded Momentum + Trend strategy has journal
        // coverage — we expect ≥1 pill, and each pill carries a tier.
        await expect(pills.first()).toBeVisible();
        const count = await pills.count();
        expect(count).toBeGreaterThan(0);

        for (let i = 0; i < count; i++) {
            const tier = await pills.nth(i).getAttribute('data-tier');
            expect(['top', 'good', 'ok', 'low', 'none']).toContain(tier);
        }
    });

    test('pill label reads "30d adherence" and shows a /100 denominator', async ({
        page,
    }) => {
        const firstPill = page.getByTestId('strategy-card-adherence').first();
        await expect(firstPill.getByText('30d adherence')).toBeVisible();
        await expect(firstPill.getByText('/ 100')).toBeVisible();
    });
});

/**
 * AR-111 — AdherenceRulesPanel CRUD on the Strategies builder.
 *
 * The panel is the seven-rule discipline editor. Tests exercise:
 *   - panel renders with seed rules for the default strategy
 *   - the rolling-30d score badge renders in the header when journal
 *     coverage exists
 *   - add-rule picker surfaces the seven rule types
 *   - adding a rule extends the list
 *   - removing a rule shrinks the list
 *   - severity toggle flips between hard/soft
 */
test.describe('Strategies page — Adherence rules editor (AR-111)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/strategies');
    });

    test('renders the adherence editor with seed rules for Momentum + Trend', async ({
        page,
    }) => {
        const panel = page.getByTestId('adherence-rules-panel');
        await expect(panel).toBeVisible();
        await expect(
            panel.getByRole('heading', { name: 'Discipline rules' }),
        ).toBeVisible();

        // Momentum + Trend seed has 5 rules.
        const rows = panel.locator('.pm-adherence-row');
        await expect(rows).toHaveCount(5);
    });

    test('renders the rolling 30-day score badge in the panel header', async ({
        page,
    }) => {
        const badge = page.getByTestId('adherence-score-badge');
        await expect(badge).toBeVisible();
        const tier = await badge.getAttribute('data-tier');
        expect(['top', 'good', 'ok', 'low', 'none']).toContain(tier);
        // Badge shows a /100 denominator.
        await expect(badge.getByText('/ 100')).toBeVisible();
    });

    test('add-rule button opens the picker with the seven rule types', async ({
        page,
    }) => {
        const panel = page.getByTestId('adherence-rules-panel');
        await panel.getByTestId('adherence-rules-add').click();

        const picker = panel.locator('.pm-adherence-picker');
        await expect(picker).toBeVisible();
        const select = picker.locator('select.pm-adherence-picker-select');
        // Seven rule types + the disabled placeholder = 8 options.
        await expect(select.locator('option')).toHaveCount(8);
    });

    test('picking a rule from the picker appends it to the list', async ({ page }) => {
        const panel = page.getByTestId('adherence-rules-panel');
        const rows = panel.locator('.pm-adherence-row');
        const before = await rows.count();

        await panel.getByTestId('adherence-rules-add').click();
        // max_sector_pct is NOT in the Momentum + Trend seed, so picking
        // it guarantees the list grows by exactly one and the row is
        // addressable by the new data-rule-type.
        await panel
            .locator('select.pm-adherence-picker-select')
            .selectOption('max_sector_pct');

        await expect(rows).toHaveCount(before + 1);
        await expect(
            panel.locator('.pm-adherence-row[data-rule-type="max_sector_pct"]'),
        ).toBeVisible();
    });

    test('removing a rule shrinks the list', async ({ page }) => {
        const panel = page.getByTestId('adherence-rules-panel');
        const rows = panel.locator('.pm-adherence-row');
        const before = await rows.count();

        await rows
            .first()
            .getByRole('button', { name: /Remove .* rule/ })
            .click();
        await expect(rows).toHaveCount(before - 1);
    });

    test('severity toggle flips between hard and soft', async ({ page }) => {
        const panel = page.getByTestId('adherence-rules-panel');
        const row = panel.locator('.pm-adherence-row').first();
        const before = await row.getAttribute('data-severity');
        expect(['hard', 'soft']).toContain(before);

        await row.locator('.pm-adherence-sev').click();

        const after = await row.getAttribute('data-severity');
        expect(after).not.toBe(before);
        expect(['hard', 'soft']).toContain(after);
    });

    test('switching strategy swaps the rule set', async ({ page }) => {
        const panel = page.getByTestId('adherence-rules-panel');
        const rowsBefore = await panel.locator('.pm-adherence-row').count();

        // Click the second card (Mean Reversion → 4 seed rules) and
        // confirm the list re-renders. Explicit on-screen assertion
        // avoids a race on the click-then-read cycle.
        await page.locator('.pm-strategy-card').nth(1).click();

        // Mean Reversion has 4 rules, Momentum + Trend has 5 — the
        // counts should differ.
        const rowsAfter = await panel.locator('.pm-adherence-row').count();
        expect(rowsAfter).not.toBe(rowsBefore);
    });
});

/**
 * AR-111 — AdherenceImpactCard (returns comparison).
 *
 * With the example journal shipping pre-frozen adherence on each entry, the
 * card renders the "Cost of breaking your own rules" view. If a bucket
 * is under-populated (< 10 trades), it falls back to the empty state.
 * We assert whichever it shows today still reads sensibly.
 */
test.describe('Strategies page — Adherence impact card (AR-111)', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/strategies');
    });

    test('card is present on the page', async ({ page }) => {
        await expect(page.getByTestId('adherence-impact-card')).toBeVisible();
    });

    test('either renders the delta view or the empty coach copy', async ({
        page,
    }) => {
        const card = page.getByTestId('adherence-impact-card');

        const delta = card.getByTestId('adherence-impact-delta');
        const empty = card.getByTestId('adherence-impact-empty');

        await expect(async () => {
            const deltaVisible = await delta.isVisible().catch(() => false);
            const emptyVisible = await empty.isVisible().catch(() => false);
            expect(deltaVisible || emptyVisible).toBe(true);
        }).toPass({ timeout: 10_000 });

        const deltaVisible = await delta.isVisible().catch(() => false);
        if (deltaVisible) {
            const tone = await delta.getAttribute('data-tone');
            expect(['pos', 'neg']).toContain(tone);
            await expect(
                card.getByTestId('adherence-impact-adherent'),
            ).toBeVisible();
            await expect(
                card.getByTestId('adherence-impact-broken'),
            ).toBeVisible();
        }
    });
});

/**
 * Regression: /strategies/[id] and /strategies/[id]/backtest used to render
 * "Strategy not found" for every seeded strategy. They now open the
 * workspace with that strategy selected.
 */
test.describe('Strategies page — legacy strategy URLs', () => {
    test('/strategies/<seeded id> selects that strategy in the workspace', async ({ page }) => {
        await page.goto('/strategies/strategy-mean-reversion');
        await expect(page).toHaveURL(/\/strategies\?strategy=strategy-mean-reversion$/);
        await expect(page.getByText('Strategy not found')).toHaveCount(0);
        const cards = page.locator('.pm-strategy-card');
        await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
    });

    test('/strategies/<seeded id>/backtest lands on the same workspace', async ({ page }) => {
        await page.goto('/strategies/strategy-sector-rotation/backtest');
        await expect(page).toHaveURL(/\/strategies\?strategy=strategy-sector-rotation$/);
        await expect(page.locator('.pm-strategy-card').nth(2)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.pm-bt-panel').first()).toBeVisible();
    });

    test('an unknown strategy id shows the 404 page', async ({ page }) => {
        // The /strategies segment streams a loading shell first, so the HTTP
        // status is not reliable in dev; assert on the rendered 404 instead.
        await page.goto('/strategies/does-not-exist');
        await expect(page.getByText('Page not found')).toBeVisible();
    });
});

test.describe('Strategies page — backtest chart legibility', () => {
    test('regression: backtest axis labels render at a readable size (were ~6px)', async ({ page }) => {
        await page.goto('/strategies');
        const label = page.locator('.pm-bt-chart svg text').first();
        await expect(label).toBeVisible();
        const px = await label.evaluate((el) => el.getBoundingClientRect().height);
        expect(px).toBeGreaterThanOrEqual(9);
    });
});

/**
 * Launch item i55: strategies saved to the account and backtested over the
 * price store. The fixtures store daily bars for SPY and the sector ETFs
 * from June 2026, plus three later sessions (to Oct 1).
 */
test.describe('Strategies saved to the account (i55)', () => {
    test.skip(!databaseAuthEnabled, 'strategies are saved with a database');

    test.beforeEach(async ({ context, page }) => {
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/strategies');
    });

    const mine = (page: import('@playwright/test').Page) => page.getByTestId('my-strategies').locator('.pm-strategy-card');
    const saved = (page: import('@playwright/test').Page) => expect(page.getByTestId('strategy-save-state')).toHaveText('Saved');

    async function newStrategy(page: import('@playwright/test').Page) {
        await page.getByRole('button', { name: 'New strategy' }).click();
        await expect(mine(page)).toHaveCount(1);
        await expect(mine(page).first()).toHaveAttribute('aria-pressed', 'true');
    }

    test('a new strategy is saved as it is edited and survives a reload', async ({ page }) => {
        await expect(page.getByTestId('strategies-empty')).toBeVisible();
        await newStrategy(page);
        await expect(mine(page).first()).toContainText('New strategy');
        await expect(mine(page).first()).toContainText('Not backtested');

        await page.getByLabel('Strategy name').fill('Tech trend');
        const add = page.getByLabel('Add ticker to strategy');
        await add.fill('xlk');
        await add.press('Enter');
        await expect(page.getByTestId('strategy-tickers')).toContainText('XLK');
        await saved(page);

        await reloadAppPage(page);
        await expect(mine(page)).toHaveCount(1);
        await mine(page).first().click();
        await expect(mine(page).first()).toContainText('Tech trend');
        await expect(page.getByTestId('strategy-tickers')).toContainText('SPY');
        await expect(page.getByTestId('strategy-tickers')).toContainText('XLK');
    });

    test('a backtest runs over stored prices, against SPY, and stays with the strategy', async ({ page }) => {
        await newStrategy(page);
        await page.getByRole('button', { name: '+ Sector ETFs' }).click();
        await expect(page.getByTestId('strategy-tickers')).toContainText('XLY');
        await saved(page);

        await page.getByRole('button', { name: 'Run backtest' }).click();
        // Close > SMA(50) needs 50 sessions: the window starts in August and ends at the last stored session.
        await expect(page.getByTestId('backtest-window')).toHaveText(/^Aug 2026 – Oct 2026$/);
        await expect(page.getByTestId('backtest-verdict')).toHaveText('Unproven');
        await expect(page.getByTestId('backtest-reason')).toHaveText('Under six months of history: too short to judge.');
        await expect(page.getByTestId('backtest-benchmark')).toContainText('SPY over the same window');
        await expect(page.getByTestId('backtest-assumptions')).toContainText('none of this is investment advice');
        await expect(page.getByRole('list', { name: 'Backtest stats' })).toContainText('Return');
        await expect(mine(page).first().getByTestId('strategy-card-return')).not.toHaveText('Not backtested');

        await reloadAppPage(page);
        await mine(page).first().click();
        await expect(page.getByTestId('backtest-window')).toHaveText(/^Aug 2026 – Oct 2026$/);
        await expect(page.getByTestId('backtest-stale')).toHaveCount(0);

        // Changing a rule marks the result as out of date.
        await page.getByLabel('Value').first().fill('SMA(20)');
        await expect(page.getByTestId('backtest-stale')).toBeVisible();
    });

    test('a rule Atlas can\'t compute is marked, and the backtest says which', async ({ page }) => {
        await newStrategy(page);
        const value = page.getByLabel('Value').first();
        await value.fill('P/E');
        await expect(value).toHaveAttribute('aria-invalid', 'true');
        await page.getByRole('button', { name: 'Run backtest' }).click();
        await expect(page.getByTestId('backtest-error')).toHaveText('Rule 1: "P/E" isn\'t a number or an indicator.');
        await expect(page.getByTestId('backtest-empty')).toBeVisible();
    });

    test('a ticker without stored prices is named and left out of the run', async ({ page }) => {
        await newStrategy(page);
        const add = page.getByLabel('Add ticker to strategy');
        await add.fill('ZZZZ');
        await add.press('Enter');
        await expect(page.getByTestId('strategy-tickers')).toContainText('ZZZZ');
        await page.getByRole('button', { name: 'Run backtest' }).click();
        await expect(page.getByTestId('backtest-missing')).toContainText('Left out, without stored prices yet: ZZZZ.');
    });

    test('a copy of an example is saved to the account and can be backtested', async ({ page }) => {
        await page.getByTestId('example-strategies').locator('.pm-strategy-card').filter({ hasText: 'Sector Rotation' }).click();
        await page.getByRole('button', { name: 'Duplicate' }).click();
        await expect(mine(page).first()).toContainText('Sector Rotation (copy)');
        await expect(page.getByRole('button', { name: 'Run backtest' })).toBeVisible();
        await reloadAppPage(page);
        await expect(mine(page)).toHaveCount(1);
        await expect(mine(page).first()).toContainText('Sector Rotation (copy)');
    });

    test('Delete asks first, then removes the strategy', async ({ page }) => {
        await newStrategy(page);
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        const confirm = page.getByRole('alertdialog', { name: 'Delete strategy' });
        await expect(confirm).toContainText('Delete “New strategy” and its backtest?');
        await confirm.getByRole('button', { name: 'Cancel' }).click();
        await expect(mine(page)).toHaveCount(1);

        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await confirm.getByRole('button', { name: 'Delete' }).click();
        await expect(page.getByTestId('strategies-empty')).toBeVisible();
        await reloadAppPage(page);
        await expect(page.getByTestId('strategies-empty')).toBeVisible();
    });

    test('the strategy API changes only your own strategies', async ({ context, page, playwright }) => {
        const strategy = {
            name: 'API strategy',
            definition: {
                rules: [{ id: 'r1', field: 'Close', op: '>', value: 'SMA(10)' }],
                conjunctions: [],
                symbols: ['XLK'],
                guardrails: { maxPositionPct: 0.5, stopLossPct: 0.1, rebalanceDays: 7 },
            },
        };
        const invalid = await page.request.post('/api/strategies', { data: { ...strategy, userId: 'someone' } });
        expect(invalid.status()).toBe(400);
        expect((await invalid.json()).code).toBe('INVALID_STRATEGY');

        const created = await page.request.post('/api/strategies', { data: strategy });
        expect(created.status()).toBe(201);
        const { id } = (await created.json()).data;
        const ran = await page.request.post(`/api/strategies/${id}/backtest`);
        expect(ran.status()).toBe(200);
        expect((await ran.json()).data.backtest).toMatchObject({ verdict: 'Unproven', symbolsWithoutHistory: [] });

        // Another user can't see, change, run or delete it.
        await signInAsFreshUser(context);
        expect((await page.request.put(`/api/strategies/${id}`, { data: strategy })).status()).toBe(404);
        expect((await page.request.post(`/api/strategies/${id}/backtest`)).status()).toBe(404);
        const other = await page.request.delete(`/api/strategies/${id}`);
        expect(other.status()).toBe(404);
        expect((await other.json()).code).toBe('STRATEGY_NOT_FOUND');

        const anonymous = await playwright.request.newContext({
            baseURL: 'http://localhost:3000',
            storageState: { cookies: [], origins: [] },
        });
        expect((await anonymous.post('/api/strategies', { data: strategy })).status()).toBe(401);
        expect((await anonymous.post(`/api/strategies/${id}/backtest`)).status()).toBe(401);
        expect((await anonymous.delete(`/api/strategies/${id}`)).status()).toBe(401);
        await anonymous.dispose();
    });
});
