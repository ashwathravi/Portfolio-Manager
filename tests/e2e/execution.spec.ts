import { test, expect, type Page } from '@playwright/test';
import { clickUntil, gotoAppPage, reloadAppPage } from './helpers/app';
import { researchLoaded } from './helpers/research';
import { databaseAuthEnabled, signInAsFreshUser, signInAsNewUser } from './helpers/users';

/**
 * Trade (/execution): one ticket beside the blotter.
 *
 * Launch item i53 put the ticket on the user's own data: an order is
 * drafted for one of their accounts, against its cash and positions, at
 * the last price Atlas has (a stored close, or the price stored with the
 * holding), and saved for them to place at their broker. The ticket needs
 * an account, so without a database (`npm run test:e2e`) only the "add an
 * account" state is checked; everything else runs with one (CI,
 * `npm run test:e2e:local`), as fixture user A, or a copy of them for
 * tests that save orders, theses or settings.
 *
 * User A's accounts, in name order: Dividend Income (cash 3,120), Growth
 * Portfolio (5,240) and Main Portfolio (12,450), which holds 500 AAPL
 * (stored at 182.45), MSFT, NVDA, GOOGL, TSLA and AMZN. None of those has a
 * stored close; IBM, which nobody holds, closed at 205 on the day the
 * fixtures were applied.
 */

const MAIN_PORTFOLIO = '00000000-0000-4000-8000-000000000001';
const OTHER_USERS_ACCOUNT = '00000000-0000-4000-8000-000000000009';

async function fillRiskPolicyOverride(page: Page) {
    const override = page.getByTestId('risk-policy-impact').getByLabel('Override reason');
    if (await override.isVisible()) {
        await override.fill('Intentional policy exception after reviewing allocation risk.');
    }
}

/** Types a ticker once the ticket has hydrated (it upper-cases what's typed). */
async function chooseTicker(page: Page, ticker: string) {
    const input = page.getByLabel('Ticker');
    await expect(async () => {
        await input.fill(ticker.toLowerCase());
        await expect(input).toHaveValue(ticker, { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
}

/** Picks the ticker's first thesis, or writes one, then the rest of the rationale. */
async function completeRationale(
    page: Page,
    { setup = 'Breakout', conviction = '7', mood = /Focused/, text = 'Gap up on upgrade, riding momentum into close.' }:
        { setup?: string; conviction?: string; mood?: RegExp; text?: string } = {},
) {
    const panel = page.getByTestId('pre-trade-rationale');
    // The chips are toggle buttons (`aria-pressed`), not radios: the list has
    // no roving tabindex, so "radio" would mislead screen readers.
    const thesisGroup = panel.locator('div[role="group"][aria-label="Thesis linkage"]');
    const firstThesisChip = thesisGroup.locator('button.pm-rat-chip').first();
    const firstClass = (await firstThesisChip.getAttribute('class')) ?? '';
    if ((await firstThesisChip.isVisible()) && !firstClass.includes('pm-rat-chip-add')) {
        await firstThesisChip.click();
    } else {
        await panel.getByRole('button', { name: /New thesis/ }).click();
        await panel.getByPlaceholder(/Why buy/).fill('Margin expansion 2026');
        await panel.getByRole('button', { name: 'Create', exact: true }).click();
    }
    await panel.getByRole('button', { name: setup }).click();
    await panel.getByLabel(/Conviction/).fill(conviction);
    await panel.getByRole('button', { name: mood }).click();
    await expect(panel.getByRole('button', { name: mood })).toHaveAttribute('aria-pressed', 'true');
    await panel.getByLabel('Rationale').fill(text);
    await expect(panel.getByLabel('Rationale')).toHaveValue(text);
}

async function analyticsEvents(page: Page): Promise<string[]> {
    return page.evaluate(() => (
        (window as unknown as { __pmAnalytics?: { events: Array<{ name: string }> } }).__pmAnalytics?.events ?? []
    ).map((e) => e.name));
}

/** Loads Trade once the user's theses have loaded (the rationale lists them). */
async function openTicket(page: Page, path = '/execution') {
    const loaded = researchLoaded(page, 'theses');
    await gotoAppPage(page, path);
    await loaded;
}

const blotterRows = (page: Page) => page.locator('.pm-exec-table tbody tr[data-order-id]');

test.describe('Trade without an account', () => {
    test('says to add an account first, with no example orders or prices', async ({ context, page }) => {
        // Without a database there are no accounts either.
        await signInAsNewUser(context);
        await gotoAppPage(page, '/execution');
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Trade');
        const card = page.getByTestId('trade-needs-account');
        await expect(card.getByRole('heading', { name: 'Add an account to draft orders' })).toBeVisible();
        await expect(card).toContainText('Atlas never places orders');
        await expect(card.getByRole('link', { name: 'Add an account' })).toHaveAttribute('href', '/portfolios/accounts');
        await expect(page.locator('.pm-exec-form')).toHaveCount(0);
        await expect(page.getByTestId('sample-data-notice')).toHaveCount(0);
    });
});

test.describe('Trade ticket on the user\'s accounts', () => {
    test.skip(!databaseAuthEnabled, 'accounts, prices and orders are in the database');

    test.beforeEach(async ({ page }) => {
        await gotoAppPage(page, '/execution');
    });

    test('one ticket design, on the user\'s accounts, with no example data', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Trade');
        await expect(page.locator('.pm-variant-switch')).toHaveCount(0);
        await expect(page.locator('.pm-exec-page[data-variant="focus"]')).toBeVisible();
        await expect(page.getByTestId('sample-data-notice')).toHaveCount(0);

        const account = page.getByLabel('Account', { exact: true });
        await expect(account.locator('option')).toHaveText(['Dividend Income', 'Growth Portfolio', 'Main Portfolio']);
        // It opens on the account with positions.
        await expect(account).toHaveValue(MAIN_PORTFOLIO);

        await expect(page.getByRole('heading', { name: 'New order' })).toBeVisible();
        await expect(page.getByText('Saved for you to place at your broker. Atlas never places orders.')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
    });

    test('regression: the dead "Save draft" button is gone; the summary bar names the order', async ({ page }) => {
        await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
        await expect(page.getByLabel('Ticker')).toHaveValue('');
        await expect(page.locator('.pm-exec-foot-summary')).toHaveText('Buy 1 —');
        await chooseTicker(page, 'AAPL');
        await expect(page.locator('.pm-exec-foot-summary')).toHaveText('Buy 1 AAPL');
    });

    test('side toggle defaults to Buy and switches to Sell on click', async ({ page }) => {
        const sideTabs = page.locator('.pm-exec-side');
        await expect(sideTabs.getByRole('tab', { name: 'Buy' })).toHaveAttribute('aria-selected', 'true');
        await expect(sideTabs.getByRole('tab', { name: 'Sell' })).toHaveAttribute('aria-selected', 'false');
        await sideTabs.getByRole('tab', { name: 'Sell' }).click();
        await expect(sideTabs.getByRole('tab', { name: 'Sell' })).toHaveAttribute('aria-selected', 'true');
    });

    test('a limit order for one share by default, for the day', async ({ page }) => {
        await expect(page.getByLabel('Quantity')).toHaveValue('1');
        await expect(page.getByLabel('Order type')).toHaveValue('limit');
        const tif = page.locator('.pm-exec-tif');
        await expect(tif.getByRole('tab', { name: 'DAY' })).toHaveAttribute('aria-selected', 'true');
        for (const opt of ['GTC', 'IOC', 'FOK']) {
            await expect(tif.getByRole('tab', { name: opt })).toBeVisible();
        }
    });

    test('a held ticker is priced at the price stored with the holding, and the limit starts there', async ({ page }) => {
        await chooseTicker(page, 'AAPL');
        await expect(page.getByTestId('ticker-price')).toHaveText('$182.45');
        await expect(page.getByTestId('ticker-price-note')).toHaveText('Price stored with your holding');
        await expect(page.getByLabel('Limit price')).toHaveValue('182.45');
        // Main Portfolio holds 500.
        await expect(page.locator('.pm-exec-preview')).toContainText('501 sh');
    });

    test('a ticker the user doesn\'t hold is priced at its last stored close, never as live', async ({ page }) => {
        await chooseTicker(page, 'IBM');
        await expect(page.getByTestId('ticker-price')).toHaveText('$205.00');
        await expect(page.getByTestId('ticker-price-note')).toHaveText(/close/);
        await expect(page.getByLabel('Limit price')).toHaveValue('205');
        await expect(page.locator('.pm-exec-preview')).toContainText('1 sh');
    });

    test('a market order without any price is refused: it needs a limit to be sized', async ({ page }) => {
        await chooseTicker(page, 'ZZZZ');
        await expect(page.getByTestId('ticker-price-note')).toHaveText('No price yet');
        await page.getByLabel('Order type').selectOption('market');
        await expect(page.locator('.pm-exec-guardrails')).toContainText('No price for ZZZZ yet. Use a limit order to size it.');
        await page.getByLabel('Order type').selectOption('limit');
        await page.getByLabel('Limit price').fill('12');
        await expect(page.locator('.pm-exec-guardrails')).not.toContainText('No price for ZZZZ');
    });

    test('the preview shows the account\'s cash and position after the order', async ({ page }) => {
        const preview = page.locator('.pm-exec-preview');
        await expect(preview.getByText('Notional')).toBeVisible();
        await expect(preview.getByText('Cash after')).toBeVisible();
        await expect(preview.getByText('Position after')).toBeVisible();
        // No made-up rows: Atlas doesn't know the broker's commission, or a sector cap or volatility.
        await expect(preview).not.toContainText('commission');
        await expect(page.locator('.pm-exec-guardrails')).not.toContainText('Sector cap');
        await expect(page.locator('.pm-exec-guardrails')).not.toContainText('Volatility');

        await chooseTicker(page, 'AAPL');
        await page.getByLabel('Quantity').fill('10');
        // 10 × 182.45 from Main Portfolio's 12,450.
        await expect(preview).toContainText('$10,625.50');
        await expect(preview).toContainText('510 sh');

        await page.getByLabel('Account', { exact: true }).selectOption({ label: 'Growth Portfolio' });
        await expect(preview).toContainText('$3,415.50');
        await expect(preview).toContainText('10 sh');
        await expect(page.locator('.pm-exec-guardrails')).toContainText('$3,415.50 left in Growth Portfolio');

        // Growth Portfolio holds no AAPL: selling it would open a short.
        await page.locator('.pm-exec-side').getByRole('tab', { name: 'Sell' }).click();
        await expect(page.locator('.pm-exec-guardrails')).toContainText('Would open 10 share short in Growth Portfolio');

        // A buy bigger than the account's cash warns but doesn't block: the cash may not be tracked here.
        await page.locator('.pm-exec-side').getByRole('tab', { name: 'Buy' }).click();
        await page.getByLabel('Quantity').fill('100');
        const cash = page.locator('.pm-exec-guardrail').filter({ has: page.locator('.pm-exec-guardrail-label', { hasText: /^Cash$/ }) });
        await expect(cash).toContainText("$13,005.00 more than Growth Portfolio's cash");
        await expect(cash).toHaveClass(/is-warn/);
    });

    test('blotter exposes All / Ready / Placed / Cancelled filter chips', async ({ page }) => {
        const chips = page.locator('.pm-exec-chips');
        for (const label of ['All', 'Ready', 'Placed', 'Cancelled']) {
            await expect(chips.getByRole('tab', { name: new RegExp(`^${label}`) })).toBeVisible();
        }
    });

    test('option orders show failed policy checks until thesis and max loss are documented', async ({ page }) => {
        await page.getByRole('tab', { name: 'Option / LEAPS' }).click();

        await chooseTicker(page, 'RIVN');
        await page.getByLabel('Quantity').fill('50');
        await page.getByLabel('Limit price').fill('5');
        await page.getByLabel('Option strike').fill('25');
        await page.getByLabel('Option expiry').fill('2027-01-16');

        const optionPanel = page.getByRole('region', { name: 'Options policy details' });
        await expect(optionPanel).toBeVisible();
        await expect(optionPanel).toContainText('Premium at risk');
        await expect(optionPanel).toContainText('Notional equivalent');

        const guardrails = page.locator('.pm-exec-guardrails');
        await expect(guardrails.getByText('Options thesis')).toBeVisible();
        await expect(guardrails.getByText('Max loss ack')).toBeVisible();
        await expect(guardrails.getByText('Position size')).toBeVisible();

        await expect(page.getByRole('button', { name: /Save buy order/ })).toBeDisabled();
    });

    test('risk policy blocks an add that worsens breached concentration until an override is captured', async ({ page }) => {
        await chooseTicker(page, 'NVDA');
        await page.getByLabel('Quantity').fill('10');
        await page.getByLabel('Limit price').fill('500');

        const policy = page.getByTestId('risk-policy-impact');
        await expect(policy).toBeVisible();
        await expect(policy).toContainText('Override needed');
        await expect(policy).toContainText('Now');
        await expect(policy).toContainText('Post');
        await expect(policy).toContainText('Limit');
        await expect(policy.getByLabel('Override reason')).toBeVisible();

        await expect(page.getByRole('button', { name: /Save buy order/ })).toBeDisabled();

        await policy.getByLabel('Override reason').fill('Intentional policy exception after reviewing allocation risk.');
        await expect(policy).toContainText('override captured');
    });

    test('risk policy permits a trim that reduces breached exposure', async ({ page }) => {
        await page.locator('.pm-exec-side').getByRole('tab', { name: 'Sell' }).click();
        await chooseTicker(page, 'NVDA');
        await page.getByLabel('Quantity').fill('10');
        await page.getByLabel('Limit price').fill('500');

        const policy = page.getByTestId('risk-policy-impact');
        await expect(policy).toContainText('Reducing');
        await expect(policy).toContainText('Risk-reducing trade under current policy');
        await expect(policy.getByLabel('Override reason')).toHaveCount(0);
        await expect(page.locator('.pm-exec-guardrails')).toContainText('Risk policy');
    });
});

/**
 * Saving orders (launch item i53): a plan is kept with the account, waits
 * for approval over the user's threshold, and is marked placed or
 * cancelled from the blotter.
 */
test.describe('Trade › saving orders', () => {
    test.skip(!databaseAuthEnabled, 'orders are saved in the database');

    // These save orders and theses: each test has a user of its own.
    test.beforeEach(async ({ context }) => {
        await signInAsFreshUser(context);
    });

    test('a saved order is ready to place, survives a reload, and is marked placed, then cancelled', async ({ page }) => {
        await openTicket(page);
        await expect(page.locator('.pm-exec-empty')).toHaveText('No orders yet. Orders you save appear here.');
        await chooseTicker(page, 'AAPL');
        await page.getByLabel('Quantity').fill('2');
        await completeRationale(page);
        await fillRiskPolicyOverride(page);
        await page.getByRole('button', { name: /Save buy order/ }).click();

        const row = blotterRows(page).first();
        await expect(row).toContainText('AAPL');
        await expect(row).toContainText('Main Portfolio');
        await expect(row).toContainText('$182.45');
        await expect(row.locator('.pm-exec-status')).toHaveText('Ready to place');
        await expect(page.locator('.pm-exec-table-rationale-row').first()).toContainText('Gap up on upgrade');
        // The next ticket starts with a fresh rationale.
        await expect(page.getByTestId('pre-trade-rationale').getByLabel('Rationale')).toHaveValue('');

        await reloadAppPage(page);
        await expect(blotterRows(page)).toHaveCount(1);
        await expect(blotterRows(page).first().locator('.pm-exec-status')).toHaveText('Ready to place');

        await page.getByRole('button', { name: 'Mark AAPL order placed' }).click();
        await expect(blotterRows(page).first().locator('.pm-exec-status')).toHaveText('Placed');
        await expect(page.locator('.pm-exec-chips').getByRole('tab', { name: /^Placed/ })).toContainText('1');

        // Cancelled at the broker before it filled.
        await page.getByRole('button', { name: 'Cancel AAPL order' }).click();
        await expect(blotterRows(page).first().locator('.pm-exec-status')).toHaveText('Cancelled');
        await expect(page.getByRole('button', { name: 'Cancel AAPL order' })).toHaveCount(0);

        await reloadAppPage(page);
        await expect(blotterRows(page).first().locator('.pm-exec-status')).toHaveText('Cancelled');
    });

    test('an order over the approval threshold waits for approval, then is ready to place', async ({ page }) => {
        await openTicket(page);
        // 150 IBM at its 205 close is over the default $25,000 threshold.
        await chooseTicker(page, 'IBM');
        await expect(page.getByLabel('Limit price')).toHaveValue('205');
        await page.getByLabel('Quantity').fill('150');
        await completeRationale(page);
        await fillRiskPolicyOverride(page);
        await page.getByRole('button', { name: /Save buy order/ }).click();

        const queue = page.getByRole('region', { name: 'Approval queue' });
        await expect(queue).toContainText('1 order needs your approval');
        await expect(queue).toContainText('Over your $25,000 approval threshold');
        await expect(queue).toContainText('$30,750.00');
        await expect(blotterRows(page).first().locator('.pm-exec-status')).toHaveText('Needs approval');

        await queue.getByRole('button', { name: 'Approve' }).click();
        await expect(queue).toHaveCount(0);
        await expect(blotterRows(page).first().locator('.pm-exec-status')).toHaveText('Ready to place');
    });

    test('the order API saves only to your own accounts and changes only your own orders', async ({ context, page, playwright }) => {
        await gotoAppPage(page, '/execution');
        const plan = {
            portfolioId: OTHER_USERS_ACCOUNT,
            instrumentType: 'equity',
            ticker: 'IBM',
            side: 'buy',
            type: 'limit',
            quantity: 1,
            limitPrice: 200,
            timeInForce: 'day',
            needsApproval: false,
        };
        const invalid = await page.request.post('/api/orders', { data: { ...plan, limitPrice: undefined } });
        expect(invalid.status()).toBe(400);
        expect(await invalid.json()).toEqual({ error: 'limitPrice: A limit order needs a limit price', code: 'INVALID_ORDER' });

        // User A's account and another user's: neither is this user's.
        for (const portfolioId of [OTHER_USERS_ACCOUNT, MAIN_PORTFOLIO]) {
            const notYours = await page.request.post('/api/orders', { data: { ...plan, portfolioId } });
            expect(notYours.status()).toBe(404);
            expect((await notYours.json()).code).toBe('PORTFOLIO_NOT_FOUND');
        }

        const ownAccount = await page.getByLabel('Account', { exact: true }).inputValue();
        const saved = await page.request.post('/api/orders', { data: { ...plan, portfolioId: ownAccount } });
        expect(saved.status()).toBe(201);
        const order = (await saved.json()).data;
        expect(order).toMatchObject({ ticker: 'IBM', status: 'ready', portfolioId: ownAccount });

        const filled = await page.request.patch(`/api/orders/${order.id}`, { data: { status: 'filled' } });
        expect(filled.status()).toBe(400);

        // Another user can't see or change it.
        await signInAsFreshUser(context);
        const other = await page.request.patch(`/api/orders/${order.id}`, { data: { status: 'cancelled' } });
        expect(other.status()).toBe(404);
        expect((await other.json()).code).toBe('ORDER_NOT_FOUND');

        const anonymous = await playwright.request.newContext({
            baseURL: 'http://localhost:3000',
            storageState: { cookies: [], origins: [] },
        });
        expect((await anonymous.post('/api/orders', { data: { ...plan, portfolioId: ownAccount } })).status()).toBe(401);
        expect((await anonymous.patch(`/api/orders/${order.id}`, { data: { status: 'cancelled' } })).status()).toBe(401);
        await anonymous.dispose();
    });
});

/**
 * AR-109 (JournalPlus): pre-trade rationale capture.
 *
 * The ticket gates Submit behind a completed rationale panel when
 * `execution.rationaleRequired` is true (the default). These tests
 * exercise the rendering, the gate, the analytics event path, and the
 * settings override.
 */
test.describe('Execution page — pre-trade rationale (AR-109)', () => {
    test.skip(!databaseAuthEnabled, 'the ticket needs the user\'s accounts');

    // These may create a thesis and save an order: each test has a user of its own.
    test.beforeEach(async ({ context, page }) => {
        await signInAsFreshUser(context);
        await page.addInitScript(() => {
            (window as unknown as { __pmAnalytics: { events: unknown[] } }).__pmAnalytics = { events: [] };
        });
        await openTicket(page);
        await chooseTicker(page, 'AAPL');
    });

    test('renders the rationale panel on the ticket by default', async ({ page }) => {
        await expect(page.getByTestId('pre-trade-rationale')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Why this trade?' })).toBeVisible();
    });

    test('Submit stays disabled until the rationale is complete', async ({ page }) => {
        const submit = page.getByRole('button', { name: /Save buy order/ });
        await expect(submit).toBeDisabled();
        await completeRationale(page);
        await fillRiskPolicyOverride(page);
        await expect(submit).toBeEnabled();
    });

    test('overshooting the 240-char limit flags the counter', async ({ page }) => {
        const panel = page.getByTestId('pre-trade-rationale');
        await panel.getByLabel('Rationale').fill('x'.repeat(245));
        await expect(panel.locator('.pm-rat-counter.is-over')).toBeVisible();
    });

    test('saving fires the trade.rationale.submitted analytics event', async ({ page }) => {
        await completeRationale(page, { setup: 'Conviction add', conviction: '6', mood: /Calm/, text: 'Adding to winner on pullback.' });
        await fillRiskPolicyOverride(page);
        await page.getByRole('button', { name: /Save buy order/ }).click();
        // Once the server has the order.
        await expect.poll(() => analyticsEvents(page)).toContain('trade.rationale.submitted');
        await expect(blotterRows(page)).toHaveCount(1);
    });

    test('disabling the rationale requirement in Settings lifts the gate', async ({ page }) => {
        await gotoAppPage(page, '/settings');
        const toggle = page.getByLabel('Toggle pre-trade rationale requirement');
        await expect(toggle).toBeChecked();
        // Settings sections hydrate inside a Suspense boundary; retry until handlers attach.
        await clickUntil(toggle, async () => {
            await expect(toggle).not.toBeChecked({ timeout: 1000 });
        });

        // Back on Trade the panel is gone: only the order and policy checks gate Submit.
        await gotoAppPage(page, '/execution');
        await expect(page.getByTestId('pre-trade-rationale')).toHaveCount(0);
        await chooseTicker(page, 'AAPL');
        await fillRiskPolicyOverride(page);
        await expect(page.getByRole('button', { name: /Save buy order/ })).toBeEnabled();
    });
});

/**
 * AR-110 (Mood cooldown nudge): caution moods (fomo / revenge) trigger a
 * cooldown timer on the Submit button. First press starts the timer
 * instead of firing; the button stays locked until the timer expires, then
 * the user can press again to actually submit.
 */
test.describe('Execution page — caution-mood cooldown (AR-110)', () => {
    test.skip(!databaseAuthEnabled, 'the ticket needs the user\'s accounts');

    // These may create a thesis, change settings and save an order: each test has a user of its own.
    test.beforeEach(async ({ context, page }) => {
        await signInAsFreshUser(context);
        await page.addInitScript(() => {
            (window as unknown as { __pmAnalytics: { events: unknown[] } }).__pmAnalytics = { events: [] };
        });
        await openTicket(page);
        await chooseTicker(page, 'AAPL');
    });

    test('pressing Submit with mood=FOMO starts the cooldown timer instead of firing', async ({ page }) => {
        await completeRationale(page, { conviction: '6', mood: /FOMO/, text: 'Chasing the pump, fully aware.' });
        await fillRiskPolicyOverride(page);

        const submit = page.getByRole('button', { name: /Save buy order/ });
        await expect(submit).toBeEnabled();
        await submit.click();

        // One press: the button is disabled and counts down.
        const cooldownBtn = page.locator('button.pm-exec-submit[data-cooldown="true"]');
        await expect(cooldownBtn).toBeVisible();
        await expect(cooldownBtn).toBeDisabled();
        await expect(cooldownBtn).toContainText(/Hold on/);

        const events = await analyticsEvents(page);
        expect(events).toContain('trade.cooldown.started');
        // Nothing saved yet: the first press only starts the timer.
        expect(events).not.toContain('trade.rationale.submitted');
        await expect(blotterRows(page)).toHaveCount(0);
    });

    test('switching away from caution mood mid-cooldown clears the lock', async ({ page }) => {
        await completeRationale(page, { mood: /Revenge/, text: 'Getting it back from last week.' });
        await fillRiskPolicyOverride(page);

        await page.getByRole('button', { name: /Save buy order/ }).click();
        await expect(page.locator('button.pm-exec-submit[data-cooldown="true"]')).toBeVisible();

        // Switching to "Focused" clears the cooldown.
        await page.getByTestId('pre-trade-rationale').getByRole('button', { name: /Focused/ }).click();
        await fillRiskPolicyOverride(page);
        await expect(page.locator('button.pm-exec-submit[data-cooldown="true"]')).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Save buy order/ })).toBeEnabled();
    });

    test('setting cooldown to Off in Settings bypasses the timer', async ({ page }) => {
        await gotoAppPage(page, '/settings');
        const group = page.getByRole('radiogroup', { name: /Mood cooldown duration/ });
        await expect(group).toBeVisible();
        await clickUntil(group.getByRole('radio', { name: 'Off' }), async () => {
            await expect(group.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true', { timeout: 1000 });
        });

        // Back on Trade a FOMO rationale saves at once: no countdown.
        await openTicket(page);
        await chooseTicker(page, 'AAPL');
        await completeRationale(page, { conviction: '6', mood: /FOMO/, text: 'Rip the bandaid.' });
        await fillRiskPolicyOverride(page);

        const submit = page.getByRole('button', { name: /Save buy order/ });
        await expect(submit).toBeEnabled();
        await submit.click();

        await expect(page.locator('button.pm-exec-submit[data-cooldown="true"]')).toHaveCount(0);
        await expect.poll(() => analyticsEvents(page)).toContain('trade.rationale.submitted');
        expect(await analyticsEvents(page)).not.toContain('trade.cooldown.started');
    });
});

/**
 * AR-111 (JournalPlus): live adherence panel on the ticket.
 *
 * When the user links a thesis that resolves to a strategy, the ticket
 * shows a "Discipline check" panel below the rationale with a score badge
 * and pass/fail rows. The example NVDA thesis lands on
 * `strategy-momentum-value`, whose example adherence set has 5 rules.
 * (Strategies are still examples until launch item i55.)
 *
 * Hidden when no strategy resolves — e.g., before a thesis is linked.
 */
test.describe('Execution page — live adherence panel (AR-111)', () => {
    test.skip(!databaseAuthEnabled, 'the ticket needs the user\'s accounts');

    // These may create a thesis: each test has a user of its own.
    test.beforeEach(async ({ context, page }) => {
        await signInAsFreshUser(context);
        await openTicket(page);
    });

    async function linkNvdaThesis(page: Page) {
        // The example NVDA thesis shows among the NVDA chips.
        await chooseTicker(page, 'NVDA');
        const thesisGroup = page.getByTestId('pre-trade-rationale').locator('div[role="group"][aria-label="Thesis linkage"]');
        await thesisGroup.locator('button.pm-rat-chip').first().click();
        const livePanel = page.getByTestId('adherence-live-panel');
        await expect(livePanel).toBeVisible();
        return livePanel;
    }

    test('panel is hidden when no thesis is linked', async ({ page }) => {
        await chooseTicker(page, 'AAPL');
        await expect(page.getByTestId('adherence-live-panel')).toHaveCount(0);
    });

    test('renders with the example NVDA thesis → Momentum + Value strategy', async ({ page }) => {
        const livePanel = await linkNvdaThesis(page);
        await expect(livePanel.locator('.pm-adherence-live-row')).toHaveCount(5);
        // Header contains "Discipline check · Momentum + Value".
        await expect(livePanel.locator('.pm-adherence-live-eyebrow')).toContainText('Momentum + Value');
    });

    test('score badge and rule rows carry their tier, tone, severity and rule type', async ({ page }) => {
        const livePanel = await linkNvdaThesis(page);
        const tier = await livePanel.locator('.pm-adherence-live-score').getAttribute('data-tier');
        expect(['top', 'good', 'ok', 'low', 'none']).toContain(tier);

        const rows = livePanel.locator('.pm-adherence-live-row');
        const n = await rows.count();
        expect(n).toBeGreaterThan(0);
        for (let i = 0; i < n; i++) {
            expect(['pass', 'fail', 'neutral']).toContain(await rows.nth(i).getAttribute('data-tone'));
            expect(['hard', 'soft']).toContain(await rows.nth(i).getAttribute('data-severity'));
            expect(await rows.nth(i).getAttribute('data-rule-type')).toBeTruthy();
        }
    });
});

test.describe('Trade — keyboard mode', () => {
    test.skip(!databaseAuthEnabled, 'the ticket needs the user\'s accounts');

    test.beforeEach(async ({ page }) => {
        await gotoAppPage(page, '/execution');
        await page.locator('.pm-exec-form-title').click();
        // Wait for hydration: the listener only exists once the ticket mounts.
        const sell = page.locator('.pm-exec-side').getByRole('tab', { name: 'Sell' });
        await expect(async () => {
            await page.keyboard.press('s');
            await expect(sell).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
    });

    test('B and S switch the side; M and L switch the order type', async ({ page }) => {
        const side = page.locator('.pm-exec-side');
        await page.keyboard.press('b');
        await expect(side.getByRole('tab', { name: 'Buy' })).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('m');
        await expect(page.getByLabel('Order type')).toHaveValue('market');
        await expect(page.getByLabel('Limit price')).toHaveCount(0);
        await page.keyboard.press('l');
        await expect(page.getByLabel('Order type')).toHaveValue('limit');
    });

    test('regression: typing a ticker never flips the side', async ({ page }) => {
        await page.keyboard.press('t');
        await expect(page.getByLabel('Ticker')).toBeFocused();
        await page.keyboard.type('bb');
        await expect(page.getByLabel('Ticker')).toHaveValue('BB');
        await expect(page.locator('.pm-exec-side').getByRole('tab', { name: 'Sell' })).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('Escape');
        await expect(page.getByLabel('Ticker')).not.toBeFocused();
    });

    test('? opens the shortcut sheet and Escape closes it', async ({ page }) => {
        await page.keyboard.press('?');
        const sheet = page.getByRole('region', { name: 'Keyboard shortcuts' });
        await expect(sheet).toContainText('Review order');
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await page.getByRole('button', { name: /Shortcuts/ }).click();
        await expect(sheet).toBeVisible();
    });

    test('⌘/Ctrl+Enter still respects the rationale gate', async ({ page }) => {
        await page.keyboard.press('t');
        await page.keyboard.type('AAPL');
        await page.keyboard.press('Escape');
        const submit = page.getByRole('button', { name: /Save sell order/ });
        await expect(submit).toBeDisabled();
        const before = await blotterRows(page).count();
        await page.keyboard.press('q');
        await page.keyboard.press('ControlOrMeta+Enter');
        await expect(blotterRows(page)).toHaveCount(before);
    });
});

test.describe('Trade — prefilled ticket', () => {
    test.skip(!databaseAuthEnabled, 'the ticket needs the user\'s accounts');

    test('?symbol=&side= pre-fills the order ticket, on the account holding it', async ({ page }) => {
        await gotoAppPage(page, '/execution?symbol=nvda&side=sell');
        await expect(page.getByLabel('Ticker')).toHaveValue('NVDA');
        await expect(page.locator('.pm-exec-side').getByRole('tab', { name: 'Sell' })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByLabel('Account', { exact: true })).toHaveValue(MAIN_PORTFOLIO);
    });

    test('an invalid symbol is ignored', async ({ page }) => {
        await gotoAppPage(page, '/execution?symbol=%3Cscript%3E');
        await expect(page.getByLabel('Ticker')).toHaveValue('');
    });
});

test.describe('Trade — phone layout', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('regression: the ticket fits the viewport without sideways scrolling', async ({ page }) => {
        await gotoAppPage(page, '/execution');
        const overflow = await page.evaluate(() => {
            const main = document.querySelector('main');
            return main ? main.scrollWidth - main.clientWidth : 0;
        });
        expect(overflow).toBeLessThanOrEqual(1);
    });
});

/**
 * Launch item i54: the ticket's risk-policy checks run on the user's own
 * holdings and the theses they wrote, not example data.
 */
test.describe('Trade › risk policy on the user\'s own portfolio', () => {
    test.skip(!databaseAuthEnabled, 'the holdings and theses are in the database');

    // These change settings and write theses: each test has a user of its own.
    test.beforeEach(async ({ context }) => {
        await signInAsFreshUser(context);
    });

    test('the checks see the user\'s holdings: TSLA is already over the speculative cap', async ({ page }) => {
        await gotoAppPage(page, '/execution');
        await chooseTicker(page, 'TSLA');
        await page.getByLabel('Quantity').fill('1');
        await page.getByLabel('Limit price').fill('250');

        const policy = page.getByTestId('risk-policy-impact');
        await expect(policy).toContainText('Override needed');
        await expect(policy).toContainText('Speculative/options cap');
        // User A's TSLA is 12% of their portfolio and cash.
        await expect(policy).toContainText(/worsens from 12(\.\d)?%/);
    });

    test('regression: a no-add rule for a ticker without a thesis lifts once the user writes one', async ({ page }) => {
        await gotoAppPage(page, '/settings');
        // Settings sections hydrate inside a Suspense boundary, and a form
        // filled before then is reset: the ticker field upper-cases what's
        // typed once it's hydrated.
        const ticker = page.getByLabel('Sell discipline ticker');
        await expect(async () => {
            await ticker.fill('amzn');
            await expect(ticker).toHaveValue('AMZN', { timeout: 500 });
        }).toPass({ timeout: 10_000 });
        await page.getByLabel('Sell discipline trigger type').selectOption('missing_thesis_no_add');
        await page.getByLabel('Sell discipline action').selectOption('no_add');
        await page.getByRole('button', { name: 'Add sell rule' }).click();
        const rule = page.getByTestId('sell-discipline-rule').filter({ hasText: 'AMZN Missing thesis no-add' });
        await expect(rule).toHaveCount(1);
        await expect(rule).toHaveAttribute('data-state', 'triggered');

        await openTicket(page);
        await chooseTicker(page, 'AMZN');
        await page.getByLabel('Quantity').fill('1');
        await page.getByLabel('Limit price').fill('170');
        const guardrails = page.locator('.pm-exec-guardrails');
        await expect(guardrails).toContainText('No-add rule triggered: AMZN Missing thesis no-add');

        // The thesis the user writes here is the one the rule looks for.
        const panel = page.getByTestId('pre-trade-rationale');
        await panel.getByRole('button', { name: /New thesis/ }).click();
        await panel.getByPlaceholder(/Why buy AMZN\?/).fill('AWS margins keep compounding');
        await panel.getByRole('button', { name: 'Create', exact: true }).click();
        await expect(guardrails).not.toContainText('No-add rule triggered: AMZN');
    });
});
