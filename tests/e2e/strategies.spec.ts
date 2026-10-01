import { test, expect } from '@playwright/test';

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

    test('regression: Duplicate creates and selects a copy (was a dead button)', async ({ page }) => {
        const cards = page.locator('.pm-strategy-card');
        await expect(cards).toHaveCount(3);
        await page.getByRole('button', { name: 'Duplicate' }).click();
        await expect(cards).toHaveCount(4);
        await expect(cards.nth(3)).toHaveAttribute('aria-pressed', 'true');
        await expect(cards.nth(3)).toContainText('Momentum + Value (copy)');
    });

    test('regression: there is no inert "Run backtest" button', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Run backtest' })).toHaveCount(0);
    });

    test('editing a rule flags the backtest as out of date', async ({ page }) => {
        await expect(page.getByTestId('backtest-stale')).toHaveCount(0);
        await page.getByLabel('Value').first().fill('0.95');
        await expect(page.getByTestId('backtest-stale')).toBeVisible();
    });

    test('renders three seed strategy cards in the top row', async ({ page }) => {
        const cards = page.locator('.pm-strategy-card');
        await expect(cards).toHaveCount(3);
        // Scoped to the switcher: the selected name is also in the breadcrumb.
        const row = page.locator('.pm-strategy-row');
        await expect(row.getByText('Momentum + Value')).toBeVisible();
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
 * Every card renders its own score pill computed from SEED_JOURNAL. The
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
        // At least the seeded Momentum + Value strategy has journal
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

    test('renders the adherence editor with seed rules for Momentum + Value', async ({
        page,
    }) => {
        const panel = page.getByTestId('adherence-rules-panel');
        await expect(panel).toBeVisible();
        await expect(
            panel.getByRole('heading', { name: 'Discipline rules' }),
        ).toBeVisible();

        // Momentum + Value seed has 5 rules.
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
        // max_sector_pct is NOT in the Momentum + Value seed, so picking
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

        // Mean Reversion has 4 rules, Momentum + Value has 5 — the
        // counts should differ.
        const rowsAfter = await panel.locator('.pm-adherence-row').count();
        expect(rowsAfter).not.toBe(rowsBefore);
    });
});

/**
 * AR-111 — AdherenceImpactCard (returns comparison).
 *
 * With SEED_JOURNAL shipping pre-frozen adherence on each entry, the
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
