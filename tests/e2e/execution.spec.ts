import { test, expect } from '@playwright/test';

/**
 * Phase 9 (AR-94) Execution tests.
 *
 * Phase 7 (AR-83/84/85/86) replaced the legacy single OrderEntryForm
 * surface with a variant-switching shell that renders one of three
 * execution layouts: Focus (default — form + blotter split), Checkout
 * (guided wizard), or Terminal (Bloomberg-style keyboard palette). The
 * chosen variant persists in localStorage under `pm-exec-variant`.
 *
 * The tests cover:
 *   - Topbar title + variant switcher in the Topbar actions slot
 *   - Focus variant's "New order" form fields, TIF group, preview rows
 *   - Blotter filter chips
 *   - Switching variants flips the `data-variant` attribute on the shell
 */

test.describe('Execution page (Focus variant, default)', () => {
    test.beforeEach(async ({ page }) => {
        // Clear any persisted variant so every test lands on Focus.
        await page.addInitScript(() => {
            try {
                window.localStorage.removeItem('pm-exec-variant');
            } catch {
                /* private-mode / sandboxed — ignore */
            }
        });
        await page.goto('/execution');
    });

    test('renders Topbar title "Execution" and the 3-pill variant switcher', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Execution');

        const switcher = page.locator('.pm-variant-switch');
        await expect(switcher).toBeVisible();
        await expect(switcher.getByRole('tab', { name: /Focus/ })).toBeVisible();
        await expect(switcher.getByRole('tab', { name: /Checkout/ })).toBeVisible();
        await expect(switcher.getByRole('tab', { name: /Terminal/ })).toBeVisible();
    });

    test('lands on the Focus variant by default', async ({ page }) => {
        await expect(page.locator('.pm-exec-page[data-variant="focus"]')).toBeVisible();
    });

    test('Focus variant shows both the New order form and Today\'s orders blotter', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'New order' })).toBeVisible();
        await expect(
            page.getByText('Draft routes to review. Never fills on click.'),
        ).toBeVisible();
        // "Today's orders" uses an h3 inside the right card.
        await expect(page.getByRole('heading', { name: /Today.?s orders/i })).toBeVisible();
    });

    test('side toggle defaults to Buy and switches to Sell on click', async ({ page }) => {
        const sideTabs = page.locator('.pm-exec-side');
        await expect(sideTabs.getByRole('tab', { name: 'Buy' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        await expect(sideTabs.getByRole('tab', { name: 'Sell' })).toHaveAttribute(
            'aria-selected',
            'false',
        );

        await sideTabs.getByRole('tab', { name: 'Sell' }).click();
        await expect(sideTabs.getByRole('tab', { name: 'Sell' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
    });

    test('form renders ticker / quantity / order-type with seed defaults', async ({ page }) => {
        await expect(page.getByLabel('Ticker')).toHaveValue('AAPL');
        await expect(page.getByLabel('Quantity')).toHaveValue('50');
        await expect(page.getByLabel('Order type')).toHaveValue('limit');
    });

    test('ticker input uppercases user input', async ({ page }) => {
        const ticker = page.getByLabel('Ticker');
        await ticker.fill('tsla');
        await expect(ticker).toHaveValue('TSLA');
    });

    test('TIF segmented group shows DAY/GTC/IOC/FOK with DAY selected', async ({ page }) => {
        const tif = page.locator('.pm-exec-tif');
        await expect(tif.getByRole('tab', { name: 'DAY' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        for (const opt of ['GTC', 'IOC', 'FOK']) {
            await expect(tif.getByRole('tab', { name: opt })).toBeVisible();
        }
    });

    test('preview section renders notional / commission / buying-power / position rows', async ({ page }) => {
        const preview = page.locator('.pm-exec-preview');
        await expect(preview.getByText('Notional')).toBeVisible();
        await expect(preview.getByText('Est. commission')).toBeVisible();
        await expect(preview.getByText('Buying power after')).toBeVisible();
        await expect(preview.getByText('Position after')).toBeVisible();
    });

    test('blotter exposes All / Working / Filled / Rejected filter chips', async ({ page }) => {
        const chips = page.locator('.pm-exec-chips');
        for (const label of ['All', 'Working', 'Filled', 'Rejected']) {
            await expect(
                chips.getByRole('tab', { name: new RegExp(`^${label}`) }),
            ).toBeVisible();
        }
    });

    test('switching to Checkout variant flips the shell data-variant attribute', async ({ page }) => {
        await page
            .locator('.pm-variant-switch')
            .getByRole('tab', { name: /Checkout/ })
            .click();
        await expect(page.locator('.pm-exec-page[data-variant="checkout"]')).toBeVisible();
    });

    test('switching to Terminal variant flips the shell data-variant attribute', async ({ page }) => {
        await page
            .locator('.pm-variant-switch')
            .getByRole('tab', { name: /Terminal/ })
            .click();
        await expect(page.locator('.pm-exec-page[data-variant="terminal"]')).toBeVisible();
    });
});

/**
 * AR-109 (JournalPlus): pre-trade rationale capture.
 *
 * The Focus variant gates Submit behind a completed rationale panel
 * when `execution.rationaleRequired` is true (the default). These
 * tests exercise the rendering, the gate, the analytics event path,
 * and the settings override.
 */
test.describe('Execution page — pre-trade rationale (AR-109)', () => {
    test.beforeEach(async ({ page }) => {
        // `addInitScript` re-runs on every navigation, which would wipe
        // the settings store mid-test. So we ONLY use it to install the
        // analytics sink (idempotent to rerun), and clear the persisted
        // state once via a fresh blank page before the first real goto.
        await page.addInitScript(() => {
            (window as unknown as {
                __pmAnalytics: { events: unknown[] };
            }).__pmAnalytics = { events: [] };
        });

        // First navigation is to a blank page on the app origin so we
        // can reach into localStorage and reset persisted stores to
        // defaults. Subsequent navigations inside the test rehydrate
        // cleanly without re-wiping.
        await page.goto('/execution');
        await page.evaluate(() => {
            try {
                window.localStorage.removeItem('pm-exec-variant');
                window.localStorage.removeItem('atlas-settings');
            } catch {
                /* ignore */
            }
        });
        // Reload so the stores pick up the cleared state on this first
        // visit (rationaleRequired defaults back to `true`).
        await page.reload();
    });

    test('renders the rationale panel on the Focus variant by default', async ({ page }) => {
        await expect(page.getByTestId('pre-trade-rationale')).toBeVisible();
        await expect(
            page.getByRole('heading', { name: 'Why this trade?' }),
        ).toBeVisible();
    });

    test('Submit stays disabled until the rationale is complete', async ({ page }) => {
        const submit = page.getByRole('button', { name: /Review & buy/ });
        await expect(submit).toBeDisabled();

        // Fill the 5 required fields in order. The chip buttons use
        // `aria-pressed` rather than `role="radio"` — the chip list has
        // no roving tabindex / arrow-key handling, so the "radio" role
        // would mislead screen readers. Tests match real semantics: a
        // toggle button group.
        const panel = page.getByTestId('pre-trade-rationale');

        // Thesis — pick the first available chip in the Thesis group,
        // or create inline if the store had no seeded thesis for AAPL.
        const thesisGroup = panel.locator(
            'div[role="group"][aria-label="Thesis linkage"]',
        );
        const firstThesisChip = thesisGroup.locator('button.pm-rat-chip').first();
        const anyThesisVisible = await firstThesisChip.isVisible();
        if (anyThesisVisible && !(await firstThesisChip.getAttribute('class'))?.includes('pm-rat-chip-add')) {
            await firstThesisChip.click();
        } else {
            // No seeded thesis for AAPL in default store — create one inline.
            await panel.getByRole('button', { name: /New thesis/ }).click();
            await panel
                .getByPlaceholder(/Why buy AAPL\?/)
                .fill('Margin expansion 2026');
            await panel.getByRole('button', { name: 'Create', exact: true }).click();
        }

        // Setup — pick "Breakout".
        await panel.getByRole('button', { name: 'Breakout' }).click();

        // Conviction — bump slider to 7.0.
        const slider = panel.getByLabel(/Conviction/);
        await slider.fill('7');

        // Mood — pick "Focused".
        await panel.getByRole('button', { name: /Focused/ }).click();

        // Rationale text.
        await panel
            .getByLabel('Rationale')
            .fill('Gap up on upgrade, riding momentum into close.');

        // Submit should now be enabled.
        await expect(submit).toBeEnabled();
    });

    test('overshooting the 240-char limit flags the counter', async ({ page }) => {
        const panel = page.getByTestId('pre-trade-rationale');
        const textarea = panel.getByLabel('Rationale');
        const long = 'x'.repeat(245);
        await textarea.fill(long);

        // Counter flips to over-limit styling.
        await expect(panel.locator('.pm-rat-counter.is-over')).toBeVisible();
    });

    test('submitting fires the trade.rationale.submitted analytics event', async ({ page }) => {
        const panel = page.getByTestId('pre-trade-rationale');

        // Pick first thesis chip or inline-create. Chips are buttons
        // with `aria-pressed`; scope to the thesis group so we don't
        // accidentally grab the "+ New thesis" chip.
        const thesisGroup = panel.locator(
            'div[role="group"][aria-label="Thesis linkage"]',
        );
        const firstThesisChip = thesisGroup.locator('button.pm-rat-chip').first();
        const firstChipClass = (await firstThesisChip.getAttribute('class')) ?? '';
        if (
            (await firstThesisChip.isVisible()) &&
            !firstChipClass.includes('pm-rat-chip-add')
        ) {
            await firstThesisChip.click();
        } else {
            await panel.getByRole('button', { name: /New thesis/ }).click();
            await panel.getByPlaceholder(/Why buy/).fill('Test thesis');
            await panel.getByRole('button', { name: 'Create', exact: true }).click();
        }
        await panel.getByRole('button', { name: 'Conviction add' }).click();
        await panel.getByLabel(/Conviction/).fill('6');
        await panel.getByRole('button', { name: /Calm/ }).click();
        await panel.getByLabel('Rationale').fill('Adding to winner on pullback.');

        await page.getByRole('button', { name: /Review & buy/ }).click();

        // Analytics sink should have captured a submitted event.
        const events = await page.evaluate(() => {
            return (
                window as unknown as {
                    __pmAnalytics?: { events: Array<{ name: string }> };
                }
            ).__pmAnalytics?.events ?? [];
        });
        expect(events.some((e) => e.name === 'trade.rationale.submitted')).toBe(
            true,
        );
    });

    test('disabling the rationale requirement in Settings lifts the gate', async ({ page }) => {
        // Flip the setting off.
        await page.goto('/settings');
        const toggle = page.getByLabel(
            'Toggle pre-trade rationale requirement',
        );
        await expect(toggle).toBeChecked();
        await toggle.click();
        await expect(toggle).not.toBeChecked();

        // Back to Execution — rationale panel should be gone and Submit
        // should only be blocked by the regular order-form validation.
        await page.goto('/execution');
        await expect(page.getByTestId('pre-trade-rationale')).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Review & buy/ })).toBeEnabled();
    });
});

/**
 * AR-110 (Mood cooldown nudge): caution moods (fomo / revenge) trigger
 * a cooldown timer on the Submit button. First press starts the timer
 * instead of firing; the button stays locked until the timer expires,
 * then the user can press again to actually submit.
 */
test.describe('Execution page — caution-mood cooldown (AR-110)', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            (window as unknown as {
                __pmAnalytics: { events: unknown[] };
            }).__pmAnalytics = { events: [] };
        });
        await page.goto('/execution');
        await page.evaluate(() => {
            try {
                window.localStorage.removeItem('pm-exec-variant');
                window.localStorage.removeItem('atlas-settings');
            } catch {
                /* ignore */
            }
        });
        await page.reload();
    });

    test('pressing Submit with mood=FOMO starts the cooldown timer instead of firing', async ({ page }) => {
        const panel = page.getByTestId('pre-trade-rationale');

        // Complete the rationale end-to-end with mood=FOMO.
        const thesisGroup = panel.locator(
            'div[role="group"][aria-label="Thesis linkage"]',
        );
        const firstThesisChip = thesisGroup.locator('button.pm-rat-chip').first();
        const firstClass = (await firstThesisChip.getAttribute('class')) ?? '';
        if (
            (await firstThesisChip.isVisible()) &&
            !firstClass.includes('pm-rat-chip-add')
        ) {
            await firstThesisChip.click();
        } else {
            await panel.getByRole('button', { name: /New thesis/ }).click();
            await panel.getByPlaceholder(/Why buy/).fill('Impulse test');
            await panel.getByRole('button', { name: 'Create', exact: true }).click();
        }
        await panel.getByRole('button', { name: 'Breakout' }).click();
        await panel.getByLabel(/Conviction/).fill('6');
        await panel.getByRole('button', { name: /FOMO/ }).click();
        await panel.getByLabel('Rationale').fill('Chasing the pump, fully aware.');

        const submit = page.getByRole('button', { name: /Review & buy/ });
        await expect(submit).toBeEnabled();
        await submit.click();

        // After one press, the button should be disabled and the label
        // should switch into the countdown form.
        const cooldownBtn = page.locator(
            'button.pm-exec-submit[data-cooldown="true"]',
        );
        await expect(cooldownBtn).toBeVisible();
        await expect(cooldownBtn).toBeDisabled();
        await expect(cooldownBtn).toContainText(/Hold on/);

        // Analytics sink should have captured a cooldown start.
        const events = await page.evaluate(() => {
            return (
                window as unknown as {
                    __pmAnalytics?: { events: Array<{ name: string }> };
                }
            ).__pmAnalytics?.events ?? [];
        });
        expect(events.some((e) => e.name === 'trade.cooldown.started')).toBe(
            true,
        );

        // No rationale submission yet — the first Submit press only
        // starts the timer.
        expect(events.some((e) => e.name === 'trade.rationale.submitted')).toBe(
            false,
        );
    });

    test('switching away from caution mood mid-cooldown clears the lock', async ({ page }) => {
        const panel = page.getByTestId('pre-trade-rationale');

        // Complete the rationale with mood=Revenge.
        const thesisGroup = panel.locator(
            'div[role="group"][aria-label="Thesis linkage"]',
        );
        const firstThesisChip = thesisGroup.locator('button.pm-rat-chip').first();
        const firstClass = (await firstThesisChip.getAttribute('class')) ?? '';
        if (
            (await firstThesisChip.isVisible()) &&
            !firstClass.includes('pm-rat-chip-add')
        ) {
            await firstThesisChip.click();
        } else {
            await panel.getByRole('button', { name: /New thesis/ }).click();
            await panel.getByPlaceholder(/Why buy/).fill('Reverse it');
            await panel.getByRole('button', { name: 'Create', exact: true }).click();
        }
        await panel.getByRole('button', { name: 'Breakout' }).click();
        await panel.getByLabel(/Conviction/).fill('7');
        await panel.getByRole('button', { name: /Revenge/ }).click();
        await panel.getByLabel('Rationale').fill('Getting it back from last week.');

        // Press Submit → cooldown starts.
        await page.getByRole('button', { name: /Review & buy/ }).click();
        await expect(
            page.locator('button.pm-exec-submit[data-cooldown="true"]'),
        ).toBeVisible();

        // Switch mood to "Focused" — cooldown should clear.
        await panel.getByRole('button', { name: /Focused/ }).click();
        await expect(
            page.locator('button.pm-exec-submit[data-cooldown="true"]'),
        ).toHaveCount(0);
        await expect(
            page.getByRole('button', { name: /Review & buy/ }),
        ).toBeEnabled();
    });

    test('setting cooldown to Off in Settings bypasses the timer', async ({ page }) => {
        // Flip cooldown to "Off".
        await page.goto('/settings');
        const group = page.getByRole('radiogroup', {
            name: /Mood cooldown duration/,
        });
        await expect(group).toBeVisible();
        await group.getByRole('radio', { name: 'Off' }).click();
        await expect(group.getByRole('radio', { name: 'Off' })).toHaveAttribute(
            'aria-checked',
            'true',
        );

        // Back to Execution — completing a FOMO rationale and pressing
        // Submit should fire immediately (no countdown button).
        await page.goto('/execution');
        const panel = page.getByTestId('pre-trade-rationale');
        const thesisGroup = panel.locator(
            'div[role="group"][aria-label="Thesis linkage"]',
        );
        const firstThesisChip = thesisGroup.locator('button.pm-rat-chip').first();
        const firstClass = (await firstThesisChip.getAttribute('class')) ?? '';
        if (
            (await firstThesisChip.isVisible()) &&
            !firstClass.includes('pm-rat-chip-add')
        ) {
            await firstThesisChip.click();
        } else {
            await panel.getByRole('button', { name: /New thesis/ }).click();
            await panel.getByPlaceholder(/Why buy/).fill('Off test');
            await panel.getByRole('button', { name: 'Create', exact: true }).click();
        }
        await panel.getByRole('button', { name: 'Breakout' }).click();
        await panel.getByLabel(/Conviction/).fill('6');
        await panel.getByRole('button', { name: /FOMO/ }).click();
        await panel.getByLabel('Rationale').fill('Rip the bandaid.');

        await page.getByRole('button', { name: /Review & buy/ }).click();

        // No cooldown should have started; order should have been
        // submitted (the rationale-submitted event is our proof).
        await expect(
            page.locator('button.pm-exec-submit[data-cooldown="true"]'),
        ).toHaveCount(0);
        const events = await page.evaluate(() => {
            return (
                window as unknown as {
                    __pmAnalytics?: { events: Array<{ name: string }> };
                }
            ).__pmAnalytics?.events ?? [];
        });
        expect(events.some((e) => e.name === 'trade.rationale.submitted')).toBe(
            true,
        );
        expect(events.some((e) => e.name === 'trade.cooldown.started')).toBe(
            false,
        );
    });
});

/**
 * AR-111 (JournalPlus): live adherence panel on the Focus variant.
 *
 * When the user links a thesis that resolves to a strategy, the Focus
 * variant shows a "Discipline check" panel below the rationale with a
 * score badge and pass/fail rows. Picking the seeded NVDA thesis on
 * the Execution page lands us on `strategy-momentum-value`, whose seed
 * adherence set has 5 rules, so the panel renders concretely.
 *
 * Hidden when no strategy resolves — e.g., the default AAPL ticker
 * has no seed thesis, and any inline-created thesis lacks a strategy
 * mapping until the user links one.
 */
test.describe('Execution page — live adherence panel (AR-111)', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            (window as unknown as {
                __pmAnalytics: { events: unknown[] };
            }).__pmAnalytics = { events: [] };
        });
        await page.goto('/execution');
        await page.evaluate(() => {
            try {
                window.localStorage.removeItem('pm-exec-variant');
                window.localStorage.removeItem('atlas-settings');
            } catch {
                /* ignore */
            }
        });
        await page.reload();
    });

    test('panel is hidden when no thesis is linked', async ({ page }) => {
        // Default AAPL ticker and no thesis selected — nothing to
        // evaluate, panel suppressed.
        await expect(page.getByTestId('adherence-live-panel')).toHaveCount(0);
    });

    test('renders with seeded NVDA thesis → Momentum + Value strategy', async ({
        page,
    }) => {
        // Switch ticker to NVDA so the seed-nvda chip appears in the
        // Thesis linkage group (seed-aapl is NOT seeded by default).
        await page.getByLabel('Ticker').fill('NVDA');

        const panel = page.getByTestId('pre-trade-rationale');
        const thesisGroup = panel.locator(
            'div[role="group"][aria-label="Thesis linkage"]',
        );
        // Pick the first real thesis chip in the group.
        const firstThesisChip = thesisGroup.locator('button.pm-rat-chip').first();
        await firstThesisChip.click();

        // The AdherencePanel should now render with 5 rules from
        // SEED_ADHERENCE_RULES['strategy-momentum-value'].
        const livePanel = page.getByTestId('adherence-live-panel');
        await expect(livePanel).toBeVisible();
        await expect(livePanel.locator('.pm-adherence-live-row')).toHaveCount(5);
    });

    test('header eyebrow names the resolved strategy', async ({ page }) => {
        await page.getByLabel('Ticker').fill('NVDA');
        const panel = page.getByTestId('pre-trade-rationale');
        const thesisGroup = panel.locator(
            'div[role="group"][aria-label="Thesis linkage"]',
        );
        await thesisGroup.locator('button.pm-rat-chip').first().click();

        const livePanel = page.getByTestId('adherence-live-panel');
        await expect(livePanel).toBeVisible();
        // Header contains "Discipline check · Momentum + Value".
        await expect(
            livePanel.locator('.pm-adherence-live-eyebrow'),
        ).toContainText('Momentum + Value');
    });

    test('score badge exposes a numeric tier data attribute', async ({ page }) => {
        await page.getByLabel('Ticker').fill('NVDA');
        const panel = page.getByTestId('pre-trade-rationale');
        const thesisGroup = panel.locator(
            'div[role="group"][aria-label="Thesis linkage"]',
        );
        await thesisGroup.locator('button.pm-rat-chip').first().click();

        const livePanel = page.getByTestId('adherence-live-panel');
        await expect(livePanel).toBeVisible();

        const score = livePanel.locator('.pm-adherence-live-score');
        const tier = await score.getAttribute('data-tier');
        expect(['top', 'good', 'ok', 'low', 'none']).toContain(tier);
    });

    test('rule rows carry tone, severity, and rule-type data attributes', async ({
        page,
    }) => {
        await page.getByLabel('Ticker').fill('NVDA');
        const panel = page.getByTestId('pre-trade-rationale');
        const thesisGroup = panel.locator(
            'div[role="group"][aria-label="Thesis linkage"]',
        );
        await thesisGroup.locator('button.pm-rat-chip').first().click();

        const livePanel = page.getByTestId('adherence-live-panel');
        await expect(livePanel).toBeVisible();
        const rows = livePanel.locator('.pm-adherence-live-row');
        const n = await rows.count();
        expect(n).toBeGreaterThan(0);

        for (let i = 0; i < n; i++) {
            const tone = await rows.nth(i).getAttribute('data-tone');
            const severity = await rows.nth(i).getAttribute('data-severity');
            const ruleType = await rows.nth(i).getAttribute('data-rule-type');
            expect(['pass', 'fail', 'neutral']).toContain(tone);
            expect(['hard', 'soft']).toContain(severity);
            expect(ruleType).toBeTruthy();
        }
    });
});
