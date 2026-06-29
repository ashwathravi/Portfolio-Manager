import { test, expect } from '@playwright/test';
import { clickUntil, gotoAppPage, reloadAppPage } from './helpers/app';

/**
 * Phase 9 (AR-94) Settings tests, refreshed for JournalPlus (AR-109).
 *
 * Phase 8 (AR-87/88/89) replaced the old horizontal-tabs surface with
 * a card grid. AR-109 added a fifth card — Execution — to host the
 * "Require pre-trade rationale" toggle. The default `/settings` now
 * renders `SettingsPageClient` with ProfileCard, IntegrationsCard,
 * AppearanceCard, GuardrailsCard, ExecutionCard, and CashJobsCard plus
 * an "Advanced settings" section linking to the legacy tabbed surface at
 * `/settings?tab=<slug>`. Those legacy flows remain reachable so
 * notifications, API keys, data & privacy, and tags can still be
 * managed until they get their own cards.
 */

test.describe('Settings page (v2 card grid)', () => {
    test.beforeEach(async ({ page }) => {
        await gotoAppPage(page, '/settings');
    });

    test('renders Topbar title and the primary cards', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Settings');

        // Grid container (single `role="list"`-like semantics).
        await expect(page.locator('.pm-settings-grid')).toBeVisible();

        // Each primary card by its card title.
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Profile$/ })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Connected accounts$/i })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Appearance$/ })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Guardrails$/ })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Execution$/ })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Bucket policy$/ })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^GOOG de-risking$/ })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Trading activity$/ })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Cash jobs$/ })).toBeVisible();
        await expect(page.locator('.pm-settings-card-title', { hasText: /^Sell discipline$/ })).toBeVisible();
    });

    test('exposes an Advanced settings section linking to legacy tabs', async ({ page }) => {
        // Section landmark uses the aria-labelledby heading.
        await expect(page.locator('h2#pm-settings-advanced-head')).toHaveText('Advanced settings');

        // Each advanced link should link out to /settings?tab=<slug>.
        const advanced = page.locator('.pm-settings-advanced-grid');
        await expect(advanced.locator('a[href="/settings?tab=notifications"]')).toBeVisible();
        await expect(advanced.locator('a[href="/settings?tab=alerts"]')).toBeVisible();
        await expect(advanced.locator('a[href="/settings?tab=api-keys"]')).toBeVisible();
        await expect(advanced.locator('a[href="/settings?tab=security"]')).toBeVisible();
        await expect(advanced.locator('a[href="/settings?tab=data"]')).toBeVisible();
        await expect(advanced.locator('a[href="/settings?tab=tags"]')).toBeVisible();
    });

    test('Plaid Link flow discovers and connects selected accounts', async ({ page }) => {
        await page.route('**/api/plaid/link-token', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    linkToken: 'link-sandbox-e2e',
                    expiration: '2026-05-16T09:00:00Z',
                    requestId: 'request-link-e2e',
                    environment: 'sandbox',
                    products: ['investments', 'transactions'],
                }),
            });
        });
        await page.route('**/api/plaid/exchange-public-token', async (route) => {
            const payload = route.request().postDataJSON() as { publicToken?: string; metadata?: unknown };
            expect(payload.publicToken).toBe('public-sandbox-e2e');
            expect(payload.metadata).toBeTruthy();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    itemId: 'item-plaid-sandbox-investments',
                    institution: {
                        id: 'ins_109508',
                        name: 'Plaid Sandbox Investments',
                    },
                    accounts: [
                        plaidE2EAccount({
                            plaidAccountId: 'plaid-growth-brokerage',
                            name: 'Plaid Growth Brokerage',
                            subtype: 'brokerage',
                            currentBalance: 125430,
                        }),
                        plaidE2EAccount({
                            plaidAccountId: 'plaid-roth-ira',
                            name: 'Plaid Roth IRA',
                            subtype: 'roth',
                            currentBalance: 84320,
                        }),
                        plaidE2EAccount({
                            plaidAccountId: 'plaid-cash-management',
                            name: 'Plaid Cash Management',
                            type: 'depository',
                            subtype: 'checking',
                            currentBalance: 24000,
                            capabilities: ['balances', 'transactions'],
                        }),
                    ],
                    duplicatePlaidAccountIds: [],
                    accessTokenStored: true,
                    accessTokenStorageMode: 'postgres',
                    accessTokenStorageDurable: true,
                    requestId: 'request-exchange-e2e',
                }),
            });
        });
        await page.addInitScript(() => {
            const w = window as unknown as {
                Plaid: {
                    create: (options: {
                        onSuccess: (publicToken: string, metadata: unknown) => void;
                    }) => { open: () => void; destroy: () => void };
                };
            };
            w.Plaid = {
                create: (options) => ({
                    open: () => {
                        options.onSuccess('public-sandbox-e2e', {
                            institution: {
                                name: 'Plaid Sandbox Investments',
                                institution_id: 'ins_109508',
                            },
                            accounts: [
                                {
                                    id: 'plaid-growth-brokerage',
                                    name: 'Plaid Growth Brokerage',
                                    mask: '0000',
                                    type: 'investment',
                                    subtype: 'brokerage',
                                },
                                {
                                    id: 'plaid-roth-ira',
                                    name: 'Plaid Roth IRA',
                                    mask: '1111',
                                    type: 'investment',
                                    subtype: 'roth',
                                },
                                {
                                    id: 'plaid-cash-management',
                                    name: 'Plaid Cash Management',
                                    mask: '2222',
                                    type: 'depository',
                                    subtype: 'checking',
                                },
                            ],
                            link_session_id: 'link-session-e2e',
                        });
                    },
                    destroy: () => undefined,
                }),
            };
        });

        await page.evaluate(() => window.localStorage.removeItem('atlas-settings'));
        await reloadAppPage(page);

        const card = page.getByTestId('integrations-card');
        await expect(card).toBeVisible();

        await card.getByRole('button', { name: /^Connect$/ }).click();
        const panel = card.getByTestId('plaid-link-panel');
        await expect(panel).toHaveAttribute('data-state', 'review');
        await expect(panel).toContainText('Plaid Sandbox Investments');
        await expect(panel).toContainText('Access token stored server-side');

        await expect(card.getByLabel('Select Plaid Growth Brokerage')).toBeChecked();
        await expect(card.getByLabel('Select Plaid Roth IRA')).toBeChecked();
        await card.getByLabel('Select Plaid Cash Management').uncheck();

        await card.getByRole('button', { name: 'Connect selected' }).click();
        await expect(card.getByTestId('plaid-link-panel')).toHaveCount(0);
        await expect(card).toContainText('Plaid Growth Brokerage');
        await expect(card).toContainText('Plaid Roth IRA');
        await expect(card.locator('.pm-integration-provider')).toHaveCount(2);
    });

    test('deep-links via ?tab=notifications render the legacy tabbed surface', async ({ page }) => {
        await gotoAppPage(page, '/settings?tab=notifications');

        // Legacy header is preserved with its own h2 at the top of the page.
        await expect(page.locator('h2', { hasText: 'Advanced settings' })).toBeVisible();

        // The tab UI is still there — the Notifications tab becomes the
        // active one when `?tab=notifications` is in the URL.
        await expect(page.getByRole('tab', { name: /Notifications/ })).toBeVisible();
        await expect(page.getByText('Portfolio Updates').first()).toBeVisible();
        await expect(page.getByText('Alpha Radar Signals').first()).toBeVisible();
        await expect(page.getByTestId('alpha-radar-delivery-preferences')).toBeVisible();
        await expect(page.getByLabel('Alpha Radar delivery ticker filters')).toBeVisible();
    });

    test('Alpha Radar delivery preferences accept ticker filters', async ({ page }) => {
        await gotoAppPage(page, '/settings?tab=notifications');

        await page.getByLabel('Alpha Radar delivery ticker filters').fill('aapl, nvda');
        await expect(page.getByLabel('Alpha Radar delivery ticker filters')).toHaveValue('AAPL, NVDA');
    });

    test('deep-links via ?tab=alerts expose Alpha Radar alert configuration', async ({ page }) => {
        await gotoAppPage(page, '/settings?tab=alerts');

        await expect(page.getByText('Alpha Radar overlap score ≥ 80', { exact: true }).first()).toBeVisible();

        await clickUntil(page.getByRole('button', { name: /New Alert/ }), async () => {
            await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1500 });
        });
        const metricSelect = page.getByRole('combobox').first();
        await expect(metricSelect).toBeVisible();
        await metricSelect.click();
        await expect(page.getByRole('option', { name: 'Alpha Radar: user overlap' })).toBeVisible();
        await expect(page.getByRole('option', { name: 'Alpha Radar: large add' })).toBeVisible();
    });

    test('deep-links via ?tab=tags show the tags manager content', async ({ page }) => {
        await gotoAppPage(page, '/settings?tab=tags');

        await expect(page.getByRole('tab', { name: /Tags/ })).toBeVisible();
        // Default tags from the store.
        await expect(page.getByText('Growth').first()).toBeVisible();
        await expect(page.getByText('Dividend').first()).toBeVisible();
        await expect(page.getByText('Speculative').first()).toBeVisible();
    });

    test('deep-links via ?tab=appearance expose theme controls', async ({ page }) => {
        await gotoAppPage(page, '/settings?tab=appearance');

        // AppearanceSettings card renders inside the legacy surface too.
        await expect(page.getByText('Theme').first()).toBeVisible();
        // Theme radio tiles (Light / Dim / Dark / Auto).
        await expect(page.getByLabel('Light', { exact: true })).toBeVisible();
        await expect(page.getByLabel('Dark', { exact: true })).toBeVisible();
    });

    test('Execution card exposes the AR-110 mood cooldown picker with 10s selected', async ({ page }) => {
        const group = page.getByRole('radiogroup', {
            name: /Mood cooldown duration/,
        });
        await expect(group).toBeVisible();

        for (const label of ['Off', '10s', '30s', '60s']) {
            await expect(group.getByRole('radio', { name: label })).toBeVisible();
        }
        await expect(group.getByRole('radio', { name: '10s' })).toHaveAttribute(
            'aria-checked',
            'true',
        );
    });

    test('clicking a cooldown option updates the aria-checked state', async ({ page }) => {
        const group = page.getByRole('radiogroup', {
            name: /Mood cooldown duration/,
        });
        await group.getByRole('radio', { name: '30s' }).click();
        await expect(group.getByRole('radio', { name: '30s' })).toHaveAttribute(
            'aria-checked',
            'true',
        );
        await expect(group.getByRole('radio', { name: '10s' })).toHaveAttribute(
            'aria-checked',
            'false',
        );
    });

    test('cash jobs can classify cash and update the dashboard risk policy status', async ({ page }) => {
        const card = page.getByTestId('cash-jobs-card');
        await expect(card).toBeVisible();

        await page.getByLabel('Emergency fund cash amount').fill('999999');
        await page.getByLabel('Enable scheduled deployment rule').check();
        await page.getByLabel('Percent of excess cash to deploy').fill('25');
        await page.getByLabel('Deployment destination').fill('Core index allocation');
        await page.getByLabel('Next deployment due date').fill('2026-05-01');

        await expect(page.getByTestId('cash-jobs-classified-total')).toHaveText('$999,999');

        await gotoAppPage(page, '/');
        const cashDimension = page.locator(
            '[data-testid="risk-policy-dimension"][data-policy-id="cash_purpose_coverage"]',
        );
        await expect(cashDimension).toBeVisible();
        await expect(cashDimension).toHaveAttribute('data-status', 'breached');
    });

    test('bucket policy targets can be edited and reset', async ({ page }) => {
        await page.evaluate(() => window.localStorage.removeItem('atlas-settings'));
        await reloadAppPage(page);

        const card = page.getByTestId('bucket-policy-card');
        await expect(card).toBeVisible();
        await expect(card.getByTestId('bucket-policy-row')).toHaveCount(6);

        await page.getByLabel('Active idea / satellite max allocation').fill('12');
        await expect(page.getByLabel('Active idea / satellite max allocation')).toHaveValue('12');
        await expect(
            page.getByTestId('bucket-policy-row').filter({ hasText: 'Active idea / satellite' }).first(),
        ).toHaveAttribute('data-status', 'breached');

        await page.getByRole('button', { name: 'Reset bucket policy' }).click();
        await expect(page.getByLabel('Active idea / satellite max allocation')).toHaveValue('20');
    });

    test('trading activity policy thresholds can be edited and reset', async ({ page }) => {
        await page.evaluate(() => window.localStorage.removeItem('atlas-settings'));
        await reloadAppPage(page);

        const card = page.getByTestId('churn-policy-card');
        await expect(card).toBeVisible();

        await page.getByLabel('Churn lookback days').fill('45');
        await page.getByLabel('Churn watch repeated names').fill('2');
        await page.getByLabel('Churn breach repeated names').fill('4');
        await expect(page.getByLabel('Churn lookback days')).toHaveValue('45');
        await expect(page.getByLabel('Churn watch repeated names')).toHaveValue('2');
        await expect(page.getByLabel('Churn breach repeated names')).toHaveValue('4');

        await page.getByRole('button', { name: 'Reset activity policy' }).click();
        await expect(page.getByLabel('Churn lookback days')).toHaveValue('90');
        await expect(page.getByLabel('Churn watch repeated names')).toHaveValue('1');
        await expect(page.getByLabel('Churn breach repeated names')).toHaveValue('3');
    });

    test('GOOG de-risking plan can be activated and surfaced on the dashboard', async ({ page }) => {
        await page.evaluate(() => window.localStorage.removeItem('atlas-settings'));
        await reloadAppPage(page);

        const card = page.getByTestId('employer-stock-plan-card');
        await expect(card).toBeVisible();

        await page.getByLabel('Employer-stock plan state').selectOption('active');
        await page.getByLabel('Employer target allocation').fill('5');
        await page.getByLabel('Employer intermediate target allocation').fill('8');
        await page.getByLabel('Employer trim amount').fill('10000');
        await page.getByLabel('Employer tax reserve percent').fill('20');
        await page.getByLabel('Employer next action date').fill('2026-05-01');
        await page.getByLabel('Employer destination').fill('Broad core index');

        await expect(page.getByLabel('Employer-stock plan state')).toHaveValue('active');
        await expect(page.getByLabel('Employer target allocation')).toHaveValue('5');
        await expect(card).toContainText('Planning output only');

        await gotoAppPage(page, '/');
        await expect(page.getByTestId('employer-stock-plan-task')).toBeVisible();
        await expect(page.getByTestId('employer-stock-plan-task')).toContainText(/GOOG trim due|Review GOOG/);
    });

    test('sell discipline rules can be created, triggered, snoozed, resolved, and used as execution guardrails', async ({ page }) => {
        await page.evaluate(() => window.localStorage.removeItem('atlas-settings'));
        await reloadAppPage(page);

        const card = page.getByTestId('sell-discipline-card');
        await expect(card).toBeVisible();

        await page.getByLabel('Sell discipline trigger type').selectOption('allocation_cap');
        await page.getByLabel('Sell discipline ticker').fill('AAPL');
        await page.getByLabel('Sell discipline threshold').fill('1');
        await page.getByLabel('Sell discipline action').selectOption('trim');
        await page.getByLabel('Block new adds while triggered').check();
        await page.getByRole('button', { name: 'Add sell rule' }).click();

        let aaplRule = page.getByTestId('sell-discipline-rule').filter({ hasText: 'AAPL Allocation cap' }).first();
        await expect(aaplRule).toBeVisible();
        await expect(aaplRule).toHaveAttribute('data-state', 'triggered');

        await gotoAppPage(page, '/');
        await expect(
            page.getByTestId('sell-discipline-task').filter({ hasText: 'AAPL Allocation cap' }).first(),
        ).toBeVisible();

        await gotoAppPage(page, '/execution');
        const guardrails = page.locator('.pm-exec-guardrails');
        await expect(guardrails).toContainText('Sell discipline');
        await expect(guardrails).toContainText('No-add rule triggered: AAPL Allocation cap');

        await gotoAppPage(page, '/settings');
        aaplRule = page.getByTestId('sell-discipline-rule').filter({ hasText: 'AAPL Allocation cap' }).first();
        await page.getByLabel(/Action reason for AAPL Allocation cap/).fill('Reviewed after earnings.');
        await aaplRule.getByRole('button', { name: 'Snooze 30d' }).click();
        await expect(aaplRule).toHaveAttribute('data-state', 'snoozed');

        await page.getByLabel(/Action reason for AAPL Allocation cap/).fill('Trim completed after policy review.');
        await aaplRule.getByRole('button', { name: 'Resolve' }).click();
        await expect(aaplRule).toHaveAttribute('data-state', 'resolved');
    });
});

function plaidE2EAccount({
    plaidAccountId,
    name,
    type = 'investment',
    subtype,
    currentBalance,
    capabilities = ['balances', 'holdings', 'transactions', 'investments'],
}: {
    plaidAccountId: string;
    name: string;
    type?: string;
    subtype: string;
    currentBalance: number;
    capabilities?: string[];
}) {
    return {
        plaidAccountId,
        name,
        officialName: `${name} Official`,
        mask: plaidAccountId.endsWith('cash-management') ? '2222' : plaidAccountId.endsWith('roth-ira') ? '1111' : '0000',
        type,
        subtype,
        currentBalance,
        isoCurrencyCode: 'USD',
        institution: {
            id: 'ins_109508',
            name: 'Plaid Sandbox Investments',
        },
        capabilities,
        verificationStatus: 'automatically_verified',
    };
}
