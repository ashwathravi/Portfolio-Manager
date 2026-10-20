import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { plaidAccountToConnectedAccount } from '@/lib/plaid/link';
import type { PlaidDiscoveredAccount } from '@/lib/plaid/types';
import {
    DEFAULT_CASH_DEPLOYMENT_RULE,
    DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
    SELL_DISCIPLINE_TRIGGER_TYPES,
    computeRiskPolicyDashboard,
    reactivateSellDisciplineRule,
    resolveSellDisciplineRule,
    snoozeSellDisciplineRule,
    type SellDisciplineRule,
} from '@/lib/risk-policy';
import { SETTINGS_VERSION } from '@/lib/settings/document';
import { LANDING_PAGES } from '@/lib/stores/settingsMigrations';
import {
    ACCENT_PRESETS,
    COOLDOWN_OPTIONS,
    defaultPersistedSettings,
    migrateSettings,
    normalizeSettings,
    persistedSettings,
    useSettingsStore,
    type PersistedSettings,
    type SettingsState,
} from '@/lib/stores/settingsStore';

import { findSettingsIssue, sanitizeSettings, type PersistedSettingsDocument } from './settings-slices';
import { settingsDocumentSchema } from './user-settings';

type Path = readonly PropertyKey[];
const MISSING = Symbol('missing');

/** `root` with the value at `path` replaced (or removed, for MISSING). */
function withValue<T>(root: T, path: Path, value: unknown): T {
    const copy = structuredClone(root) as Record<PropertyKey, unknown>;
    let node = copy;
    for (const key of path.slice(0, -1)) node = node[key] as Record<PropertyKey, unknown>;
    if (value === MISSING) delete node[path.at(-1)!];
    else node[path.at(-1)!] = value;
    return copy as T;
}

function valueAt(root: unknown, path: Path): unknown {
    return path.reduce<unknown>((node, key) => (node as Record<PropertyKey, unknown> | undefined)?.[key], root);
}

/** A manual account as the Settings page lists one. */
const MANUAL_ACCOUNT = {
    id: 'my-401k',
    provider: 'manual',
    name: 'Employer 401(k)',
    type: 'Retirement',
    accountMask: '****4321',
    holdings: 5,
    accountValue: 82_000,
    lastSynced: 'Oct 19, 3:45 PM',
    status: 'reconciled',
} as const;

/** The defaults with one manual account, so account fields can be tried too. */
function baseline(): PersistedSettings {
    return { ...defaultPersistedSettings(), accounts: [structuredClone(MANUAL_ACCOUNT)] };
}

/** The save error for the baseline with the value at `path` replaced, or null. */
function issueFor(path: Path, value: unknown, version = SETTINGS_VERSION): string | null {
    return findSettingsIssue(withValue(baseline(), path, value), version)?.message ?? null;
}

function accepts(path: Path, ...values: unknown[]) {
    for (const value of values) assert.equal(issueFor(path, value), null, `${path.join('.')} = ${JSON.stringify(value)}`);
}

function refuses(path: Path, ...values: unknown[]) {
    for (const value of values) assert.notEqual(issueFor(path, value), null, `${path.join('.')} = ${JSON.stringify(value)}`);
}

/** What the browser sends: the document as JSON. */
function overTheWire<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The checks every document the app writes must pass: the slices' schemas,
 * the PUT body as JSON, and a load that changes nothing.
 */
function assertSavable(state: SettingsState, label: string) {
    const document = persistedSettings(state);
    assert.equal(findSettingsIssue(document, SETTINGS_VERSION)?.message ?? null, null, label);
    const body = overTheWire({ version: SETTINGS_VERSION, settings: document, baseUpdatedAt: null });
    const parsed = settingsDocumentSchema.safeParse(body);
    assert.equal(parsed.success, true, `${label}: ${parsed.error?.issues[0]?.message}`);
    assert.deepStrictEqual(normalizeSettings(body.settings), body.settings, `${label}: loading it back changes it`);
}

function discoveredAccount(overrides: Partial<PlaidDiscoveredAccount> = {}): PlaidDiscoveredAccount {
    return {
        plaidAccountId: 'acc-growth',
        name: 'Plaid Growth Brokerage',
        mask: '0000',
        type: 'investment',
        subtype: 'brokerage',
        currentBalance: 125_430.42,
        isoCurrencyCode: 'USD',
        institution: { id: 'ins_109508', name: 'Plaid Sandbox Investments' },
        capabilities: ['balances', 'holdings', 'transactions', 'investments'],
        verificationStatus: 'automatically_verified',
        ...overrides,
    };
}

/** A rule as SellDisciplineCard's "Add rule" builds one. */
function cardRule(type: SellDisciplineRule['type'], index: number): SellDisciplineRule {
    const base: SellDisciplineRule = {
        id: `sell-${index.toString(36)}`,
        type,
        label: `AAPL ${type}`,
        action: 'trim',
        state: 'active',
        symbol: index % 2 ? 'AAPL' : undefined,
        noAdd: index % 2 === 0,
    };
    if (type === 'target_price') return { ...base, targetPrice: 250 };
    if (type === 'target_allocation') return { ...base, targetAllocationPct: 150 };
    if (type === 'employer_vest') return { ...base, vestDate: '2026-11-15' };
    return { ...base, thresholdPct: 0 };
}

const store = () => useSettingsStore.getState();

/**
 * Every settings action, with the values the Settings page, Tweaks panel and
 * Plaid Link hand it.
 */
const ACTIONS: ReadonlyArray<readonly [string, () => void]> = [
    ['updateProfile', () => store().updateProfile({ fullName: 'Jane Smith', email: 'jane@example.com', phone: '+1 (555) 000-1111' })],
    ['updateProfile, back to the account name', () => store().updateProfile({ fullName: '' })],
    ['updateNotification', () => {
        for (const key of Object.keys(store().notifications) as Array<keyof SettingsState['notifications']>) {
            store().updateNotification(key, !store().notifications[key]);
        }
    }],
    ['updateAlphaRadarDelivery', () => store().updateAlphaRadarDelivery({
        enabled: false,
        failureSummaries: false,
        overlapOnly: true,
        tickerFilters: 'aapl, msft,,'.split(',').map((item) => item.trim().toUpperCase()).filter(Boolean),
    })],
    ['updateAlphaRadarDeliveryChannel', () => {
        for (const channel of ['inApp', 'email', 'slack', 'telegram'] as const) store().updateAlphaRadarDeliveryChannel(channel, true);
    }],
    ['toggleTwoFactor and setApiKey (not persisted)', () => {
        store().toggleTwoFactor();
        store().setApiKey('session-key');
    }],
    ['setTheme', () => {
        for (const theme of ['dim', 'dark', 'system', 'light'] as const) store().setTheme(theme);
    }],
    ['setDensity', () => store().setDensity('compact')],
    ['toggleCompactMode', () => store().toggleCompactMode()],
    ['toggleAnimations', () => store().toggleAnimations()],
    ['setAccent', () => {
        for (const preset of ACCENT_PRESETS) store().setAccent(preset.value);
    }],
    ['setProviderKey and clearProviderKey (not persisted)', () => {
        store().setProviderKey('polygon', 'pk-1');
        store().clearProviderKey('polygon');
    }],
    ['updatePreferences, every option', () => {
        for (const baseCurrency of ['EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'INR', 'USD'] as const) store().updatePreferences({ baseCurrency });
        for (const dateFormat of ['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'] as const) store().updatePreferences({ dateFormat });
        for (const numberFormat of ['en-GB', 'de-DE', 'fr-FR', 'en-US'] as const) store().updatePreferences({ numberFormat });
        for (const defaultLandingPage of LANDING_PAGES) store().updatePreferences({ defaultLandingPage });
    }],
    ['updatePreferences, the form at its bounds', () => {
        store().updatePreferences({ ...store().preferences, marketDataRefreshSeconds: 15 });
        store().updatePreferences({ ...store().preferences, marketDataRefreshSeconds: 3600 });
    }],
    ['addTag, updateTag and deleteTag', () => {
        store().addTag({ name: 'Income', color: '#3b82f6' });
        store().addTag({ name: 'Short', color: '#fff' });
        store().updateTag('1', { name: 'Compounders', color: '#0d9488' });
        store().deleteTag('2');
    }],
    ['connectPlaidAccounts', () => store().connectPlaidAccounts([
        plaidAccountToConnectedAccount({ account: discoveredAccount(), itemId: 'item-1', lastSynced: 'Oct 19, 2026', tokenStorageMode: 'postgres', tokenStorageDurable: true }),
        // A credit card owes money; no mask; Plaid can't verify it; no token stored.
        plaidAccountToConnectedAccount({
            account: discoveredAccount({ plaidAccountId: 'acc-card', name: 'Card', mask: '', type: 'credit', subtype: 'credit card', currentBalance: -1_250.5, capabilities: ['balances', 'transactions'], verificationStatus: 'unsupported' }),
            itemId: 'item-2',
            lastSynced: 'Oct 19, 2026',
            tokenStored: false,
        }),
    ])],
    ['syncAccount, reconnectAccount and removeAccount', () => {
        store().connectPlaidAccounts([plaidAccountToConnectedAccount({ account: discoveredAccount(), itemId: 'item-1', lastSynced: 'Oct 19, 2026' })]);
        useSettingsStore.setState({ accounts: [...store().accounts, structuredClone(MANUAL_ACCOUNT)] });
        for (const account of store().accounts) {
            store().syncAccount(account.id);
            store().reconnectAccount(account.id);
        }
        store().removeAccount(MANUAL_ACCOUNT.id);
    }],
    ['updateGuardrails, at the bounds GuardrailsCard clamps to', () => {
        store().updateGuardrails({ approvalThresholdUsd: 500, concentrationCapPct: 5 });
        store().updateGuardrails({ approvalThresholdUsd: 10_000_000, concentrationCapPct: 50 });
        store().updateGuardrails({ approvalThresholdEnabled: false, concentrationCapEnabled: false, thesisLinkageRequired: true });
    }],
    ['updateExecution, every cooldown', () => {
        for (const option of COOLDOWN_OPTIONS) store().updateExecution({ cooldownSeconds: option.value });
        store().updateExecution({ rationaleRequired: false });
    }],
    ['updateRiskPolicy: bucket policies as BucketPolicyCard edits them', () => store().updateRiskPolicy({
        bucketPolicies: store().riskPolicy.bucketPolicies.map((policy, index) => ({
            ...policy,
            // A cleared input, and values clamped to 0..100.
            targetPct: index === 0 ? undefined : policy.targetPct,
            minPct: index === 1 ? 0 : policy.minPct,
            maxPct: index === 2 ? 100 : policy.maxPct,
        })),
    })],
    ['updateRiskPolicy: theme caps', () => store().updateRiskPolicy({ themeCaps: { consumer_tech: 30, unknown: 0 } })],
    ['updateRiskPolicy: cash jobs and deployment as CashJobsCard edits them', () => {
        store().updateRiskPolicy({
            cashJobs: [
                { id: 'cash-emergency_fund', type: 'emergency_fund', label: 'Emergency fund', amount: 30_000 },
                { id: 'cash-unassigned', type: 'unassigned', label: 'Unassigned', amount: 0 },
            ],
        });
        const until = new Date('2026-10-19T08:00:00.000Z');
        until.setDate(until.getDate() + 30);
        store().updateRiskPolicy({
            cashDeploymentRule: {
                ...DEFAULT_CASH_DEPLOYMENT_RULE,
                enabled: true,
                cadence: 'quarterly',
                percentOfExcess: 100,
                destination: 'Total market index',
                nextDueDate: '2026-12-31',
                unassignedAcknowledgedUntil: until.toISOString().slice(0, 10),
            },
        });
        store().updateRiskPolicy({ cashDeploymentRule: { ...store().riskPolicy.cashDeploymentRule, percentOfExcess: 0, nextDueDate: undefined } });
    }],
    ['updateRiskPolicy: the employer-stock plan as EmployerStockPlanCard edits it', () => {
        const plan = store().riskPolicy.employerStockPlan;
        store().updateRiskPolicy({
            employerStockPlan: {
                ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
                ...plan,
                state: 'active',
                trimMethod: 'vest_driven',
                trimCadence: 'quarterly',
                defaultVestAction: 'hold',
                targetAllocationPct: 0,
                intermediateTargetPct: 100,
                trimAmountUsd: 10_000_000,
                trimPercentOfPosition: 12.5,
                plannedVestValueUsd: 0,
                taxReservePct: 100,
                nextActionDate: '2026-11-01',
                nextVestDate: '2026-12-15',
                destinationLabel: '',
                symbols: [...plan.symbols],
            },
        });
        // Clearing a date input.
        store().updateRiskPolicy({ employerStockPlan: { ...store().riskPolicy.employerStockPlan, nextActionDate: undefined } });
    }],
    ['updateRiskPolicy: options caps', () => store().updateRiskPolicy({ optionsRiskPolicy: { ...store().riskPolicy.optionsRiskPolicy, maxTotalPremiumPct: 4 } })],
    ['updateRiskPolicy: sell-discipline rules added, snoozed, resolved and reactivated', () => {
        const added = SELL_DISCIPLINE_TRIGGER_TYPES.map((type, index) => cardRule(type, index));
        store().updateRiskPolicy({ sellDisciplineRules: [...store().riskPolicy.sellDisciplineRules, ...added] });
        const [first, second, third] = store().riskPolicy.sellDisciplineRules;
        const at = '2026-10-19T08:00:00.000Z';
        store().updateRiskPolicy({
            sellDisciplineRules: [
                snoozeSellDisciplineRule(first, 'Waiting for the vest to settle', '2026-11-18T08:00:00.000Z', at),
                resolveSellDisciplineRule(second, 'Thesis re-underwritten last week', at),
                reactivateSellDisciplineRule(resolveSellDisciplineRule(third, 'Trimmed to target', at), 'Back above target', at),
                ...store().riskPolicy.sellDisciplineRules.slice(3),
            ],
        });
    }],
    ['updateRiskPolicy: churn policy at the bounds ChurnPolicyCard clamps to', () => {
        store().updateRiskPolicy({ churnPolicy: { windowDays: 14, watchRepeatSymbols: 1, breachRepeatSymbols: 25 } });
        store().updateRiskPolicy({ churnPolicy: { windowDays: 365, watchRepeatSymbols: 25, breachRepeatSymbols: 1 } });
    }],
    ['setShowSampleData', () => store().setShowSampleData(false)],
    ['resetSettings', () => store().resetSettings()],
];

describe('settings slice schemas', () => {
    beforeEach(() => store().resetSettings());

    test("describe the store's types exactly, field for field", () => {
        // Compile time: stops type-checking when a field is added, removed or
        // retyped in one and not the other.
        type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
        const same: Equals<PersistedSettingsDocument, PersistedSettings> = true;
        assert.equal(same, true);
    });

    test('accept the defaults', () => {
        assert.equal(findSettingsIssue(defaultPersistedSettings(), SETTINGS_VERSION), null);
        assertSavable(store(), 'defaults');
    });

    for (const [name, run] of ACTIONS) {
        test(`accept what ${name} leaves`, () => {
            run();
            assertSavable(store(), name);
        });
    }

    test('accept every step of all the actions in turn', () => {
        for (const [name, run] of ACTIONS.filter(([name]) => name !== 'resetSettings')) {
            run();
            assertSavable(store(), name);
        }
    });

    describe("accept each version's migration output", () => {
        /**
         * A document as the store wrote it at `version`: today's defaults
         * without what later versions added, plus what they removed.
         */
        function documentAt(version: number): Record<string, unknown> {
            const settings = overTheWire(defaultPersistedSettings()) as unknown as Record<string, Record<string, unknown>> & { accounts: unknown[] };
            const riskPolicy = settings.riskPolicy;
            if (version < 15) {
                delete settings.demo;
                settings.preferences.defaultLandingPage = '/analytics';
                settings.accounts = [
                    // A seeded example account, and one of the user's own.
                    { id: 'fidelity', name: 'Fidelity', type: 'Brokerage', accountMask: '****1234', holdings: 24, accountValue: 1_250_000, lastSynced: 'Oct 1, 9:00 AM', status: 'reconciled', provider: 'manual' },
                    structuredClone(MANUAL_ACCOUNT),
                ];
            }
            if (version < 14) settings.accounts = settings.accounts.map((account) => ({ ...(account as object), provider: undefined }));
            if (version < 13) delete riskPolicy.employerStockPlan;
            if (version < 12) delete riskPolicy.churnPolicy;
            if (version < 11) delete riskPolicy.sellDisciplineRules;
            if (version < 10) delete riskPolicy.optionsRiskPolicy;
            if (version < 9) {
                delete riskPolicy.cashJobs;
                delete riskPolicy.cashDeploymentRule;
            }
            if (version < 8) delete settings.riskPolicy;
            if (version < 7) delete settings.alphaRadarDelivery;
            if (version < 6) delete settings.notifications.alphaRadarSignals;
            if (version < 5) delete settings.execution.cooldownSeconds;
            if (version < 4) delete settings.execution;
            if (version < 3) delete settings.guardrails;
            if (version < 2) settings.appearance = { theme: 'dark', compactMode: true, animationsEnabled: false };
            return overTheWire(settings);
        }

        for (let version = 1; version <= SETTINGS_VERSION; version++) {
            test(`v${version}`, () => {
                const migrated = migrateSettings(documentAt(version), version);
                assert.equal(findSettingsIssue(overTheWire(migrated), SETTINGS_VERSION)?.message ?? null, null);
                // And loading it changes nothing.
                assert.deepStrictEqual(normalizeSettings(overTheWire(migrated)), overTheWire(migrated));
            });
        }
    });
});

describe('findSettingsIssue', () => {
    test('regression: refuses a mistyped optional field the defaults leave out', () => {
        // The Codex finding on PR #143: this crashed the Today page's risk policy.
        assert.equal(
            issueFor(['riskPolicy', 'employerStockPlan', 'nextActionDate'], {}),
            'settings.riskPolicy.employerStockPlan.nextActionDate must be a date (YYYY-MM-DD)',
        );
        accepts(['riskPolicy', 'employerStockPlan', 'nextActionDate'], '2026-11-01', MISSING, undefined);
        refuses(['riskPolicy', 'employerStockPlan', 'nextActionDate'], '', 'soon', '2026-02-30', '2026-11-01T00:00:00.000Z', 20261101);
    });

    test('names the field and what it must be', () => {
        assert.equal(issueFor(['profile', 'fullName'], 7), 'settings.profile.fullName must be text');
        assert.equal(issueFor(['profile', 'fullName'], MISSING), 'settings.profile.fullName is missing');
        assert.equal(issueFor(['profile', 'nickname'], 'JS'), 'settings.profile has an unknown field "nickname"');
        assert.equal(issueFor(['appearance', 'theme'], 'neon'), 'settings.appearance.theme must be one of "light", "dim", "dark", "system"');
        assert.equal(issueFor(['tags', 0, 'color'], 'green'), 'settings.tags[0].color must be a hex colour such as #17cf54');
        assert.equal(issueFor(['guardrails', 'concentrationCapPct'], 51), 'settings.guardrails.concentrationCapPct must be at most 50');
        assert.equal(issueFor(['guardrails', 'concentrationCapPct'], 4), 'settings.guardrails.concentrationCapPct must be at least 5');
        assert.equal(issueFor(['guardrails', 'concentrationCapPct'], 25.5), 'settings.guardrails.concentrationCapPct must be a whole number');
        assert.equal(issueFor(['accounts', 0, 'name'], ''), 'settings.accounts[0].name must not be empty');
        assert.equal(issueFor(['demo'], []), 'settings.demo must be an object');
        assert.equal(issueFor(['tags'], {}), 'settings.tags must be a list');
        assert.equal(issueFor(['demo', 'showSampleData'], 'no'), 'settings.demo.showSampleData must be true or false');
        assert.equal(issueFor(['riskPolicy', 'themeCaps', 'everything'], 10), 'settings.riskPolicy.themeCaps has an unknown field "everything"');
        assert.equal(issueFor(['riskPolicy', 'sellDisciplineRules', 1, 'snoozedUntil'], 'tomorrow'), 'settings.riskPolicy.sellDisciplineRules[1].snoozedUntil must be an ISO date-time');
    });

    test('refuses slices that are not persisted, such as API keys', () => {
        assert.equal(findSettingsIssue({ apiKeys: { polygon: 'pk' } }, SETTINGS_VERSION)?.message, 'settings has an unknown field "apiKeys"');
        assert.notEqual(findSettingsIssue({ security: {} }, 1), null);
        assert.equal(findSettingsIssue('everything', SETTINGS_VERSION)?.message, 'settings must be an object');
    });

    test('a document may leave out whole slices', () => {
        assert.equal(findSettingsIssue({}, SETTINGS_VERSION), null);
        assert.equal(findSettingsIssue({ demo: { showSampleData: false } }, SETTINGS_VERSION), null);
    });

    test('a current document has every field of the slices it holds', () => {
        assert.equal(findSettingsIssue({ appearance: { theme: 'dark' } }, SETTINGS_VERSION)?.message, 'settings.appearance.density is missing');
    });

    describe('a document from an older version', () => {
        // As if the current version had added the accent and accounts' lastSynced.
        const added = { [SETTINGS_VERSION]: ['appearance.accent', 'accounts[].lastSynced'] };
        const older = SETTINGS_VERSION - 1;
        const withoutField = (path: Path) => withValue(baseline(), path, MISSING);

        test('may leave out the fields added since', () => {
            assert.equal(findSettingsIssue(withoutField(['appearance', 'accent']), older, added), null);
            assert.equal(findSettingsIssue(withoutField(['accounts', 0, 'lastSynced']), older, added), null);
            // Not at the version that added them.
            assert.equal(findSettingsIssue(withoutField(['appearance', 'accent']), SETTINGS_VERSION, added)?.message, 'settings.appearance.accent is missing');
        });

        test('regression: may not leave out any other field, or add one', () => {
            assert.equal(findSettingsIssue(withoutField(['appearance', 'density']), older, added)?.message, 'settings.appearance.density is missing');
            assert.equal(findSettingsIssue(withoutField(['accounts', 0, 'name']), older, added)?.message, 'settings.accounts[0].name is missing');
            assert.equal(
                findSettingsIssue(withValue(baseline(), ['profile', 'apiKey'], 'secret'), older, added)?.message,
                'settings.profile has an unknown field "apiKey"',
            );
            assert.equal(findSettingsIssue({ apiKeys: { polygon: 'pk' } }, older, added)?.message, 'settings has an unknown field "apiKeys"');
        });

        test('must hold valid values, the added fields included', () => {
            assert.equal(findSettingsIssue(withValue(baseline(), ['appearance', 'accent'], 'red'), older, added)?.message, 'settings.appearance.accent must be a hex colour such as #17cf54');
            assert.equal(
                findSettingsIssue(withValue(baseline(), ['riskPolicy', 'employerStockPlan', 'nextActionDate'], {}), older, added)?.message,
                'settings.riskPolicy.employerStockPlan.nextActionDate must be a date (YYYY-MM-DD)',
            );
        });

        test('no field has been added since the first saved version', () => {
            assert.equal(findSettingsIssue(withoutField(['appearance', 'accent']), older)?.message, 'settings.appearance.accent is missing');
        });
    });

    describe('rules and boundaries, slice by slice', () => {
        test('profile: three text fields, any text', () => {
            accepts(['profile', 'fullName'], '', 'Grace Hopper');
            accepts(['profile', 'email'], '', 'grace@example.com');
            refuses(['profile', 'phone'], null, 5551234);
        });

        test('appearance: the theme and density options, and a hex accent', () => {
            accepts(['appearance', 'theme'], 'light', 'dim', 'dark', 'system');
            accepts(['appearance', 'density'], 'comfortable', 'compact');
            accepts(['appearance', 'accent'], '#fff', '#FFF', '#17cf54', ...ACCENT_PRESETS.map((preset) => preset.value));
            refuses(['appearance', 'accent'], '', '#17cf5', '#17cf544', 'red', 'url(https://example.com/x.png)', '#17cf54;color:red');
            refuses(['appearance', 'compactMode'], 'true', 1);
        });

        test('notifications: every switch is true or false', () => {
            accepts(['notifications', 'weeklySummary'], true, false);
            refuses(['notifications', 'priceAlerts'], 'on', null, MISSING);
        });

        test('alphaRadarDelivery: the four channels, a 0-100 score and text filters', () => {
            accepts(['alphaRadarDelivery', 'minMaterialityScore'], 0, 100, 72.5);
            refuses(['alphaRadarDelivery', 'minMaterialityScore'], -1, 101, '75');
            refuses(['alphaRadarDelivery', 'channels', 'fax'], true);
            refuses(['alphaRadarDelivery', 'channels', 'email'], 'yes');
            accepts(['alphaRadarDelivery', 'tickerFilters'], [], ['AAPL', 'MSFT']);
            refuses(['alphaRadarDelivery', 'tickerFilters'], ['AAPL', null], 'AAPL');
        });

        test("preferences: the Preferences form's rules", () => {
            accepts(['preferences', 'marketDataRefreshSeconds'], 15, 3600);
            refuses(['preferences', 'marketDataRefreshSeconds'], 14, 3601, 30.5);
            accepts(['preferences', 'defaultLandingPage'], ...LANDING_PAGES);
            // Retired in v15; the migration maps it.
            refuses(['preferences', 'defaultLandingPage'], '/analytics', 'https://example.com');
            refuses(['preferences', 'baseCurrency'], 'BTC');
            refuses(['preferences', 'dateFormat'], 'D/M/Y');
            refuses(['preferences', 'numberFormat'], 'en-IN');
        });

        test('accounts: an id and a name, counts, any balance and the Plaid fields', () => {
            accepts(['accounts', 0, 'accountValue'], 0, -1_250.5, 1e9);
            accepts(['accounts', 0, 'holdings'], 0, 12);
            refuses(['accounts', 0, 'holdings'], -1);
            refuses(['accounts', 0, 'id'], '', MISSING);
            refuses(['accounts', 0, 'status'], 'synced');
            accepts(['accounts', 0, 'provider'], 'manual', 'schwab', 'plaid', MISSING);
            refuses(['accounts', 0, 'provider'], 'fidelity');
            accepts(['accounts', 0, 'capabilities'], [], ['balances', 'holdings', 'transactions', 'investments']);
            refuses(['accounts', 0, 'capabilities'], ['trading']);
            accepts(['accounts', 0, 'tokenStorageMode'], 'memory', 'encrypted_file', 'postgres');
            refuses(['accounts', 0, 'tokenStorageMode'], 'disk');
            accepts(['accounts', 0, 'providerItemStatus'], 'active', 'missing-token', 'revoked', 'reconnected');
            refuses(['accounts', 0, 'accessToken'], 'access-sandbox-1');
            refuses(['accounts'], [null], ['x']);
        });

        test('tags: an id, a name and a hex colour', () => {
            accepts(['tags', 0], { id: 'x', name: 'Income', color: '#3b82f6' });
            refuses(['tags', 0, 'name'], '');
            refuses(['tags', 0, 'id'], '');
            refuses(['tags', 0, 'color'], 'blue', MISSING);
        });

        test('guardrails: whole numbers within what GuardrailsCard allows', () => {
            accepts(['guardrails', 'approvalThresholdUsd'], 500, 25_000, 10_000_000);
            refuses(['guardrails', 'approvalThresholdUsd'], 499, 10_000_001, 2_500.5);
            accepts(['guardrails', 'concentrationCapPct'], 5, 50);
            refuses(['guardrails', 'concentrationCapPct'], 4, 51);
        });

        test('execution: the four cooldown presets', () => {
            accepts(['execution', 'cooldownSeconds'], 0, 10, 30, 60);
            refuses(['execution', 'cooldownSeconds'], 5, '10', 120);
            refuses(['execution', 'rationaleRequired'], 'yes');
        });

        test('riskPolicy: bucket policies and theme caps are percentages', () => {
            accepts(['riskPolicy', 'bucketPolicies', 0, 'targetPct'], 0, 100, MISSING);
            refuses(['riskPolicy', 'bucketPolicies', 0, 'targetPct'], -1, 101);
            refuses(['riskPolicy', 'bucketPolicies', 0, 'bucket'], 'crypto', MISSING);
            accepts(['riskPolicy', 'themeCaps', 'consumer_tech'], 0, 100);
            refuses(['riskPolicy', 'themeCaps', 'semiconductors'], 101, 'high');
        });

        test('riskPolicy: cash jobs and the deployment rule', () => {
            accepts(['riskPolicy', 'cashJobs'], [{ id: 'cash-tax_reserve', type: 'tax_reserve', label: 'Tax reserve', amount: 0, reviewBy: '2027-04-15' }]);
            refuses(['riskPolicy', 'cashJobs', 0], { id: 'cash-x', type: 'rainy_day', label: 'x', amount: 1 });
            refuses(['riskPolicy', 'cashJobs', 0], { id: 'cash-x', type: 'settlement', label: 'x', amount: -1 });
            accepts(['riskPolicy', 'cashDeploymentRule', 'percentOfExcess'], 0, 100);
            refuses(['riskPolicy', 'cashDeploymentRule', 'percentOfExcess'], -1, 101);
            refuses(['riskPolicy', 'cashDeploymentRule', 'cadence'], 'weekly');
            accepts(['riskPolicy', 'cashDeploymentRule', 'lastAcknowledgedAt'], '2026-10-19T08:00:00.000Z', '2026-10-19T08:00:00+05:30');
            refuses(['riskPolicy', 'cashDeploymentRule', 'lastAcknowledgedAt'], '2026-10-19', 'yesterday');
            refuses(['riskPolicy', 'cashDeploymentRule', 'unassignedAcknowledgedUntil'], { until: 'later' });
        });

        test('riskPolicy: the employer-stock plan, within what its inputs clamp to', () => {
            accepts(['riskPolicy', 'employerStockPlan', 'trimAmountUsd'], 0, 10_000_000);
            refuses(['riskPolicy', 'employerStockPlan', 'trimAmountUsd'], -1, 10_000_001);
            accepts(['riskPolicy', 'employerStockPlan', 'targetAllocationPct'], 0, 100, 12.5);
            refuses(['riskPolicy', 'employerStockPlan', 'taxReservePct'], 101);
            accepts(['riskPolicy', 'employerStockPlan', 'destination'], 'core', 'cash_reserve', 'core_index', 'custom');
            refuses(['riskPolicy', 'employerStockPlan', 'destination'], 'savings');
            refuses(['riskPolicy', 'employerStockPlan', 'state'], 'archived');
            refuses(['riskPolicy', 'employerStockPlan', 'symbols'], 'GOOG', [null]);
            accepts(['riskPolicy', 'employerStockPlan', 'accountLocation'], 'taxable', 'retirement', 'mixed', 'unknown', MISSING);
            refuses(['riskPolicy', 'employerStockPlan', 'accountLocation'], 'offshore');
        });

        test('riskPolicy: options caps are percentages and whole days', () => {
            accepts(['riskPolicy', 'optionsRiskPolicy', 'expiryWarningDays'], 0, 365);
            refuses(['riskPolicy', 'optionsRiskPolicy', 'expiryWarningDays'], -1, 30.5);
            refuses(['riskPolicy', 'optionsRiskPolicy', 'maxLossBudgetPct'], 101);
        });

        test('riskPolicy: sell-discipline rules and their audit trail', () => {
            // A stale-thesis rule keeps days here.
            accepts(['riskPolicy', 'sellDisciplineRules', 1, 'thresholdPct'], 0, 180, 720);
            refuses(['riskPolicy', 'sellDisciplineRules', 1, 'thresholdPct'], -1);
            refuses(['riskPolicy', 'sellDisciplineRules', 0, 'type'], 'moon');
            refuses(['riskPolicy', 'sellDisciplineRules', 0, 'action'], 'buy');
            refuses(['riskPolicy', 'sellDisciplineRules', 0, 'state'], 'paused');
            accepts(['riskPolicy', 'sellDisciplineRules', 0, 'vestDate'], '2026-11-15');
            refuses(['riskPolicy', 'sellDisciplineRules', 0, 'vestDate'], '20255-11-15', 'Nov 15');
            const event = { id: 'e1', type: 'snoozed', reason: 'Waiting on the vest', createdAt: '2026-10-19T08:00:00.000Z' };
            accepts(['riskPolicy', 'sellDisciplineRules', 0, 'auditTrail'], [], [event]);
            refuses(['riskPolicy', 'sellDisciplineRules', 0, 'auditTrail'], [{ ...event, type: 'deleted' }], [{ ...event, createdAt: 'now' }], [{ ...event, id: '' }]);
        });

        test('riskPolicy: churn policy within what ChurnPolicyCard allows', () => {
            accepts(['riskPolicy', 'churnPolicy', 'windowDays'], 14, 365);
            refuses(['riskPolicy', 'churnPolicy', 'windowDays'], 13, 366, 30.5);
            accepts(['riskPolicy', 'churnPolicy', 'watchRepeatSymbols'], 1, 25);
            refuses(['riskPolicy', 'churnPolicy', 'breachRepeatSymbols'], 0, 26);
        });

        test('demo: one switch', () => {
            accepts(['demo', 'showSampleData'], true, false);
            refuses(['demo', 'showSampleData'], 'off');
        });
    });
});

describe('sanitizeSettings', () => {
    const sanitize = (settings: unknown) => sanitizeSettings(settings as Record<string, unknown>, defaultPersistedSettings());

    test('leaves valid settings as they are', () => {
        assert.deepStrictEqual(sanitize(baseline()), baseline());
        assert.deepStrictEqual(sanitize({ demo: { showSampleData: false } }), { demo: { showSampleData: false } });
    });

    test('regression: a mistyped optional field goes, so the Today page renders', () => {
        // The Codex finding on PR #143: normalizing kept `{}`, and the risk
        // policy code called `.slice()` on it.
        const stored = withValue(defaultPersistedSettings(), ['riskPolicy', 'employerStockPlan', 'nextActionDate'], {});
        const today = (riskPolicy: PersistedSettings['riskPolicy']) => computeRiskPolicyDashboard({
            holdings: [{ symbol: 'GOOG', marketValue: 600_000, quantity: 3_000, currentPrice: 200, isEmployerStock: true }],
            employerStockPlan: riskPolicy.employerStockPlan,
            asOf: new Date('2026-10-19T08:00:00.000Z'),
        });
        assert.throws(() => today(stored.riskPolicy), TypeError);

        const loaded = sanitize(stored);
        assert.ok(!('nextActionDate' in loaded.riskPolicy!.employerStockPlan));
        assert.doesNotThrow(() => today(loaded.riskPolicy!));
    });

    test('a required field that is invalid falls back to its default', () => {
        const loaded = sanitize(withValue(baseline(), ['guardrails', 'approvalThresholdUsd'], 400));
        assert.equal(loaded.guardrails?.approvalThresholdUsd, 25_000);
        assert.equal(sanitize({ appearance: { theme: 'neon', density: 'compact' } }).appearance?.theme, 'light');
    });

    test('an optional field the defaults have falls back to it; one they lack goes', () => {
        const plan = sanitize(withValue(baseline(), ['riskPolicy', 'employerStockPlan', 'accountLocation'], 'offshore')).riskPolicy?.employerStockPlan;
        assert.equal(plan?.accountLocation, 'unknown');
        const rule = sanitize(withValue(baseline(), ['riskPolicy', 'sellDisciplineRules', 0, 'snoozedUntil'], 'soon')).riskPolicy?.sellDisciplineRules[0];
        assert.ok(rule);
        assert.ok(!('snoozedUntil' in rule));
    });

    test('unknown fields go', () => {
        const loaded = sanitize({
            ...baseline(),
            profile: { ...baseline().profile, nickname: 'JS' },
            riskPolicy: { ...baseline().riskPolicy, themeCaps: { semiconductors: 25, everything: 10, nothing: undefined } },
        });
        assert.deepStrictEqual(loaded.profile, baseline().profile);
        assert.deepStrictEqual(loaded.riskPolicy?.themeCaps, { semiconductors: 25 });
    });

    test('list items of the wrong kind, or without what identifies them, go; other required fields fall back', () => {
        const loaded = sanitize({
            ...baseline(),
            accounts: [null, { name: 'No id' }, { id: 'a1', name: 'Brokerage', status: 'synced', holdings: -3 }, 'x'],
            tags: [{ id: 't1', name: 'Income', color: 'blue' }, { id: 't2', color: '#fff' }],
            riskPolicy: {
                ...baseline().riskPolicy,
                bucketPolicies: [{ bucket: 'core', targetPct: 150, maxPct: 90 }, { bucket: 'crypto', maxPct: 5 }, 42],
                cashJobs: [{ id: 'job-1', type: 'emergency_fund' }, { id: 'job-2', type: 'rainy_day', label: 'x', amount: 1 }],
                sellDisciplineRules: [{
                    ...baseline().riskPolicy.sellDisciplineRules[0],
                    auditTrail: [
                        { id: 'e1', type: 'snoozed', reason: 'Waiting', createdAt: '2026-10-19T08:00:00.000Z' },
                        { id: 'e2', type: 'snoozed', reason: 'Waiting' },
                    ],
                }, { id: 'r2', type: 'moon', label: 'x', action: 'trim', state: 'active' }],
            },
        });
        assert.deepStrictEqual(loaded.accounts, [{
            id: 'a1', name: 'Brokerage', status: 'needs-review', holdings: 0, type: '', accountMask: '', accountValue: 0, lastSynced: '',
        }]);
        assert.deepStrictEqual(loaded.tags, [{ id: 't1', name: 'Income', color: '#17cf54' }]);
        assert.deepStrictEqual(loaded.riskPolicy?.bucketPolicies, [{ bucket: 'core', maxPct: 90 }]);
        assert.deepStrictEqual(loaded.riskPolicy?.cashJobs, [{ id: 'job-1', type: 'emergency_fund', label: '', amount: 0 }]);
        const [rule, ...others] = loaded.riskPolicy?.sellDisciplineRules ?? [];
        assert.deepStrictEqual(rule.auditTrail?.map((event) => event.id), ['e1']);
        assert.deepStrictEqual(others, []);
    });

    test('a slice of the wrong kind falls back whole; absent slices stay out', () => {
        assert.deepStrictEqual(sanitize({ riskPolicy: 'strict', tags: {} }), {
            riskPolicy: defaultPersistedSettings().riskPolicy,
            tags: defaultPersistedSettings().tags,
        });
    });

    test('whatever a field holds, the result is a document the server accepts', () => {
        // Every field of the defaults (and of an account), plus the optional
        // fields they leave out, given every kind of wrong value.
        const settings = baseline();
        const paths: Path[] = [];
        const collect = (node: unknown, path: Path) => {
            if (path.length > 0) paths.push(path);
            if (node !== null && typeof node === 'object') {
                for (const [key, child] of Object.entries(node)) collect(child, [...path, Array.isArray(node) ? Number(key) : key]);
            }
        };
        collect(settings, []);
        paths.push(
            ['riskPolicy', 'employerStockPlan', 'nextActionDate'],
            ['riskPolicy', 'cashDeploymentRule', 'lastAcknowledgedAt'],
            ['riskPolicy', 'sellDisciplineRules', 0, 'auditTrail'],
            ['riskPolicy', 'themeCaps', 'consumer_tech'],
            ['accounts', 0, 'capabilities'],
        );
        const wrong = [MISSING, null, {}, [], [null], 'x', '', -1, 1e12, 0.5, true];
        for (const path of paths) {
            for (const value of wrong) {
                const loaded = sanitize(withValue(settings, path, value));
                const issue = findSettingsIssue(loaded, SETTINGS_VERSION);
                assert.equal(issue?.message ?? null, null, `${path.join('.')} = ${String(typeof value === 'symbol' ? 'missing' : JSON.stringify(value))}`);
                // And the fields nobody touched are kept.
                if (path.length > 1 && path[0] !== 'profile') assert.deepStrictEqual(loaded.profile, settings.profile);
            }
        }
    });

    test('a slice no fallback can repair stays out, so the store keeps its own', () => {
        const defaults = defaultPersistedSettings();
        // A default that is itself out of range can't repair anything.
        const broken = withValue(defaults, ['guardrails', 'concentrationCapPct'], 99);
        const loaded = sanitizeSettings({ guardrails: broken.guardrails, demo: { showSampleData: false } }, broken);
        assert.deepStrictEqual(loaded, { demo: { showSampleData: false } });
        assert.equal(valueAt(broken, ['guardrails', 'concentrationCapPct']), 99);
    });
});
