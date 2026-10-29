import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { clickUntil, gotoAppPage, openPolicyChecks, reloadAppPage } from './helpers/app';
import { accountRowsLeft, databaseAuthEnabled, signInAsFreshUser } from './helpers/users';

/** The next save of the user's settings whose risk policy passes `check`. */
function savedRiskPolicy(page: Page, check: (riskPolicy: Record<string, unknown>) => boolean) {
    return page.waitForResponse((response) => {
        if (!response.url().endsWith('/api/settings') || response.request().method() !== 'PUT' || !response.ok()) return false;
        return check(response.request().postDataJSON()?.settings?.riskPolicy ?? {});
    });
}

/** The risk policy previews run on the user's holdings: without any, there's nothing to check. */
async function hasPolicyHoldings(page: Page): Promise<boolean> {
    await expect(page.getByTestId('bucket-holdings')).toBeVisible();
    return !(await page.getByTestId('bucket-holdings-empty').isVisible());
}

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
    test.beforeEach(async ({ context, page }) => {
        // These tests change settings, which the server keeps per user.
        await signInAsFreshUser(context);
        await gotoAppPage(page, '/settings');
    });

    test('renders one column of sections with an anchor rail', async ({ page }) => {
        await expect(page.locator('h1.pm-topbar-title')).toHaveText('Settings');
        const rail = page.getByRole('navigation', { name: 'Settings sections' });
        for (const label of ['Account', 'Connected accounts', 'Data', 'Trading rules', 'Risk policy', 'Notifications & alerts', 'Preferences', 'Market data keys']) {
            await expect(rail.getByRole('link', { name: label, exact: true })).toBeVisible();
        }
        await expect(rail.getByRole('link', { name: 'Help & glossary' })).toHaveAttribute('href', '/help');
        for (const title of [/^Profile$/, /^Connected accounts$/i, /^Appearance$/, /^Guardrails$/, /^Execution$/, /^Bucket policy/, /^Employer stock/, /^Trading activity/, /^Cash jobs$/, /^Sell discipline/]) {
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

    test('Plaid Link connects the picked accounts, syncs them, and lists the connection from the server', async ({ page }) => {
        // Launch items i44 and i46: the picked accounts sync straight away, and
        // the card lists connections from the database, not this browser.
        let connections: unknown[] = [];
        await page.route('**/api/plaid/connections', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: connections }) });
        });
        await page.route('**/api/plaid/link-token', async (route) => {
            expect(route.request().postData() ?? '').not.toContain('itemId');
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
                    institution: { id: 'ins_109508', name: 'Plaid Sandbox Investments' },
                    accounts: [
                        plaidE2EAccount({ plaidAccountId: 'plaid-growth-brokerage', name: 'Plaid Growth Brokerage', subtype: 'brokerage', currentBalance: 125430 }),
                        plaidE2EAccount({ plaidAccountId: 'plaid-roth-ira', name: 'Plaid Roth IRA', subtype: 'roth', currentBalance: 84320 }),
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
        const syncRequests: unknown[] = [];
        await page.route('**/api/plaid/sync', async (route) => {
            syncRequests.push(route.request().postDataJSON());
            if (syncRequests.length === 1) {
                connections = [plaidE2EConnection({
                    itemId: 'item-plaid-sandbox-investments',
                    institutionName: 'Plaid Sandbox Investments',
                    accounts: [
                        { plaidAccountId: 'plaid-cash-management', name: 'Plaid Cash Management', mask: '2222', type: 'depository', subtype: 'checking', syncStatus: 'excluded', portfolio: null },
                        { plaidAccountId: 'plaid-growth-brokerage', name: 'Plaid Growth Brokerage', mask: '0000', type: 'investment', subtype: 'brokerage', syncStatus: 'sync_ready', portfolio: { id: 'p-growth', name: 'Plaid Sandbox Investments Plaid Growth Brokerage' } },
                        { plaidAccountId: 'plaid-roth-ira', name: 'Plaid Roth IRA', mask: '1111', type: 'investment', subtype: 'roth', syncStatus: 'sync_ready', portfolio: { id: 'p-roth', name: 'Plaid Sandbox Investments Plaid Roth IRA' } },
                    ],
                })];
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        data: {
                            itemId: 'item-plaid-sandbox-investments',
                            accounts: [
                                { name: 'Plaid Sandbox Investments Plaid Growth Brokerage', positions: 7, transactionsAdded: 100, transactionsPending: false, holdingsSkipped: 0, costUnknown: 0 },
                                { name: 'Plaid Sandbox Investments Plaid Roth IRA', positions: 2, transactionsAdded: 20, transactionsPending: false, holdingsSkipped: 1, costUnknown: 0 },
                            ],
                            overLimit: [],
                        },
                    }),
                });
                return;
            }
            await route.fulfill({
                status: 409,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Your bank wants you to sign in again before Atlas can sync this connection.', code: 'PLAID_LOGIN_REQUIRED' }),
            });
        });
        await mockPlaidLinkSdk(page);
        await reloadAppPage(page);

        const card = page.getByTestId('integrations-card');
        await expect(card).toContainText('No accounts connected yet');

        const panel = card.getByTestId('plaid-link-panel');
        await clickUntil(card.getByRole('button', { name: /^Connect$/ }), async () => {
            await expect(panel).toBeVisible({ timeout: 1500 });
        });
        await expect(panel).toHaveAttribute('data-state', 'review');
        await expect(panel).toContainText('Plaid Sandbox Investments');
        await expect(card.getByLabel('Select Plaid Growth Brokerage')).toBeChecked();
        await expect(card.getByLabel('Select Plaid Roth IRA')).toBeChecked();
        await card.getByLabel('Select Plaid Cash Management').uncheck();
        await card.getByRole('button', { name: 'Connect selected' }).click();

        // Only the accounts picked sync: the checking account was unticked.
        await expect(page.getByText("2 accounts: 9 positions and 120 new transactions. 1 holding without a ticker, or in another currency, wasn't brought in.")).toBeVisible();
        expect(syncRequests[0]).toEqual({ itemId: 'item-plaid-sandbox-investments', plaidAccountIds: ['plaid-growth-brokerage', 'plaid-roth-ira'] });

        // The connection as the server has it: what each account syncs into.
        const connection = card.getByTestId('plaid-connection');
        await expect(connection).toHaveCount(1);
        await expect(connection).toContainText('Plaid Sandbox Investments');
        await expect(connection).toContainText('2 accounts sync');
        const accounts = connection.getByRole('list', { name: 'Plaid Sandbox Investments accounts' }).getByRole('listitem');
        await expect(accounts.filter({ hasText: 'Plaid Growth Brokerage' }).getByRole('link', { name: 'Plaid Sandbox Investments Plaid Growth Brokerage' })).toHaveAttribute('href', '/portfolios/accounts');
        await expect(accounts.filter({ hasText: 'Plaid Cash Management' })).toContainText('Balances only; not synced');

        // "Sync now" syncs the connection, and says why when it can't.
        await connection.getByRole('button', { name: 'Sync now' }).click();
        await expect(page.getByText('Your bank wants you to sign in again before Atlas can sync this connection.')).toBeVisible();
        expect(syncRequests[1]).toEqual({ itemId: 'item-plaid-sandbox-investments' });
    });

    test('the Plaid token exchange reads at most 64 KB (i69)', async ({ page }) => {
        // Refused before anything reaches Plaid, which E2E never calls anyway.
        const response = await page.request.post('/api/plaid/exchange-public-token', {
            data: { publicToken: 'public-sandbox-e2e', metadata: { link_session_id: 'x'.repeat(70_000) } },
        });
        expect(response.status()).toBe(413);
        expect((await response.json()).code).toBe('PLAID_EXCHANGE_TOO_LARGE');
    });

    test('regression: connections that fail to load say so, with Try again, not "none connected"', async ({ page }) => {
        // The Codex finding on PR #163: an outage read as having no accounts.
        let fail = true;
        await page.route('**/api/plaid/connections', async (route) => {
            if (fail) {
                await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Unable to load the linked accounts.', code: 'PLAID_CONNECTIONS_FAILED' }) });
                return;
            }
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
        });
        await reloadAppPage(page);
        const card = page.getByTestId('integrations-card');
        const failed = card.getByTestId('plaid-connections-error');
        await expect(failed).toContainText("Couldn't load your connected accounts.");
        await expect(card).not.toContainText('No accounts connected yet');
        fail = false;
        await failed.getByRole('button', { name: 'Try again' }).click();
        await expect(card).toContainText('No accounts connected yet');
        await expect(failed).toHaveCount(0);
    });

    test('regression: retrying a failed reconnect signs in to the same connection again, not a new one', async ({ page }) => {
        // The Codex finding on PR #163: Retry opened Link for a new connection.
        await page.route('**/api/plaid/connections', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: [plaidE2EConnection({
                        itemId: 'item-fidelity',
                        institutionName: 'Fidelity',
                        status: 'login_required',
                        accounts: [{ plaidAccountId: 'acc-f1', name: 'Individual', mask: '1234', type: 'investment', subtype: 'brokerage', syncStatus: 'sync_ready', portfolio: { id: 'p-f1', name: 'Fidelity Individual' } }],
                    })],
                }),
            });
        });
        const linkTokenBodies: unknown[] = [];
        await page.route('**/api/plaid/link-token', async (route) => {
            linkTokenBodies.push(route.request().postDataJSON());
            if (linkTokenBodies.length === 1) {
                await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Unable to create Plaid link token.', code: 'PLAID_LINK_TOKEN_FAILED' }) });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ linkToken: 'link-sandbox-update', expiration: '2026-10-26T16:00:00Z', requestId: 'r', environment: 'sandbox', products: [] }),
            });
        });
        const syncRequests: unknown[] = [];
        await page.route('**/api/plaid/sync', async (route) => {
            syncRequests.push(route.request().postDataJSON());
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { itemId: 'item-fidelity', accounts: [], overLimit: [] } }) });
        });
        await mockPlaidLinkSdk(page);
        await reloadAppPage(page);

        const card = page.getByTestId('integrations-card');
        await card.getByTestId('plaid-connection').getByRole('button', { name: 'Reconnect' }).click();
        const panel = card.getByTestId('plaid-link-panel');
        await expect(panel).toHaveAttribute('data-state', 'error');
        await panel.getByRole('button', { name: 'Retry Plaid Link' }).click();
        await expect.poll(() => syncRequests.length).toBe(1);
        expect(linkTokenBodies).toEqual([{ itemId: 'item-fidelity' }, { itemId: 'item-fidelity' }]);
        expect(syncRequests[0]).toEqual({ itemId: 'item-fidelity', reconnected: true });
    });

    test('a connection that needs a sign-in reconnects through Link; accounts waiting are picked here; disconnecting asks first', async ({ page }) => {
        // Launch items i45 and i46.
        let connections: unknown[] = [
            plaidE2EConnection({
                itemId: 'item-fidelity',
                institutionName: 'Fidelity',
                status: 'login_required',
                accounts: [{ plaidAccountId: 'acc-f1', name: 'Individual', mask: '1234', type: 'investment', subtype: 'brokerage', syncStatus: 'sync_ready', portfolio: { id: 'p-f1', name: 'Fidelity Individual' } }],
            }),
            plaidE2EConnection({
                itemId: 'item-vanguard',
                institutionName: 'Vanguard',
                accounts: [
                    { plaidAccountId: 'acc-v1', name: 'Brokerage', mask: '5555', type: 'investment', subtype: 'brokerage', syncStatus: 'awaiting_selection', portfolio: null },
                    { plaidAccountId: 'acc-v2', name: 'Roth IRA', mask: '6666', type: 'investment', subtype: 'roth', syncStatus: 'awaiting_selection', portfolio: null },
                ],
            }),
        ];
        await page.route('**/api/plaid/connections', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: connections }) });
        });
        const linkTokenBodies: unknown[] = [];
        await page.route('**/api/plaid/link-token', async (route) => {
            linkTokenBodies.push(route.request().postDataJSON());
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ linkToken: 'link-sandbox-update', expiration: '2026-10-26T16:00:00Z', requestId: 'r', environment: 'sandbox', products: [] }),
            });
        });
        const syncRequests: unknown[] = [];
        await page.route('**/api/plaid/sync', async (route) => {
            syncRequests.push(route.request().postDataJSON());
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: { itemId: 'x', accounts: [{ name: 'Fidelity Individual', positions: 3, transactionsAdded: 0, transactionsPending: false, holdingsSkipped: 0, costUnknown: 0 }], overLimit: [] } }),
            });
        });
        const deleted: string[] = [];
        await page.route('**/api/plaid/connections/*', async (route) => {
            if (route.request().method() !== 'DELETE') return route.fallback();
            deleted.push(new URL(route.request().url()).pathname);
            connections = connections.slice(0, 1);
            await route.fulfill({ status: 204 });
        });
        await mockPlaidLinkSdk(page);
        await reloadAppPage(page);

        const card = page.getByTestId('integrations-card');
        const fidelity = card.getByTestId('plaid-connection').filter({ hasText: 'Fidelity' });
        const vanguard = card.getByTestId('plaid-connection').filter({ hasText: 'Vanguard' });

        // Fidelity wants a sign-in: Reconnect opens Link in update mode, then syncs.
        await expect(fidelity).toContainText('Sign in again');
        await expect(fidelity.getByRole('button', { name: 'Sync now' })).toHaveCount(0);
        await fidelity.getByRole('button', { name: 'Reconnect' }).click();
        await expect(page.getByText('Fidelity Individual: 3 positions and 0 new transactions.')).toBeVisible();
        expect(linkTokenBodies[0]).toEqual({ itemId: 'item-fidelity' });
        // Read again from Plaid first: its accounts, login and consent.
        expect(syncRequests[0]).toEqual({ itemId: 'item-fidelity', reconnected: true });

        // Vanguard's accounts wait for a pick: picked here, they sync.
        const pick = vanguard.getByTestId('plaid-pick');
        await expect(vanguard).toContainText('Waiting for you to choose');
        await expect(pick.getByRole('button', { name: 'Sync selected' })).toBeDisabled();
        await pick.getByLabel('Sync Roth IRA').check();
        await pick.getByRole('button', { name: 'Sync selected' }).click();
        await expect.poll(() => syncRequests.length).toBe(2);
        expect(syncRequests[1]).toEqual({ itemId: 'item-vanguard', plaidAccountIds: ['acc-v2'] });

        // Disconnect asks first, then the connection is gone from the list.
        page.once('dialog', (dialog) => {
            expect(dialog.message()).toContain('Disconnect Vanguard?');
            void dialog.accept();
        });
        await vanguard.getByRole('button', { name: 'Disconnect' }).click();
        await expect(page.getByText('Disconnected Vanguard.')).toBeVisible();
        expect(deleted).toEqual(['/api/plaid/connections/item-vanguard']);
        await expect(card.getByTestId('plaid-connection')).toHaveCount(1);
    });

    test('Data: everything downloads as JSON, and transactions as CSV, from the account', async ({ page }) => {
        // Launch item i65: the export is the account's data, not this browser's settings.
        test.skip(!databaseAuthEnabled, 'requires the database-auth E2E mode');
        const data = page.getByTestId('data-management');
        const [json] = await Promise.all([page.waitForEvent('download'), data.getByRole('button', { name: 'Everything (JSON)' }).click()]);
        expect(json.suggestedFilename()).toMatch(/^atlas-wealth-export-\d{4}-\d{2}-\d{2}\.json$/);
        const exported = JSON.parse(readFileSync(await json.path(), 'utf8')) as { format: string; accounts: Array<{ name: string; transactions: unknown[] }> };
        expect(exported.format).toBe('atlas-wealth-export');
        // The fresh user is a copy of fixture user A: its accounts and transactions.
        expect(exported.accounts.length).toBeGreaterThan(0);
        expect(exported.accounts.some((a) => a.transactions.length > 0)).toBe(true);
        expect(JSON.stringify(exported)).not.toContain('userId');

        const [csv] = await Promise.all([page.waitForEvent('download'), data.getByRole('button', { name: 'Transactions (CSV)' }).click()]);
        expect(csv.suggestedFilename()).toMatch(/^atlas-wealth-transactions-.*\.csv$/);
        expect(readFileSync(await csv.path(), 'utf8').split('\n')[0]).toBe('account,date,type,symbol,quantity,price,amount,fees,currency,notes,source');
    });

    test('Data: deleting the account needs DELETE typed, then signs out with everything gone', async ({ context, page }) => {
        // Launch item i65: Delete account used to reset this browser's settings only.
        test.skip(!databaseAuthEnabled, 'requires the database-auth E2E mode');
        const userId = await signInAsFreshUser(context);
        await gotoAppPage(page, '/settings');
        expect(await accountRowsLeft(userId)).toEqual({ users: 1, sessions: 1, portfolios: expect.any(Number), settings: expect.any(Number) });

        await page.getByTestId('data-management').getByRole('button', { name: 'Delete account' }).click();
        const dialog = page.getByRole('alertdialog');
        const confirm = dialog.getByRole('button', { name: 'Delete account' });
        await expect(confirm).toBeDisabled();
        await dialog.getByLabel('Type DELETE to confirm').fill('delete');
        await expect(confirm).toBeDisabled();
        await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
        await confirm.click();

        await page.waitForURL(/\/login\?deleted=1/);
        await expect(page.getByTestId('login-account-deleted')).toContainText('Your account and its data were deleted');
        expect(await accountRowsLeft(userId)).toEqual({ users: 0, sessions: 0, portfolios: 0, settings: 0 });
        // This browser kept nothing of theirs.
        const leftover = await page.evaluate((scope) => Object.keys(localStorage).filter((key) => key.endsWith(`:${scope}`)), userId);
        expect(leftover).toEqual([]);
        // Signed out: the app sends them to sign in.
        await page.goto('/settings');
        await expect(page).toHaveURL(/\/login/);
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
        test.skip(!(await hasPolicyHoldings(page)), 'the bucket preview needs holdings');

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

    test('regression: the previews are the user\'s own portfolio, not example data', async ({ page }) => {
        for (const card of ['bucket-policy-card', 'employer-stock-plan-card', 'churn-policy-card', 'sell-discipline-card']) {
            await expect(page.getByTestId(card)).toBeVisible();
            await expect(page.getByTestId(card).getByTestId('sample-tag')).toHaveCount(0);
        }
        test.skip(!(await hasPolicyHoldings(page)), 'the previews need holdings');
        // User A's holdings, in the bucket each one's type suggests.
        const holdings = page.getByTestId('bucket-holding');
        await expect(holdings).toHaveCount(6);
        await expect(page.getByLabel('AAPL bucket')).toHaveValue('');
        await expect(page.getByLabel('AAPL bucket').locator('option:checked')).toHaveText('Active idea / satellite (default)');
        await expect(page.getByLabel('TSLA bucket').locator('option:checked')).toHaveText('Speculative/options (default)');
        await expect(page.getByTestId('bucket-policy-row').filter({ hasText: 'Speculative/options' }).first()).toContainText('from TSLA');
    });

    test('a holding\'s bucket can be chosen; Today\'s checks follow it, and it can go back to its default', async ({ page }) => {
        test.skip(!databaseAuthEnabled, 'Today reads the policy saved to the server');
        test.skip(!(await hasPolicyHoldings(page)), 'the bucket choices need holdings');
        // Settings, Today, Settings, Holdings and Settings again.
        test.slow();

        // TSLA is the only speculative holding: 12% of the portfolio, over the 5% cap.
        await gotoAppPage(page, '/');
        await expect(page.getByTestId('today-triage-item').filter({ hasText: 'Speculative/options' })).toHaveCount(1);

        await gotoAppPage(page, '/settings');
        const tsla = page.getByLabel('TSLA bucket');
        const saved = savedRiskPolicy(page, (riskPolicy) => (riskPolicy.bucketAssignments as Record<string, string>)?.TSLA === 'core');
        await clickUntil(tsla, async () => {
            await tsla.selectOption('core');
            await expect(tsla).toHaveValue('core', { timeout: 1000 });
        });
        await saved;
        await expect(page.getByTestId('bucket-policy-row').filter({ hasText: 'Core' }).first()).toContainText('TSLA');
        await expect(page.getByTestId('bucket-policy-row').filter({ hasText: 'Speculative/options' }).first()).toHaveAttribute('data-status', 'inside');

        await reloadAppPage(page);
        await expect(page.getByLabel('TSLA bucket')).toHaveValue('core');

        // Today evaluates the saved policy on the server: no speculative breach left.
        await gotoAppPage(page, '/');
        await expect(page.getByTestId('today-triage')).toBeVisible();
        await expect(page.getByTestId('today-triage-item').filter({ hasText: 'Speculative/options' })).toHaveCount(0);
        expect(await openPolicyChecks(page)).toBe(true);
        await expect(
            page.locator('[data-testid="risk-policy-dimension"][data-policy-id="speculative_options_exposure"]'),
        ).toHaveAttribute('data-status', 'inside');

        // Holdings files it under the bucket chosen.
        await gotoAppPage(page, '/portfolios/holdings');
        const bucketFilter = page.getByLabel('Filter holdings by policy bucket');
        await bucketFilter.selectOption('core');
        await expect(page.getByTestId('holdings-table').getByRole('row').filter({ hasText: 'TSLA' })).toContainText('Core');
        await bucketFilter.selectOption('speculative');
        await expect(page.getByTestId('holdings-table').getByRole('row').filter({ hasText: 'TSLA' })).toHaveCount(0);

        await gotoAppPage(page, '/settings');
        const back = savedRiskPolicy(page, (riskPolicy) => !('TSLA' in ((riskPolicy.bucketAssignments as object) ?? {})));
        const tslaAgain = page.getByLabel('TSLA bucket');
        // The saved choice shows once the page has hydrated with the user's settings.
        await expect(tslaAgain).toHaveValue('core');
        await tslaAgain.selectOption('');
        await back;
        await expect(page.getByLabel('TSLA bucket').locator('option:checked')).toHaveText('Speculative/options (default)');
    });

    test('employer stock is none until named; the plan for the tickers named surfaces on Today', async ({ page }) => {
        const card = page.getByTestId('employer-stock-plan-card');
        await expect(card).toBeVisible();
        await expect(card.locator('.pm-settings-card-sub')).toHaveText('none named');
        await expect(page.getByTestId('employer-stock-note')).toContainText("If you hold your employer's stock");
        await expect(page.getByLabel('Employer stock tickers')).toHaveValue('');

        const tickers = page.getByLabel('Employer stock tickers');
        await clickUntil(tickers, async () => {
            await tickers.fill('googl, $$$');
            await tickers.press('Enter');
            await expect(tickers).toHaveValue('GOOGL', { timeout: 1000 });
        });
        await expect(page.getByTestId('employer-stock-note')).toContainText('GOOGL is kept apart from other concentration');

        await expect(async () => {
            await page.getByLabel('Employer-stock plan state').selectOption('active');
            await expect(page.getByLabel('Employer-stock plan state')).toHaveValue('active', { timeout: 1000 });
        }).toPass({ timeout: 10_000 });
        await page.getByLabel('Employer target allocation').fill('5');
        await page.getByLabel('Employer intermediate target allocation').fill('8');
        await page.getByLabel('Employer trim amount').fill('10000');
        await page.getByLabel('Employer tax reserve percent').fill('20');
        await page.getByLabel('Employer next action date').fill('2026-05-01');
        await page.getByLabel('Employer destination').fill('Broad core index');

        await expect(page.getByLabel('Employer-stock plan state')).toHaveValue('active');
        await expect(page.getByLabel('Employer target allocation')).toHaveValue('5');
        await expect(card).toContainText('Planning output only');

        // Resetting the plan keeps the tickers.
        await page.getByRole('button', { name: 'Reset plan' }).click();
        await expect(page.getByLabel('Employer-stock plan state')).toHaveValue('draft');
        await expect(page.getByLabel('Employer stock tickers')).toHaveValue('GOOGL');
        await page.getByLabel('Employer-stock plan state').selectOption('active');
        await page.getByLabel('Employer target allocation').fill('5');
        await page.getByLabel('Employer next action date').fill('2026-05-01');

        await gotoAppPage(page, '/');
        test.skip(!(await openPolicyChecks(page)), 'risk policy checks need holdings');
        await expect(page.getByTestId('employer-stock-plan-task')).toBeVisible();
        await expect(page.getByTestId('employer-stock-plan-task')).toContainText(/GOOGL trim due|Review GOOGL/);
        await expect(
            page.locator('[data-testid="risk-policy-dimension"][data-policy-id="employer_stock_concentration"]'),
        ).toContainText('Employer stock (GOOGL)');
    });

    test('sell discipline rules can be created, triggered, snoozed, resolved, and used as execution guardrails', async ({ page }) => {
        test.skip(!(await hasPolicyHoldings(page)), 'the rules are previewed on the user\'s holdings');

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
        // The ticket hydrates before it takes a ticker (it upper-cases what's typed).
        const ticker = page.getByLabel('Ticker');
        await expect(async () => {
            await ticker.fill('aapl');
            await expect(ticker).toHaveValue('AAPL', { timeout: 1_000 });
        }).toPass({ timeout: 10_000 });
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

/** A connection as GET /api/plaid/connections lists it. */
function plaidE2EConnection({
    itemId,
    institutionName,
    status = 'active',
    accounts,
}: {
    itemId: string;
    institutionName: string;
    status?: string;
    accounts: Array<Record<string, unknown>>;
}) {
    return {
        itemId,
        institutionName,
        status,
        lastSuccessfulSyncAt: '2026-10-25T22:30:00.000Z',
        accounts: accounts.map((account) => ({ lastSyncedAt: '2026-10-25T22:30:00.000Z', ...account })),
    };
}

/** Plaid's Link SDK, answering success as soon as Link opens. */
async function mockPlaidLinkSdk(page: import('@playwright/test').Page) {
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
                        institution: { name: 'Plaid Sandbox Investments', institution_id: 'ins_109508' },
                        accounts: [
                            { id: 'plaid-growth-brokerage', name: 'Plaid Growth Brokerage', mask: '0000', type: 'investment', subtype: 'brokerage' },
                            { id: 'plaid-roth-ira', name: 'Plaid Roth IRA', mask: '1111', type: 'investment', subtype: 'roth' },
                            { id: 'plaid-cash-management', name: 'Plaid Cash Management', mask: '2222', type: 'depository', subtype: 'checking' },
                        ],
                        link_session_id: 'link-session-e2e',
                    });
                },
                destroy: () => undefined,
            }),
        };
    });
}

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
