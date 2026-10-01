import { test, expect } from '@playwright/test';
import { clickUntil, gotoAppPage, openPolicyChecks, reloadAppPage } from './helpers/app';

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

test.describe('Settings page', () => {
    test.beforeEach(async ({ page }) => {
        await gotoAppPage(page, '/settings');
    });

    test('renders one column of sections with an anchor rail', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Settings');
        const rail = page.getByRole('navigation', { name: 'Settings sections' });
        for (const label of ['Account', 'Connected accounts', 'Data', 'Trading rules', 'Risk policy', 'Notifications & alerts', 'Preferences', 'Market data keys']) {
            await expect(rail.getByRole('link', { name: label, exact: true })).toBeVisible();
        }
        await expect(rail.getByRole('link', { name: 'Help & glossary' })).toHaveAttribute('href', '/help');
        for (const title of [/^Profile$/, /^Connected accounts$/i, /^Appearance$/, /^Guardrails$/, /^Execution$/, /^Bucket policy/, /^GOOG de-risking/, /^Trading activity/, /^Cash jobs$/, /^Sell discipline/]) {
            await expect(page.locator('.pm-settings-card-title', { hasText: title })).toBeVisible();
        }
    });

    test('regression: no separate legacy tabbed layout or "Advanced settings" detour', async ({ page }) => {
        await expect(page.getByText('Advanced settings')).toHaveCount(0);
        await expect(page.locator('.pm-settings-advanced-grid')).toHaveCount(0);
    });

    test('regression: no fake password form; sign-in is described honestly', async ({ page }) => {
        await expect(page.getByLabel('Current password')).toHaveCount(0);
        await expect(page.getByTestId('signin-card')).toContainText(/Google|Local development/);
    });

    test('connected accounts start empty — no seeded Fidelity/Vanguard/IBKR rows', async ({ page }) => {
        const section = page.locator('#accounts');
        await expect(section).toBeVisible();
        await expect(section.getByText('****1234')).toHaveCount(0);
        await expect(section.getByText('Interactive Brokers')).toHaveCount(0);
    });

    test('profile shows the signed-in identity instead of John Doe', async ({ page }) => {
        await expect(page.getByText('john@example.com')).toHaveCount(0);
        await expect(page.getByTestId('profile-email')).not.toHaveText('');
    });

    test('example data can be hidden and shown again', async ({ page }) => {
        const card = page.getByTestId('example-data-card');
        const toggle = card.getByRole('checkbox');
        await expect(toggle).toBeChecked();
        await clickUntil(card.locator('label.pm-switch'), async () => {
            await expect(toggle).not.toBeChecked({ timeout: 1000 });
        });
        await gotoAppPage(page, '/strategies');
        await expect(page.getByTestId('sample-empty-state')).toBeVisible();
        await page.getByRole('button', { name: 'Show example data' }).click();
        await expect(page.locator('.pm-strategy-card').first()).toBeVisible();
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

        const panel = card.getByTestId('plaid-link-panel');
        await clickUntil(card.getByRole('button', { name: /^Connect$/ }), async () => {
            await expect(panel).toBeVisible({ timeout: 1500 });
        });
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

    test('legacy ?tab=notifications links land on the Notifications section', async ({ page }) => {
        await gotoAppPage(page, '/settings?tab=notifications');

        await expect(page.locator('#notifications')).toBeInViewport();
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

    test('legacy ?tab=tags links land on Preferences with the tags manager', async ({ page }) => {
        await gotoAppPage(page, '/settings?tab=tags');

        await expect(page.locator('#preferences')).toBeInViewport();
        // Default tags from the store.
        await expect(page.getByText('Growth').first()).toBeVisible();
        await expect(page.getByText('Dividend').first()).toBeVisible();
        await expect(page.getByText('Speculative').first()).toBeVisible();
    });

    test('legacy ?tab=appearance links expose theme controls', async ({ page }) => {
        await gotoAppPage(page, '/settings?tab=appearance');

        const themes = page.getByRole('radiogroup', { name: 'Color theme' });
        await expect(themes.getByRole('radio', { name: 'Light', exact: true })).toBeVisible();
        await expect(themes.getByRole('radio', { name: 'Dark', exact: true })).toBeVisible();
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
        // The settings sections hydrate inside a Suspense boundary; retry the
        // click until React has attached handlers.
        await clickUntil(group.getByRole('radio', { name: '30s' }), async () => {
            await expect(group.getByRole('radio', { name: '30s' })).toHaveAttribute('aria-checked', 'true', { timeout: 1000 });
        });
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
        test.skip(!(await openPolicyChecks(page)), 'risk policy checks need holdings');
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
        test.skip(!(await openPolicyChecks(page)), 'risk policy checks need holdings');
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
        // Today only runs policy checks against real holdings.
        if (await openPolicyChecks(page)) {
            await expect(
                page.getByTestId('sell-discipline-task').filter({ hasText: 'AAPL Allocation cap' }).first(),
            ).toBeVisible();
        }

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

test.describe('Settings card layout', () => {
    test('regression: guardrail and execution rows are inset from the card edge', async ({ page }) => {
        await gotoAppPage(page, '/settings');
        const lists = page.locator('.pm-guard-list');
        await expect(lists.first()).toBeVisible();
        const count = await lists.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
            const padding = await lists.nth(i).evaluate((el) => {
                const cs = getComputedStyle(el);
                return { left: parseFloat(cs.paddingLeft), right: parseFloat(cs.paddingRight) };
            });
            expect(padding.left).toBeGreaterThanOrEqual(12);
            expect(padding.right).toBeGreaterThanOrEqual(12);
        }
    });
});
