import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import type { ConnectedAccount, Tag } from './settingsStore';
import type { PlaidConnectedAccountInput } from '@/lib/plaid/types';

type SettingsStoreHook = typeof import('./settingsStore').useSettingsStore;

// Zustand persist middleware needs localStorage; provide a minimal shim.
const kvStore = new Map<string, string>();
// @ts-expect-error — intentional minimal mock
globalThis.localStorage = {
    getItem: (key: string) => kvStore.get(key) ?? null,
    setItem: (key: string, value: string) => { kvStore.set(key, value); },
    removeItem: (key: string) => { kvStore.delete(key); },
};

let useSettingsStore: SettingsStoreHook;

describe('settingsStore', () => {
    before(async () => {
        // Dynamic import must happen after localStorage shim is in place
        const mod = await import('./settingsStore');
        useSettingsStore = mod.useSettingsStore;
    });

    beforeEach(() => {
        // Drain the localStorage shim between tests so persist-middleware
        // writes from a prior test don't hydrate the next one. resetSettings()
        // handles in-memory state but not what zustand wrote to storage.
        kvStore.clear();
        useSettingsStore.getState().resetSettings();
    });

    // -----------------------------------------------------------------------
    // Profile
    // -----------------------------------------------------------------------

    describe('updateProfile', () => {
        test('should merge partial updates without clobbering other fields', () => {
            useSettingsStore.getState().updateProfile({ fullName: 'Jane Smith' });
            const profile = useSettingsStore.getState().profile;
            assert.strictEqual(profile.fullName, 'Jane Smith');
            assert.strictEqual(profile.email, 'john@example.com');  // unchanged
            assert.strictEqual(profile.phone, '+1 (555) 123-4567'); // unchanged
        });

        test('should update multiple fields at once', () => {
            useSettingsStore.getState().updateProfile({ email: 'jane@test.com', phone: '9999999999' });
            const profile = useSettingsStore.getState().profile;
            assert.strictEqual(profile.email, 'jane@test.com');
            assert.strictEqual(profile.phone, '9999999999');
        });
    });

    // -----------------------------------------------------------------------
    // Notifications
    // -----------------------------------------------------------------------

    describe('updateNotification', () => {
        test('should toggle a single notification setting', () => {
            const before = useSettingsStore.getState().notifications.strategySignals;
            assert.strictEqual(before, false);
            useSettingsStore.getState().updateNotification('strategySignals', true);
            assert.strictEqual(useSettingsStore.getState().notifications.strategySignals, true);
        });

        test('should leave other notification settings unchanged', () => {
            useSettingsStore.getState().updateNotification('priceAlerts', false);
            const n = useSettingsStore.getState().notifications;
            assert.strictEqual(n.priceAlerts, false);
            assert.strictEqual(n.portfolioUpdates, true); // default
            assert.strictEqual(n.alphaRadarSignals, true); // default
        });

        test('should default Alpha Radar delivery to in-app only', () => {
            const delivery = useSettingsStore.getState().alphaRadarDelivery;
            assert.strictEqual(delivery.enabled, true);
            assert.strictEqual(delivery.channels.inApp, true);
            assert.strictEqual(delivery.channels.email, false);
            assert.strictEqual(delivery.channels.slack, false);
            assert.strictEqual(delivery.channels.telegram, false);
            assert.strictEqual(delivery.failureSummaries, true);
            assert.strictEqual(delivery.minMaterialityScore, 75);
        });

        test('should update Alpha Radar delivery filters without clobbering channels', () => {
            useSettingsStore.getState().updateAlphaRadarDelivery({
                tickerFilters: ['AAPL', 'NVDA'],
                minMaterialityScore: 85,
            });

            const delivery = useSettingsStore.getState().alphaRadarDelivery;
            assert.deepStrictEqual(delivery.tickerFilters, ['AAPL', 'NVDA']);
            assert.strictEqual(delivery.minMaterialityScore, 85);
            assert.strictEqual(delivery.channels.inApp, true);
        });

        test('should update a single Alpha Radar delivery channel', () => {
            useSettingsStore.getState().updateAlphaRadarDeliveryChannel('slack', true);
            const delivery = useSettingsStore.getState().alphaRadarDelivery;
            assert.strictEqual(delivery.channels.slack, true);
            assert.strictEqual(delivery.channels.email, false);
            assert.strictEqual(delivery.channels.inApp, true);
        });
    });

    // -----------------------------------------------------------------------
    // Security
    // -----------------------------------------------------------------------

    describe('toggleTwoFactor', () => {
        test('should flip twoFactorEnabled on each call', () => {
            assert.strictEqual(useSettingsStore.getState().security.twoFactorEnabled, false);
            useSettingsStore.getState().toggleTwoFactor();
            assert.strictEqual(useSettingsStore.getState().security.twoFactorEnabled, true);
            useSettingsStore.getState().toggleTwoFactor();
            assert.strictEqual(useSettingsStore.getState().security.twoFactorEnabled, false);
        });
    });

    // -----------------------------------------------------------------------
    // Appearance
    // -----------------------------------------------------------------------

    describe('setTheme', () => {
        test('should set theme to dark', () => {
            useSettingsStore.getState().setTheme('dark');
            assert.strictEqual(useSettingsStore.getState().appearance.theme, 'dark');
        });

        test('should set theme to system', () => {
            useSettingsStore.getState().setTheme('system');
            assert.strictEqual(useSettingsStore.getState().appearance.theme, 'system');
        });

        test('should set theme to dim (AR-63 Ledger three-way theme)', () => {
            useSettingsStore.getState().setTheme('dim');
            assert.strictEqual(useSettingsStore.getState().appearance.theme, 'dim');
        });
    });

    describe('setDensity (AR-64)', () => {
        test('should default to comfortable', () => {
            assert.strictEqual(useSettingsStore.getState().appearance.density, 'comfortable');
            assert.strictEqual(useSettingsStore.getState().appearance.compactMode, false);
        });

        test('should switch to compact and mirror compactMode', () => {
            useSettingsStore.getState().setDensity('compact');
            assert.strictEqual(useSettingsStore.getState().appearance.density, 'compact');
            assert.strictEqual(useSettingsStore.getState().appearance.compactMode, true);
        });

        test('should switch back to comfortable and clear compactMode', () => {
            useSettingsStore.getState().setDensity('compact');
            useSettingsStore.getState().setDensity('comfortable');
            assert.strictEqual(useSettingsStore.getState().appearance.density, 'comfortable');
            assert.strictEqual(useSettingsStore.getState().appearance.compactMode, false);
        });
    });

    describe('toggleCompactMode', () => {
        test('should flip compactMode and keep density in sync', () => {
            assert.strictEqual(useSettingsStore.getState().appearance.compactMode, false);
            useSettingsStore.getState().toggleCompactMode();
            assert.strictEqual(useSettingsStore.getState().appearance.compactMode, true);
            assert.strictEqual(useSettingsStore.getState().appearance.density, 'compact');
            useSettingsStore.getState().toggleCompactMode();
            assert.strictEqual(useSettingsStore.getState().appearance.compactMode, false);
            assert.strictEqual(useSettingsStore.getState().appearance.density, 'comfortable');
        });
    });

    describe('setAccent (AR-65)', () => {
        test('should default to Forest green', () => {
            assert.strictEqual(useSettingsStore.getState().appearance.accent, '#17cf54');
        });

        test('should accept a preset accent hex', () => {
            useSettingsStore.getState().setAccent('#6366f1');
            assert.strictEqual(useSettingsStore.getState().appearance.accent, '#6366f1');
        });

        test('should not mutate unrelated appearance fields', () => {
            useSettingsStore.getState().setTheme('dim');
            useSettingsStore.getState().setAccent('#f59e0b');
            const a = useSettingsStore.getState().appearance;
            assert.strictEqual(a.theme, 'dim');
            assert.strictEqual(a.accent, '#f59e0b');
        });
    });

    describe('toggleAnimations', () => {
        test('should flip animationsEnabled', () => {
            assert.strictEqual(useSettingsStore.getState().appearance.animationsEnabled, true);
            useSettingsStore.getState().toggleAnimations();
            assert.strictEqual(useSettingsStore.getState().appearance.animationsEnabled, false);
        });
    });

    // -----------------------------------------------------------------------
    // Risk Policy
    // -----------------------------------------------------------------------

    describe('updateRiskPolicy', () => {
        test('should default Risk Policy Engine bucket and theme caps', () => {
            const riskPolicy = useSettingsStore.getState().riskPolicy;

            assert.ok(riskPolicy.bucketPolicies.find((policy) => policy.bucket === 'core'));
            assert.strictEqual(
                riskPolicy.bucketPolicies.find((policy) => policy.bucket === 'speculative')?.maxPct,
                5,
            );
            assert.strictEqual(riskPolicy.themeCaps.ai_infrastructure, 35);
            assert.strictEqual(riskPolicy.themeCaps.employer_linked_wealth, 25);
            assert.deepStrictEqual(riskPolicy.cashJobs, []);
            assert.strictEqual(riskPolicy.cashDeploymentRule.enabled, false);
            assert.strictEqual(riskPolicy.cashDeploymentRule.percentOfExcess, 25);
            assert.strictEqual(riskPolicy.employerStockPlan.targetAllocationPct, 20);
            assert.deepStrictEqual(riskPolicy.employerStockPlan.symbols, ['GOOG', 'GOOGL']);
            assert.strictEqual(riskPolicy.employerStockPlan.state, 'draft');
            assert.strictEqual(riskPolicy.optionsRiskPolicy.maxPositionPremiumPct, 2);
            assert.strictEqual(riskPolicy.optionsRiskPolicy.maxTotalPremiumPct, 5);
            assert.ok(riskPolicy.sellDisciplineRules.find((rule) => rule.type === 'allocation_cap'));
            assert.ok(riskPolicy.sellDisciplineRules.find((rule) => rule.type === 'stale_thesis'));
            assert.strictEqual(riskPolicy.churnPolicy.windowDays, 90);
            assert.strictEqual(riskPolicy.churnPolicy.watchRepeatSymbols, 1);
            assert.strictEqual(riskPolicy.churnPolicy.breachRepeatSymbols, 3);
        });

        test('should update bucket policies without clobbering theme caps', () => {
            useSettingsStore.getState().updateRiskPolicy({
                bucketPolicies: [
                    { bucket: 'core', targetPct: 80, minPct: 60, maxPct: 90 },
                    { bucket: 'active', targetPct: 15, maxPct: 20 },
                    { bucket: 'speculative', targetPct: 3, maxPct: 4 },
                    { bucket: 'special_situation', targetPct: 1, maxPct: 2 },
                    { bucket: 'cash_reserve', targetPct: 1, maxPct: 10 },
                    { bucket: 'unassigned', targetPct: 0, maxPct: 0 },
                ],
            });

            const riskPolicy = useSettingsStore.getState().riskPolicy;
            assert.strictEqual(
                riskPolicy.bucketPolicies.find((policy) => policy.bucket === 'speculative')?.maxPct,
                4,
            );
            assert.strictEqual(riskPolicy.themeCaps.ai_infrastructure, 35);
        });

        test('should merge theme cap updates without clobbering bucket policies', () => {
            useSettingsStore.getState().updateRiskPolicy({
                themeCaps: { ai_infrastructure: 30 },
            });

            const riskPolicy = useSettingsStore.getState().riskPolicy;
            assert.strictEqual(riskPolicy.themeCaps.ai_infrastructure, 30);
            assert.ok(riskPolicy.bucketPolicies.find((policy) => policy.bucket === 'core'));
        });

        test('should update cash jobs without clobbering bucket or theme policy', () => {
            useSettingsStore.getState().updateRiskPolicy({
                cashJobs: [
                    { id: 'cash-emergency', type: 'emergency_fund', label: 'Emergency fund', amount: 50_000 },
                    { id: 'cash-deploy', type: 'scheduled_deployment', label: 'Scheduled deployment', amount: 25_000 },
                ],
            });

            const riskPolicy = useSettingsStore.getState().riskPolicy;
            assert.strictEqual(riskPolicy.cashJobs.length, 2);
            assert.strictEqual(riskPolicy.cashJobs[0].amount, 50_000);
            assert.strictEqual(riskPolicy.themeCaps.ai_infrastructure, 35);
            assert.ok(riskPolicy.bucketPolicies.find((policy) => policy.bucket === 'core'));
        });

        test('should merge cash deployment rule updates', () => {
            useSettingsStore.getState().updateRiskPolicy({
                cashDeploymentRule: {
                    enabled: true,
                    cadence: 'monthly',
                    percentOfExcess: 20,
                    destination: 'Core index allocation',
                    nextDueDate: '2026-06-01',
                },
            });
            useSettingsStore.getState().updateRiskPolicy({
                cashDeploymentRule: {
                    ...useSettingsStore.getState().riskPolicy.cashDeploymentRule,
                    percentOfExcess: 25,
                },
            });

            const rule = useSettingsStore.getState().riskPolicy.cashDeploymentRule;
            assert.strictEqual(rule.enabled, true);
            assert.strictEqual(rule.percentOfExcess, 25);
            assert.strictEqual(rule.destination, 'Core index allocation');
            assert.strictEqual(rule.nextDueDate, '2026-06-01');
        });

        test('should merge options risk policy updates without clobbering cash policy', () => {
            useSettingsStore.getState().updateRiskPolicy({
                cashJobs: [
                    { id: 'cash-tax', type: 'tax_reserve', label: 'Tax reserve', amount: 10_000 },
                ],
            });
            useSettingsStore.getState().updateRiskPolicy({
                optionsRiskPolicy: {
                    ...useSettingsStore.getState().riskPolicy.optionsRiskPolicy,
                    maxPositionPremiumPct: 1.5,
                    maxTotalPremiumPct: 4,
                },
            });

            const riskPolicy = useSettingsStore.getState().riskPolicy;
            assert.strictEqual(riskPolicy.optionsRiskPolicy.maxPositionPremiumPct, 1.5);
            assert.strictEqual(riskPolicy.optionsRiskPolicy.maxTotalPremiumPct, 4);
            assert.strictEqual(riskPolicy.optionsRiskPolicy.watchPositionPremiumPct, 1);
            assert.strictEqual(riskPolicy.cashJobs[0].type, 'tax_reserve');
        });

        test('should update sell discipline rules without clobbering options policy', () => {
            useSettingsStore.getState().updateRiskPolicy({
                sellDisciplineRules: [
                    {
                        id: 'sell-aapl-test',
                        type: 'allocation_cap',
                        label: 'AAPL trim cap',
                        action: 'trim',
                        state: 'active',
                        symbol: 'AAPL',
                        thresholdPct: 10,
                        noAdd: true,
                    },
                ],
            });

            const riskPolicy = useSettingsStore.getState().riskPolicy;
            assert.strictEqual(riskPolicy.sellDisciplineRules.length, 1);
            assert.strictEqual(riskPolicy.sellDisciplineRules[0].symbol, 'AAPL');
            assert.strictEqual(riskPolicy.sellDisciplineRules[0].noAdd, true);
            assert.strictEqual(riskPolicy.optionsRiskPolicy.maxTotalPremiumPct, 5);
        });

        test('should update churn policy without clobbering sell discipline rules', () => {
            useSettingsStore.getState().updateRiskPolicy({
                churnPolicy: {
                    windowDays: 45,
                    watchRepeatSymbols: 2,
                    breachRepeatSymbols: 4,
                },
            });

            const riskPolicy = useSettingsStore.getState().riskPolicy;
            assert.strictEqual(riskPolicy.churnPolicy.windowDays, 45);
            assert.strictEqual(riskPolicy.churnPolicy.watchRepeatSymbols, 2);
            assert.strictEqual(riskPolicy.churnPolicy.breachRepeatSymbols, 4);
            assert.ok(riskPolicy.sellDisciplineRules.find((rule) => rule.type === 'allocation_cap'));
        });

        test('should update employer stock plan without clobbering cash or churn policy', () => {
            useSettingsStore.getState().updateRiskPolicy({
                cashJobs: [
                    { id: 'cash-tax', type: 'tax_reserve', label: 'Tax reserve', amount: 25_000 },
                ],
                churnPolicy: {
                    windowDays: 45,
                    watchRepeatSymbols: 2,
                    breachRepeatSymbols: 4,
                },
            });
            useSettingsStore.getState().updateRiskPolicy({
                employerStockPlan: {
                    ...useSettingsStore.getState().riskPolicy.employerStockPlan,
                    state: 'active',
                    targetAllocationPct: 15,
                    nextActionDate: '2026-06-01',
                },
            });

            const riskPolicy = useSettingsStore.getState().riskPolicy;
            assert.strictEqual(riskPolicy.employerStockPlan.state, 'active');
            assert.strictEqual(riskPolicy.employerStockPlan.targetAllocationPct, 15);
            assert.strictEqual(riskPolicy.employerStockPlan.nextActionDate, '2026-06-01');
            assert.deepStrictEqual(riskPolicy.employerStockPlan.symbols, ['GOOG', 'GOOGL']);
            assert.strictEqual(riskPolicy.cashJobs[0].type, 'tax_reserve');
            assert.strictEqual(riskPolicy.churnPolicy.windowDays, 45);
        });
    });

    // -----------------------------------------------------------------------
    // Tags CRUD
    // -----------------------------------------------------------------------

    describe('addTag', () => {
        test('should append a tag with a unique id', () => {
            const before = useSettingsStore.getState().tags.length;
            useSettingsStore.getState().addTag({ name: 'NewTag', color: '#abcdef' });
            const tags = useSettingsStore.getState().tags;
            assert.strictEqual(tags.length, before + 1);
            const added = tags[tags.length - 1];
            assert.strictEqual(added.name, 'NewTag');
            assert.strictEqual(added.color, '#abcdef');
            assert.ok(added.id, 'Tag should have an id');
        });

        test('should generate unique ids for different tags', () => {
            useSettingsStore.getState().addTag({ name: 'A', color: '#111111' });
            useSettingsStore.getState().addTag({ name: 'B', color: '#222222' });
            const tags = useSettingsStore.getState().tags;
            const ids = tags.map((t: Tag) => t.id);
            const unique = new Set(ids);
            assert.strictEqual(unique.size, ids.length, 'All tag IDs should be unique');
        });
    });

    describe('updateTag', () => {
        test('should update only specified fields of a known tag', () => {
            const tags = useSettingsStore.getState().tags;
            const target = tags[0]; // 'Growth'
            useSettingsStore.getState().updateTag(target.id, { name: 'Renamed' });
            const updated = useSettingsStore.getState().tags.find((t: Tag) => t.id === target.id);
            assert.ok(updated);
            assert.strictEqual(updated!.name, 'Renamed');
            assert.strictEqual(updated!.color, target.color); // unchanged
        });

        test('should leave list unchanged for unknown id', () => {
            const before = JSON.stringify(useSettingsStore.getState().tags);
            useSettingsStore.getState().updateTag('nonexistent-id', { name: 'Ghost' });
            const after = JSON.stringify(useSettingsStore.getState().tags);
            assert.strictEqual(before, after);
        });
    });

    describe('deleteTag', () => {
        test('should remove a tag by id', () => {
            const tags = useSettingsStore.getState().tags;
            const target = tags[0];
            const before = tags.length;
            useSettingsStore.getState().deleteTag(target.id);
            assert.strictEqual(useSettingsStore.getState().tags.length, before - 1);
            assert.ok(!useSettingsStore.getState().tags.find((t: Tag) => t.id === target.id));
        });

        test('should leave list unchanged for unknown id', () => {
            const before = useSettingsStore.getState().tags.length;
            useSettingsStore.getState().deleteTag('nonexistent-id');
            assert.strictEqual(useSettingsStore.getState().tags.length, before);
        });
    });

    // -----------------------------------------------------------------------
    // Accounts
    // -----------------------------------------------------------------------

    describe('syncAccount', () => {
        test('should update lastSynced for the given account id', () => {
            const before = useSettingsStore.getState().accounts.find((a: ConnectedAccount) => a.id === 'fidelity')!.lastSynced;
            useSettingsStore.getState().syncAccount('fidelity');
            const after = useSettingsStore.getState().accounts.find((a: ConnectedAccount) => a.id === 'fidelity')!.lastSynced;
            assert.notStrictEqual(before, after, 'lastSynced should have changed');
        });

        test('should not modify other accounts', () => {
            const vanguardBefore = useSettingsStore.getState().accounts.find((a: ConnectedAccount) => a.id === 'vanguard')!.lastSynced;
            useSettingsStore.getState().syncAccount('fidelity');
            const vanguardAfter = useSettingsStore.getState().accounts.find((a: ConnectedAccount) => a.id === 'vanguard')!.lastSynced;
            assert.strictEqual(vanguardBefore, vanguardAfter);
        });

        test('should not mark Plaid token-missing accounts sync-ready', () => {
            useSettingsStore.getState().connectPlaidAccounts([
                {
                    id: 'plaid-token-missing-sync',
                    provider: 'plaid',
                    name: 'Plaid Token Missing Sync',
                    type: 'Brokerage · Plaid Sandbox Investments',
                    accountMask: '****2222',
                    holdings: 1,
                    accountValue: 42_000,
                    lastSynced: 'May 16, 2026',
                    status: 'needs-review',
                    institutionId: 'ins_109508',
                    institutionName: 'Plaid Sandbox Investments',
                    plaidAccountId: 'plaid-token-missing-sync',
                    plaidItemId: 'item-token-missing-sync',
                    capabilities: ['balances', 'holdings', 'transactions', 'investments'],
                    syncReady: false,
                    tokenStorageMode: 'postgres',
                    tokenStorageDurable: false,
                    providerItemStatus: 'missing-token',
                },
            ]);

            useSettingsStore.getState().syncAccount('plaid-token-missing-sync');
            const account = useSettingsStore.getState().accounts.find(
                (a: ConnectedAccount) => a.id === 'plaid-token-missing-sync',
            )!;

            assert.strictEqual(account.syncReady, false);
            assert.strictEqual(account.providerItemStatus, 'missing-token');
        });
    });

    describe('reconnectAccount', () => {
        test('should set non-Plaid accounts to reconciled and clear errorMessage', () => {
            // ibkr starts with status 'needs-review' and an errorMessage
            const before = useSettingsStore.getState().accounts.find((a: ConnectedAccount) => a.id === 'ibkr')!;
            assert.strictEqual(before.status, 'needs-review');
            assert.ok(before.errorMessage);

            useSettingsStore.getState().reconnectAccount('ibkr');
            const after = useSettingsStore.getState().accounts.find((a: ConnectedAccount) => a.id === 'ibkr')!;
            assert.strictEqual(after.status, 'reconciled');
            assert.strictEqual(after.errorMessage, undefined);
        });

        test('should not mark Plaid accounts sync-ready without a fresh token exchange', () => {
            useSettingsStore.getState().connectPlaidAccounts([
                {
                    id: 'plaid-token-missing',
                    provider: 'plaid',
                    name: 'Plaid Missing Token',
                    type: 'Brokerage · Plaid Sandbox Investments',
                    accountMask: '****0000',
                    holdings: 1,
                    accountValue: 125_430.42,
                    lastSynced: 'May 16, 2026',
                    status: 'reconciled',
                    institutionId: 'ins_109508',
                    institutionName: 'Plaid Sandbox Investments',
                    plaidAccountId: 'plaid-token-missing',
                    plaidItemId: 'item-token-missing',
                    capabilities: ['balances', 'holdings', 'transactions', 'investments'],
                    syncReady: true,
                    tokenStorageMode: 'memory',
                    tokenStorageDurable: false,
                    providerItemStatus: 'active',
                },
            ]);

            useSettingsStore.getState().reconnectAccount('plaid-token-missing');
            const after = useSettingsStore.getState().accounts.find(
                (a: ConnectedAccount) => a.id === 'plaid-token-missing',
            )!;

            assert.strictEqual(after.status, 'needs-review');
            assert.strictEqual(after.syncReady, false);
            assert.strictEqual(after.providerItemStatus, 'missing-token');
            assert.match(after.errorMessage ?? '', /Plaid Link/);
        });
    });

    describe('removeAccount', () => {
        test('should remove an account by id', () => {
            const before = useSettingsStore.getState().accounts.length;
            useSettingsStore.getState().removeAccount('ibkr');
            const after = useSettingsStore.getState().accounts;
            assert.strictEqual(after.length, before - 1);
            assert.ok(!after.find((a: ConnectedAccount) => a.id === 'ibkr'));
        });

        test('should leave list unchanged for unknown id', () => {
            const before = useSettingsStore.getState().accounts.length;
            useSettingsStore.getState().removeAccount('unknown');
            assert.strictEqual(useSettingsStore.getState().accounts.length, before);
        });
    });

    describe('connectPlaidAccounts', () => {
        test('should append Plaid account metadata without storing secrets', () => {
            useSettingsStore.getState().connectPlaidAccounts([
                {
                    id: 'plaid-plaid-growth-brokerage',
                    provider: 'plaid',
                    name: 'Plaid Growth Brokerage',
                    type: 'Brokerage · Plaid Sandbox Investments',
                    accountMask: '****0000',
                    holdings: 1,
                    accountValue: 125_430.42,
                    lastSynced: 'May 16, 2026',
                    status: 'reconciled',
                    institutionId: 'ins_109508',
                    institutionName: 'Plaid Sandbox Investments',
                    plaidAccountId: 'plaid-growth-brokerage',
                    plaidItemId: 'item-plaid-sandbox-investments',
                    capabilities: ['balances', 'holdings', 'transactions', 'investments'],
                    syncReady: true,
                    tokenStorageMode: 'postgres',
                    tokenStorageDurable: true,
                    providerItemStatus: 'active',
                },
            ]);

            const account = useSettingsStore.getState().accounts.find(
                (a: ConnectedAccount) => a.plaidAccountId === 'plaid-growth-brokerage',
            );

            assert.ok(account);
            assert.strictEqual(account!.provider, 'plaid');
            assert.strictEqual(account!.institutionName, 'Plaid Sandbox Investments');
            assert.ok(account!.capabilities?.includes('investments'));
            assert.strictEqual(account!.syncReady, true);
            assert.strictEqual(account!.tokenStorageMode, 'postgres');
            assert.strictEqual(account!.tokenStorageDurable, true);
            assert.ok(!JSON.stringify(account).includes('access-sandbox'));
        });

        test('should update an existing Plaid account instead of duplicating it', () => {
            const plaidAccount: PlaidConnectedAccountInput = {
                id: 'plaid-plaid-growth-brokerage',
                provider: 'plaid' as const,
                name: 'Plaid Growth Brokerage',
                type: 'Brokerage · Plaid Sandbox Investments',
                accountMask: '****0000',
                holdings: 1,
                accountValue: 125_430.42,
                lastSynced: 'May 16, 2026',
                status: 'reconciled' as const,
                institutionId: 'ins_109508',
                institutionName: 'Plaid Sandbox Investments',
                plaidAccountId: 'plaid-growth-brokerage',
                plaidItemId: 'item-plaid-sandbox-investments',
                capabilities: ['balances', 'holdings', 'transactions', 'investments'],
            };

            useSettingsStore.getState().connectPlaidAccounts([plaidAccount]);
            useSettingsStore.getState().connectPlaidAccounts([
                {
                    ...plaidAccount,
                    accountValue: 130_000,
                    lastSynced: 'May 17, 2026',
                },
            ]);

            const matches = useSettingsStore.getState().accounts.filter(
                (a: ConnectedAccount) => a.plaidAccountId === 'plaid-growth-brokerage',
            );
            assert.strictEqual(matches.length, 1);
            assert.strictEqual(matches[0].accountValue, 130_000);
            assert.strictEqual(matches[0].lastSynced, 'May 17, 2026');
        });

        test('should update a relinked Plaid account when Plaid returns a new account id', () => {
            const plaidAccount: PlaidConnectedAccountInput = {
                id: 'plaid-original-checking-id',
                provider: 'plaid',
                name: 'Plaid Checking',
                type: 'Checking · First Platypus Bank',
                accountMask: '****0000',
                holdings: 0,
                accountValue: 110,
                lastSynced: 'May 16, 2026',
                status: 'reconciled',
                institutionId: 'ins_109508',
                institutionName: 'First Platypus Bank',
                plaidAccountId: 'original-checking-id',
                plaidItemId: 'original-item-id',
                capabilities: ['balances', 'transactions'],
            };

            useSettingsStore.getState().connectPlaidAccounts([plaidAccount]);
            useSettingsStore.getState().connectPlaidAccounts([
                {
                    ...plaidAccount,
                    id: 'plaid-relinked-checking-id',
                    plaidAccountId: 'relinked-checking-id',
                    plaidItemId: 'relinked-item-id',
                    accountValue: 125,
                    lastSynced: 'May 17, 2026',
                },
            ]);

            const matches = useSettingsStore.getState().accounts.filter(
                (a: ConnectedAccount) =>
                    a.provider === 'plaid' &&
                    a.institutionId === 'ins_109508' &&
                    a.name === 'Plaid Checking' &&
                    a.accountMask === '****0000',
            );
            assert.strictEqual(matches.length, 1);
            assert.strictEqual(matches[0].plaidAccountId, 'relinked-checking-id');
            assert.strictEqual(matches[0].plaidItemId, 'relinked-item-id');
            assert.strictEqual(matches[0].accountValue, 125);
        });
    });

    // -----------------------------------------------------------------------
    // API Keys
    // -----------------------------------------------------------------------

    describe('setProviderKey', () => {
        test('should set a provider key without touching others', () => {
            useSettingsStore.getState().setProviderKey('polygon', 'poly-abc-123');
            const keys = useSettingsStore.getState().apiKeys;
            assert.strictEqual(keys.polygon, 'poly-abc-123');
            assert.strictEqual(keys.alphaVantage, '');
            assert.strictEqual(keys.schwab, '');
        });

        test('should overwrite an existing key for the same provider', () => {
            useSettingsStore.getState().setProviderKey('alphaVantage', 'first');
            useSettingsStore.getState().setProviderKey('alphaVantage', 'second');
            assert.strictEqual(useSettingsStore.getState().apiKeys.alphaVantage, 'second');
        });
    });

    describe('clearProviderKey', () => {
        test('should reset a provider key to empty string', () => {
            useSettingsStore.getState().setProviderKey('polygon', 'poly-abc-123');
            useSettingsStore.getState().clearProviderKey('polygon');
            assert.strictEqual(useSettingsStore.getState().apiKeys.polygon, '');
        });
    });

    // -----------------------------------------------------------------------
    // Preferences
    // -----------------------------------------------------------------------

    describe('updatePreferences', () => {
        test('should merge partial preference updates', () => {
            useSettingsStore.getState().updatePreferences({ baseCurrency: 'EUR' });
            const prefs = useSettingsStore.getState().preferences;
            assert.strictEqual(prefs.baseCurrency, 'EUR');
            assert.strictEqual(prefs.dateFormat, 'MM/DD/YYYY'); // default preserved
            assert.strictEqual(prefs.marketDataRefreshSeconds, 60); // default preserved
        });

        test('should update multiple preference fields at once', () => {
            useSettingsStore.getState().updatePreferences({
                dateFormat: 'YYYY-MM-DD',
                numberFormat: 'de-DE',
                marketDataRefreshSeconds: 30,
            });
            const prefs = useSettingsStore.getState().preferences;
            assert.strictEqual(prefs.dateFormat, 'YYYY-MM-DD');
            assert.strictEqual(prefs.numberFormat, 'de-DE');
            assert.strictEqual(prefs.marketDataRefreshSeconds, 30);
        });
    });

    // -----------------------------------------------------------------------
    // Reset
    // -----------------------------------------------------------------------

    describe('resetSettings', () => {
        test('should restore all slices to their defaults', () => {
            // Mutate every slice
            useSettingsStore.getState().updateProfile({ fullName: 'Changed' });
            useSettingsStore.getState().updateNotification('portfolioUpdates', false);
            useSettingsStore.getState().toggleTwoFactor();
            useSettingsStore.getState().setTheme('dark');
            useSettingsStore.getState().setDensity('compact');
            useSettingsStore.getState().setAccent('#6366f1');
            useSettingsStore.getState().setProviderKey('polygon', 'secret');
            useSettingsStore.getState().updatePreferences({ baseCurrency: 'EUR' });
            useSettingsStore.getState().updateAlphaRadarDeliveryChannel('slack', true);
            useSettingsStore.getState().updateAlphaRadarDelivery({ tickerFilters: ['AAPL'] });
            useSettingsStore.getState().deleteTag(useSettingsStore.getState().tags[0].id);
            useSettingsStore.getState().removeAccount('fidelity');

            // Reset
            useSettingsStore.getState().resetSettings();

            const state = useSettingsStore.getState();
            assert.strictEqual(state.profile.fullName, 'John Doe');
            assert.strictEqual(state.notifications.portfolioUpdates, true);
            assert.strictEqual(state.notifications.alphaRadarSignals, true);
            assert.strictEqual(state.alphaRadarDelivery.channels.inApp, true);
            assert.strictEqual(state.alphaRadarDelivery.channels.slack, false);
            assert.deepStrictEqual(state.alphaRadarDelivery.tickerFilters, []);
            assert.strictEqual(state.security.twoFactorEnabled, false);
            assert.strictEqual(state.appearance.theme, 'light');
            assert.strictEqual(state.appearance.density, 'comfortable');
            assert.strictEqual(state.appearance.accent, '#17cf54');
            assert.strictEqual(state.apiKeys.polygon, '');
            assert.strictEqual(state.preferences.baseCurrency, 'USD');
            assert.strictEqual(state.tags.length, 3);
            assert.strictEqual(state.accounts.length, 3);
        });
    });
});
