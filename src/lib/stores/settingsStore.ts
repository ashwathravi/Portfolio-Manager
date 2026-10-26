import { create } from 'zustand';
import { PERSISTED_SETTINGS_SLICES, SETTINGS_VERSION } from '@/lib/settings/document';
import { sanitizeSettings } from '@/lib/validators/settings-slices';
import { migrateLandingPage, stripSeededDemoAccounts, type LandingPage } from './settingsMigrations';
import {
    DEFAULT_BUCKET_POLICIES,
    DEFAULT_CASH_DEPLOYMENT_RULE,
    DEFAULT_CHURN_POLICY,
    DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
    DEFAULT_SELL_DISCIPLINE_RULES,
    DEFAULT_OPTIONS_RISK_POLICY,
    DEFAULT_THEME_CAPS,
    type ChurnPolicySettings,
    type RiskPolicySettings,
} from '@/lib/risk-policy';
import { connectedPlaidAccountsMatch } from '@/lib/plaid/link';
import type { PlaidCapability, PlaidConnectedAccountInput } from '@/lib/plaid/types';

// --- Type Definitions ---

export interface ProfileSettings {
    fullName: string;
    email: string;
    phone: string;
}

export interface NotificationSettings {
    portfolioUpdates: boolean;
    priceAlerts: boolean;
    alphaRadarSignals: boolean;
    strategySignals: boolean;
    accountSync: boolean;
    weeklySummary: boolean;
}

export type AlphaRadarDeliveryChannelPreference = 'inApp' | 'email' | 'slack' | 'telegram';

export interface AlphaRadarDeliverySettings {
    enabled: boolean;
    channels: Record<AlphaRadarDeliveryChannelPreference, boolean>;
    failureSummaries: boolean;
    overlapOnly: boolean;
    minMaterialityScore: number;
    tickerFilters: string[];
    fundStyleFilters: string[];
    trackedFilerIds: string[];
}

export interface SecuritySettings {
    twoFactorEnabled: boolean;
    apiKey?: string;
}

export type ThemeMode = 'light' | 'dim' | 'dark' | 'system';
export type DensityMode = 'comfortable' | 'compact';

/**
 * Five brand-sanctioned accents surfaced to users in Settings / Tweaks.
 * Consumers should treat `accent` as an opaque color string — it feeds
 * straight into `--pm-accent` via the ThemeProvider — but new presets should
 * be added to this constant so the UI can offer the full list.
 */
export const ACCENT_PRESETS = [
    { name: 'Forest', value: '#17cf54' },
    { name: 'Indigo', value: '#6366f1' },
    { name: 'Amber',  value: '#f59e0b' },
    { name: 'Slate',  value: '#334155' },
    { name: 'Teal',   value: '#0d9488' },
] as const;

export type AccentValue = (typeof ACCENT_PRESETS)[number]['value'];

export interface AppearanceSettings {
    theme: ThemeMode;
    /** Source of truth for density (AR-64). `compactMode` stays mirrored
     *  for back-compat with pre-Ledger callers. */
    density: DensityMode;
    /** @deprecated Prefer `density === 'compact'`. Kept in sync so existing
     *  Tailwind `data-compact="true"` selectors continue to work. */
    compactMode: boolean;
    animationsEnabled: boolean;
    /** Brand accent color, hex string. Drives `--pm-accent` at runtime. */
    accent: string;
}

export interface ApiKeysSettings {
    polygon: string;
    alphaVantage: string;
    schwab: string;
}

export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'JPY' | 'CHF' | 'INR';
export type DateFormat = 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
export type NumberFormat = 'en-US' | 'en-GB' | 'de-DE' | 'fr-FR';
export type DefaultLandingPage = LandingPage;

export interface PreferencesSettings {
    baseCurrency: CurrencyCode;
    dateFormat: DateFormat;
    numberFormat: NumberFormat;
    defaultLandingPage: DefaultLandingPage;
    marketDataRefreshSeconds: number;
}

export interface Tag {
    id: string;
    name: string;
    color: string;
}

export interface ConnectedAccount {
    id: string;
    provider?: 'manual' | 'schwab' | 'plaid';
    name: string;
    type: string;
    accountMask: string;
    holdings: number;
    accountValue: number;
    lastSynced: string;
    status: 'reconciled' | 'needs-review' | 'error';
    errorMessage?: string;
    institutionId?: string;
    institutionName?: string;
    plaidAccountId?: string;
    plaidItemId?: string;
    capabilities?: PlaidCapability[];
    syncReady?: boolean;
    tokenStorageMode?: 'memory' | 'encrypted_file' | 'postgres';
    tokenStorageDurable?: boolean;
    providerItemStatus?: 'active' | 'missing-token' | 'revoked' | 'reconnected';
}

/**
 * Execution guardrails (AR-89).
 *
 * These flags gate risky behavior in the Execution surface (AR-84).
 * Each toggle is independent — users can flip any combination on or
 * off. Numeric values travel alongside their toggle; the toggle
 * decides whether the value is enforced.
 *
 * Kept in the Settings store (not a separate execution store) because
 * they are user preferences that persist across sessions, same as
 * theme and density. The Execution surface reads them via selectors,
 * never the other way around.
 */
export interface GuardrailSettings {
    /** Require manual approval for orders whose notional exceeds the
     *  threshold. Floor/ceiling enforced in the UI at $500 / $10M. */
    approvalThresholdEnabled: boolean;
    approvalThresholdUsd: number;

    /** Block new orders that would push a single position over this
     *  percentage of the portfolio. Bounded 5–50 in the UI. */
    concentrationCapEnabled: boolean;
    concentrationCapPct: number;

    /** Every order must link to an active thesis. Violations surface
     *  as a guardrail-fail in the Focus variant preview. */
    thesisLinkageRequired: boolean;
}

/**
 * Execution workflow preferences (AR-109 / JournalPlus Integration).
 *
 * These flags shape the *shape* of the order submission flow rather
 * than the risk rails in `GuardrailSettings`. Separate slice because
 * they're about friction/journaling, not capital preservation — mixing
 * them into `guardrails` would conflate two concepts that belong on
 * different settings cards.
 */

/**
 * Valid cooldown seconds. Narrowed to a union of four presets rather
 * than left as `number` so the Settings picker can ship as a chip
 * row without validation and so the Tweaks export (AR-65-style)
 * stays well-typed. 0 disables the cooldown entirely.
 */
export type CooldownSeconds = 0 | 10 | 30 | 60;

export const COOLDOWN_OPTIONS: ReadonlyArray<{
    value: CooldownSeconds;
    label: string;
    desc: string;
}> = [
    { value: 0,  label: 'Off', desc: 'No cooldown; Submit fires immediately' },
    { value: 10, label: '10s', desc: 'Short pause — default nudge' },
    { value: 30, label: '30s', desc: 'Full-breath pause' },
    { value: 60, label: '60s', desc: 'One-minute lockout' },
];

export interface ExecutionSettings {
    /** Require a completed `<PreTradeRationale>` panel before Submit
     *  becomes enabled. Default ON — the whole point of the capture is
     *  the friction, but power users may disable it once behaviors are
     *  stable. See AR-109 acceptance criteria. */
    rationaleRequired: boolean;

    /** Seconds the Submit button stays locked when the trader picks a
     *  caution mood (`fomo` or `revenge`) on the rationale panel.
     *  Default 10 — enough to break an impulse without derailing the
     *  flow. Users can turn it off by setting to 0. See AR-110. */
    cooldownSeconds: CooldownSeconds;
}

export type { ChurnPolicySettings, RiskPolicySettings };

/**
 * Example-data display. Sample-backed cards always carry a "Sample" tag;
 * turning this off hides them so only the user's own data remains.
 */
export interface DemoSettings {
    showSampleData: boolean;
}

/**
 * Example data without stored settings: shown. A first sign-in stores a
 * new user's settings with it off (NEW_USER_SETTINGS in
 * src/lib/settings/server.ts), so this is for users from before that, and
 * for running without a database.
 */
export const DEFAULT_SHOW_SAMPLE_DATA = true;

export interface SettingsState {
    // State slices
    profile: ProfileSettings;
    notifications: NotificationSettings;
    alphaRadarDelivery: AlphaRadarDeliverySettings;
    security: SecuritySettings;
    appearance: AppearanceSettings;
    apiKeys: ApiKeysSettings;
    preferences: PreferencesSettings;
    tags: Tag[];
    accounts: ConnectedAccount[];
    guardrails: GuardrailSettings;
    execution: ExecutionSettings;
    riskPolicy: RiskPolicySettings;
    demo: DemoSettings;

    // Actions - Profile
    updateProfile: (profile: Partial<ProfileSettings>) => void;

    // Actions - Notifications
    updateNotification: (key: keyof NotificationSettings, value: boolean) => void;
    updateAlphaRadarDelivery: (updates: Partial<AlphaRadarDeliverySettings>) => void;
    updateAlphaRadarDeliveryChannel: (channel: AlphaRadarDeliveryChannelPreference, value: boolean) => void;

    // Actions - Security
    toggleTwoFactor: () => void;
    setApiKey: (key: string) => void;

    // Actions - Appearance
    setTheme: (theme: ThemeMode) => void;
    setDensity: (density: DensityMode) => void;
    toggleCompactMode: () => void;
    toggleAnimations: () => void;
    setAccent: (accent: string) => void;

    // Actions - API Keys
    setProviderKey: (provider: keyof ApiKeysSettings, value: string) => void;
    clearProviderKey: (provider: keyof ApiKeysSettings) => void;

    // Actions - Preferences
    updatePreferences: (updates: Partial<PreferencesSettings>) => void;

    // Actions - Tags (CRUD)
    addTag: (tag: Omit<Tag, 'id'>) => void;
    updateTag: (id: string, updates: Partial<Omit<Tag, 'id'>>) => void;
    deleteTag: (id: string) => void;

    // Actions - Accounts
    syncAccount: (id: string) => void;
    reconnectAccount: (id: string) => void;
    removeAccount: (id: string) => void;
    connectPlaidAccounts: (accounts: PlaidConnectedAccountInput[]) => void;

    // Actions - Guardrails
    updateGuardrails: (updates: Partial<GuardrailSettings>) => void;

    // Actions - Execution
    updateExecution: (updates: Partial<ExecutionSettings>) => void;

    // Actions - Risk policy
    updateRiskPolicy: (updates: Partial<RiskPolicySettings>) => void;

    // Actions - Example data
    setShowSampleData: (show: boolean) => void;

    // Reset
    resetSettings: () => void;
}

// --- Defaults ---

// Empty by default: the signed-in identity (Google) fills name and email.
// Earlier builds shipped a "John Doe" placeholder that showed up across the
// app as if it were the user.
const defaultProfile: ProfileSettings = {
    fullName: '',
    email: '',
    phone: '',
};

const defaultNotifications: NotificationSettings = {
    portfolioUpdates: true,
    priceAlerts: true,
    alphaRadarSignals: true,
    strategySignals: false,
    accountSync: true,
    weeklySummary: true,
};

const defaultAlphaRadarDelivery: AlphaRadarDeliverySettings = {
    enabled: true,
    channels: {
        inApp: true,
        email: false,
        slack: false,
        telegram: false,
    },
    failureSummaries: true,
    overlapOnly: false,
    minMaterialityScore: 75,
    tickerFilters: [],
    fundStyleFilters: [],
    trackedFilerIds: [],
};

const defaultSecurity: SecuritySettings = {
    twoFactorEnabled: false,
    apiKey: '',
};

const defaultAppearance: AppearanceSettings = {
    theme: 'light',
    density: 'comfortable',
    compactMode: false,
    animationsEnabled: true,
    accent: ACCENT_PRESETS[0].value, // Forest #17cf54
};

const defaultApiKeys: ApiKeysSettings = {
    polygon: '',
    alphaVantage: '',
    schwab: '',
};

const defaultPreferences: PreferencesSettings = {
    baseCurrency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    numberFormat: 'en-US',
    defaultLandingPage: '/',
    marketDataRefreshSeconds: 60,
};

const defaultTags: Tag[] = [
    { id: '1', name: 'Growth', color: '#17cf54' },
    { id: '2', name: 'Dividend', color: '#3b82f6' },
    { id: '3', name: 'Speculative', color: '#f59e0b' },
];

/**
 * Guardrails defaults (AR-89). The values match what AR-84's
 * execution fixtures hardcoded before this slice existed, so moving
 * to the store doesn't change behavior for existing users.
 */
const defaultGuardrails: GuardrailSettings = {
    approvalThresholdEnabled: true,
    approvalThresholdUsd: 25_000,
    concentrationCapEnabled: true,
    concentrationCapPct: 25,
    thesisLinkageRequired: false,
};

/**
 * Execution defaults (AR-109 + AR-110). `rationaleRequired` ships ON so
 * the JournalPlus capture happens out of the box — the whole JournalPlus
 * value prop rests on never shipping a trade without a "why".
 * `cooldownSeconds` defaults to 10 — a 10-second pause is enough to
 * break an impulse trade but short enough that the nudge doesn't feel
 * punitive during a normal session.
 */
const defaultExecution: ExecutionSettings = {
    rationaleRequired: true,
    cooldownSeconds: 10,
};

const defaultRiskPolicy: RiskPolicySettings = {
    bucketPolicies: [...DEFAULT_BUCKET_POLICIES],
    themeCaps: { ...DEFAULT_THEME_CAPS },
    cashJobs: [],
    cashDeploymentRule: { ...DEFAULT_CASH_DEPLOYMENT_RULE },
    employerStockPlan: {
        ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
        symbols: [...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN.symbols],
    },
    optionsRiskPolicy: { ...DEFAULT_OPTIONS_RISK_POLICY },
    sellDisciplineRules: DEFAULT_SELL_DISCIPLINE_RULES.map((rule) => ({ ...rule })),
    churnPolicy: { ...DEFAULT_CHURN_POLICY },
    bucketAssignments: {},
};

const defaultDemo: DemoSettings = { showSampleData: DEFAULT_SHOW_SAMPLE_DATA };

// No example accounts: connected accounts only ever come from the user
// (Plaid Link or manual entry). v15 strips the three demo rows older
// builds seeded into every install.
const defaultAccounts: ConnectedAccount[] = [];

function mergePlaidAccounts(
    existingAccounts: readonly ConnectedAccount[],
    incomingAccounts: readonly PlaidConnectedAccountInput[],
): ConnectedAccount[] {
    const merged: ConnectedAccount[] = existingAccounts.map((account) => ({
        ...account,
        capabilities: account.capabilities ? [...account.capabilities] : undefined,
    }));

    for (const incoming of incomingAccounts) {
        const existingIndex = merged.findIndex((account) =>
            connectedPlaidAccountsMatch(account, incoming) ||
            account.id === incoming.id
        );
        const next: ConnectedAccount = {
            ...incoming,
            capabilities: [...incoming.capabilities],
        };

        if (existingIndex >= 0) {
            merged[existingIndex] = {
                ...merged[existingIndex],
                ...next,
                errorMessage: undefined,
            };
        } else {
            merged.push(next);
        }
    }

    return merged;
}

function normalizeConnectedAccounts(accounts: ConnectedAccount[] | undefined): ConnectedAccount[] {
    const source = accounts ?? defaultAccounts;
    return source.map((account) => ({
        ...account,
        provider: account.provider ?? 'manual',
        capabilities: account.capabilities ? [...account.capabilities] : undefined,
        syncReady: account.provider === 'plaid'
            ? account.syncReady ?? account.status === 'reconciled'
            : account.syncReady,
        providerItemStatus: account.provider === 'plaid'
            ? account.providerItemStatus ?? 'active'
            : account.providerItemStatus,
    }));
}

// --- Store ---

export const useSettingsStore = create<SettingsState>()(
    (set) => ({
        // Initial state
        profile: defaultProfile,
        notifications: defaultNotifications,
        alphaRadarDelivery: defaultAlphaRadarDelivery,
        security: defaultSecurity,
        appearance: defaultAppearance,
        apiKeys: defaultApiKeys,
        preferences: defaultPreferences,
        tags: defaultTags,
        accounts: defaultAccounts,
        guardrails: defaultGuardrails,
        execution: defaultExecution,
        riskPolicy: defaultRiskPolicy,
        demo: defaultDemo,

        // Profile
        updateProfile: (updates) =>
            set((state) => ({
                profile: { ...state.profile, ...updates },
            })),

        // Notifications
        updateNotification: (key, value) =>
            set((state) => ({
                notifications: { ...state.notifications, [key]: value },
            })),

        updateAlphaRadarDelivery: (updates) =>
            set((state) => ({
                alphaRadarDelivery: { ...state.alphaRadarDelivery, ...updates },
            })),

        updateAlphaRadarDeliveryChannel: (channel, value) =>
            set((state) => ({
                alphaRadarDelivery: {
                    ...state.alphaRadarDelivery,
                    channels: {
                        ...state.alphaRadarDelivery.channels,
                        [channel]: value,
                    },
                },
            })),

        // Security
        toggleTwoFactor: () =>
            set((state) => ({
                security: { ...state.security, twoFactorEnabled: !state.security.twoFactorEnabled },
            })),

        setApiKey: (apiKey) =>
            set((state) => ({
                security: { ...state.security, apiKey },
            })),

        // Appearance
        setTheme: (theme) =>
            set((state) => ({
                appearance: { ...state.appearance, theme },
            })),

        setDensity: (density) =>
            set((state) => ({
                appearance: {
                    ...state.appearance,
                    density,
                    // Keep the legacy boolean mirror in sync
                    compactMode: density === 'compact',
                },
            })),

        toggleCompactMode: () =>
            set((state) => {
                const nextCompact = !state.appearance.compactMode;
                return {
                    appearance: {
                        ...state.appearance,
                        compactMode: nextCompact,
                        density: nextCompact ? 'compact' : 'comfortable',
                    },
                };
            }),

        toggleAnimations: () =>
            set((state) => ({
                appearance: { ...state.appearance, animationsEnabled: !state.appearance.animationsEnabled },
            })),

        setAccent: (accent) =>
            set((state) => ({
                appearance: { ...state.appearance, accent },
            })),

        // API Keys
        setProviderKey: (provider, value) =>
            set((state) => ({
                apiKeys: { ...state.apiKeys, [provider]: value },
            })),

        clearProviderKey: (provider) =>
            set((state) => ({
                apiKeys: { ...state.apiKeys, [provider]: '' },
            })),

        // Preferences
        updatePreferences: (updates) =>
            set((state) => ({
                preferences: { ...state.preferences, ...updates },
            })),

        // Tags
        addTag: (tag) =>
            set((state) => ({
                tags: [...state.tags, { ...tag, id: crypto.randomUUID() }],
            })),

        updateTag: (id, updates) =>
            set((state) => ({
                tags: state.tags.map((tag) =>
                    tag.id === id ? { ...tag, ...updates } : tag
                ),
            })),

        deleteTag: (id) =>
            set((state) => ({
                tags: state.tags.filter((tag) => tag.id !== id),
            })),

        // Accounts
        syncAccount: (id) =>
            set((state) => ({
                accounts: state.accounts.map((acc) =>
                    acc.id === id
                        ? {
                            ...acc,
                            lastSynced: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }),
                            syncReady: acc.syncReady,
                        }
                        : acc
                ),
            })),

        reconnectAccount: (id) =>
            set((state) => ({
                accounts: state.accounts.map((acc) =>
                    acc.id === id
                        ? acc.provider === 'plaid'
                            ? {
                                ...acc,
                                status: 'needs-review' as const,
                                errorMessage: 'Reconnect with Plaid Link before provider sync can resume.',
                                syncReady: false,
                                providerItemStatus: 'missing-token' as const,
                            }
                            : {
                                ...acc,
                                status: 'reconciled' as const,
                                errorMessage: undefined,
                                syncReady: acc.syncReady,
                                providerItemStatus: acc.providerItemStatus,
                            }
                        : acc
                ),
            })),

        removeAccount: (id) =>
            set((state) => ({
                accounts: state.accounts.filter((acc) => acc.id !== id),
            })),

        connectPlaidAccounts: (incomingAccounts) =>
            set((state) => ({
                accounts: mergePlaidAccounts(state.accounts, incomingAccounts),
            })),

        // Guardrails
        updateGuardrails: (updates) =>
            set((state) => ({
                guardrails: { ...state.guardrails, ...updates },
            })),

        // Execution
        updateExecution: (updates) =>
            set((state) => ({
                execution: { ...state.execution, ...updates },
            })),

        // Risk policy
        setShowSampleData: (show) =>
            set((state) => ({ demo: { ...state.demo, showSampleData: show } })),

        updateRiskPolicy: (updates) =>
            set((state) => ({
                riskPolicy: {
                    ...state.riskPolicy,
                    ...updates,
                    bucketPolicies: updates.bucketPolicies
                        ? [...updates.bucketPolicies]
                        : state.riskPolicy.bucketPolicies,
                    themeCaps: updates.themeCaps
                        ? { ...state.riskPolicy.themeCaps, ...updates.themeCaps }
                        : state.riskPolicy.themeCaps,
                    cashJobs: updates.cashJobs
                        ? updates.cashJobs.map((job) => ({ ...job }))
                        : state.riskPolicy.cashJobs,
                    cashDeploymentRule: updates.cashDeploymentRule
                        ? {
                            ...DEFAULT_CASH_DEPLOYMENT_RULE,
                            ...state.riskPolicy.cashDeploymentRule,
                            ...updates.cashDeploymentRule,
                        }
                        : state.riskPolicy.cashDeploymentRule,
                    employerStockPlan: updates.employerStockPlan
                        ? {
                            ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
                            ...state.riskPolicy.employerStockPlan,
                            ...updates.employerStockPlan,
                            symbols: updates.employerStockPlan.symbols
                                ? [...updates.employerStockPlan.symbols]
                                : [
                                    ...(state.riskPolicy.employerStockPlan?.symbols
                                        ?? DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN.symbols),
                                ],
                        }
                        : state.riskPolicy.employerStockPlan ?? {
                            ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
                            symbols: [...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN.symbols],
                        },
                    optionsRiskPolicy: updates.optionsRiskPolicy
                        ? {
                            ...DEFAULT_OPTIONS_RISK_POLICY,
                            ...state.riskPolicy.optionsRiskPolicy,
                            ...updates.optionsRiskPolicy,
                        }
                        : state.riskPolicy.optionsRiskPolicy,
                    sellDisciplineRules: updates.sellDisciplineRules
                        ? updates.sellDisciplineRules.map((rule) => ({
                            ...rule,
                            auditTrail: rule.auditTrail?.map((event) => ({ ...event })),
                        }))
                        : state.riskPolicy.sellDisciplineRules,
                    churnPolicy: updates.churnPolicy
                        ? {
                            ...defaultRiskPolicy.churnPolicy,
                            ...(state.riskPolicy.churnPolicy ?? {}),
                            ...updates.churnPolicy,
                        }
                        : state.riskPolicy.churnPolicy ?? defaultRiskPolicy.churnPolicy,
                    // Replaced whole: removing a choice leaves the ticker out.
                    bucketAssignments: updates.bucketAssignments
                        ? { ...updates.bucketAssignments }
                        : state.riskPolicy.bucketAssignments ?? {},
                },
            })),

        // Reset
        resetSettings: () =>
            set({
                profile: defaultProfile,
                notifications: defaultNotifications,
                alphaRadarDelivery: defaultAlphaRadarDelivery,
                security: defaultSecurity,
                appearance: defaultAppearance,
                apiKeys: defaultApiKeys,
                preferences: defaultPreferences,
                tags: defaultTags,
                accounts: defaultAccounts,
                guardrails: defaultGuardrails,
                execution: defaultExecution,
                riskPolicy: defaultRiskPolicy,
                demo: defaultDemo,
            }),
    }),
);

// ---------------------------------------------------------------------------
// Persistence (launch item i37)
// ---------------------------------------------------------------------------

/**
 * The slices that persist, in the signed-in user's user_settings row and in
 * this browser's copy (src/lib/settings/sync.ts). The list and the version
 * live in src/lib/settings/document.ts so the server can use them too.
 */
export { PERSISTED_SETTINGS_SLICES, SETTINGS_VERSION };

export type PersistedSettings = Pick<SettingsState, (typeof PERSISTED_SETTINGS_SLICES)[number]>;

export function persistedSettings(state: SettingsState): PersistedSettings {
    return {
        profile: state.profile,
        appearance: state.appearance,
        notifications: state.notifications,
        alphaRadarDelivery: state.alphaRadarDelivery,
        preferences: state.preferences,
        accounts: state.accounts,
        tags: state.tags,
        guardrails: state.guardrails,
        execution: state.execution,
        riskPolicy: state.riskPolicy,
        demo: state.demo,
    };
}

/** The persisted slices as a fresh install has them. */
export function defaultPersistedSettings(): PersistedSettings {
    return structuredClone(persistedSettings(useSettingsStore.getInitialState()));
}

/**
 * Makes stored settings safe to load, whatever they hold, by the slices'
 * schemas (src/lib/validators/settings-slices.ts sanitizeSettings): a field
 * that is missing, of the wrong kind or out of range falls back to the
 * default; an optional field without a default goes, as do unknown fields; a
 * list item goes when it is the wrong kind or lacks what identifies it.
 */
export function normalizeSettings(settings: Partial<PersistedSettings>): Partial<PersistedSettings> {
    const present = Object.fromEntries(
        PERSISTED_SETTINGS_SLICES.filter((slice) => slice in settings).map((slice) => [slice, settings[slice]]),
    );
    return sanitizeSettings(present, defaultPersistedSettings());
}

/** Brings a stored document written at `version` up to {@link SETTINGS_VERSION}. */
export function migrateSettings(persistedState: unknown, version: number): Partial<PersistedSettings> {
    const s = (persistedState ?? {}) as Partial<SettingsState>;
    if (version < 2) {
        const existing = (s.appearance ?? {}) as Partial<AppearanceSettings>;
        s.appearance = {
            ...defaultAppearance,
            ...existing,
            // v1 had `compactMode` but no `density` — derive.
            density:
                existing.density ??
                (existing.compactMode ? 'compact' : 'comfortable'),
            accent: existing.accent ?? defaultAppearance.accent,
        };
    }
    if (version < 3) {
        const existing = (s.guardrails ?? {}) as Partial<GuardrailSettings>;
        s.guardrails = { ...defaultGuardrails, ...existing };
    }
    if (version < 4) {
        const existing = (s.execution ?? {}) as Partial<ExecutionSettings>;
        s.execution = { ...defaultExecution, ...existing };
    }
    if (version < 5) {
        // v4 execution slice didn't carry `cooldownSeconds`; fill
        // it in without clobbering the user's rationaleRequired.
        const existing = (s.execution ?? {}) as Partial<ExecutionSettings>;
        s.execution = {
            rationaleRequired:
                existing.rationaleRequired ?? defaultExecution.rationaleRequired,
            cooldownSeconds:
                existing.cooldownSeconds ?? defaultExecution.cooldownSeconds,
        };
    }
    if (version < 6) {
        const existing = (s.notifications ?? {}) as Partial<NotificationSettings>;
        s.notifications = { ...defaultNotifications, ...existing };
    }
    if (version < 7) {
        const existing = (s.alphaRadarDelivery ?? {}) as Partial<AlphaRadarDeliverySettings>;
        s.alphaRadarDelivery = {
            ...defaultAlphaRadarDelivery,
            ...existing,
            channels: {
                ...defaultAlphaRadarDelivery.channels,
                ...(existing.channels ?? {}),
            },
        };
    }
    if (version < 8) {
        const existing = (s.riskPolicy ?? {}) as Partial<RiskPolicySettings>;
        s.riskPolicy = {
            ...defaultRiskPolicy,
            ...existing,
            bucketPolicies: existing.bucketPolicies
                ? [...existing.bucketPolicies]
                : [...defaultRiskPolicy.bucketPolicies],
            themeCaps: {
                ...defaultRiskPolicy.themeCaps,
                ...(existing.themeCaps ?? {}),
            },
        };
    }
    if (version < 9) {
        const existing = (s.riskPolicy ?? {}) as Partial<RiskPolicySettings>;
        s.riskPolicy = {
            ...defaultRiskPolicy,
            ...existing,
            bucketPolicies: existing.bucketPolicies
                ? [...existing.bucketPolicies]
                : [...defaultRiskPolicy.bucketPolicies],
            themeCaps: {
                ...defaultRiskPolicy.themeCaps,
                ...(existing.themeCaps ?? {}),
            },
            cashJobs: existing.cashJobs
                ? existing.cashJobs.map((job) => ({ ...job }))
                : [],
            cashDeploymentRule: {
                ...DEFAULT_CASH_DEPLOYMENT_RULE,
                ...(existing.cashDeploymentRule ?? {}),
            },
            employerStockPlan: {
                ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
                ...(existing.employerStockPlan ?? {}),
                symbols: [
                    ...((existing.employerStockPlan?.symbols?.length
                        ? existing.employerStockPlan.symbols
                        : DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN.symbols)),
                ],
            },
        };
    }
    if (version < 10) {
        const existing = (s.riskPolicy ?? {}) as Partial<RiskPolicySettings>;
        s.riskPolicy = {
            ...defaultRiskPolicy,
            ...existing,
            bucketPolicies: existing.bucketPolicies
                ? [...existing.bucketPolicies]
                : [...defaultRiskPolicy.bucketPolicies],
            themeCaps: {
                ...defaultRiskPolicy.themeCaps,
                ...(existing.themeCaps ?? {}),
            },
            cashJobs: existing.cashJobs
                ? existing.cashJobs.map((job) => ({ ...job }))
                : [],
            cashDeploymentRule: {
                ...DEFAULT_CASH_DEPLOYMENT_RULE,
                ...(existing.cashDeploymentRule ?? {}),
            },
            employerStockPlan: {
                ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
                ...(existing.employerStockPlan ?? {}),
                symbols: [
                    ...((existing.employerStockPlan?.symbols?.length
                        ? existing.employerStockPlan.symbols
                        : DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN.symbols)),
                ],
            },
            optionsRiskPolicy: {
                ...DEFAULT_OPTIONS_RISK_POLICY,
                ...(existing.optionsRiskPolicy ?? {}),
            },
        };
    }
    if (version < 11) {
        const existing = (s.riskPolicy ?? {}) as Partial<RiskPolicySettings>;
        s.riskPolicy = {
            ...defaultRiskPolicy,
            ...existing,
            bucketPolicies: existing.bucketPolicies
                ? [...existing.bucketPolicies]
                : [...defaultRiskPolicy.bucketPolicies],
            themeCaps: {
                ...defaultRiskPolicy.themeCaps,
                ...(existing.themeCaps ?? {}),
            },
            cashJobs: existing.cashJobs
                ? existing.cashJobs.map((job) => ({ ...job }))
                : [],
            cashDeploymentRule: {
                ...DEFAULT_CASH_DEPLOYMENT_RULE,
                ...(existing.cashDeploymentRule ?? {}),
            },
            employerStockPlan: {
                ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
                ...(existing.employerStockPlan ?? {}),
                symbols: [
                    ...((existing.employerStockPlan?.symbols?.length
                        ? existing.employerStockPlan.symbols
                        : DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN.symbols)),
                ],
            },
            optionsRiskPolicy: {
                ...DEFAULT_OPTIONS_RISK_POLICY,
                ...(existing.optionsRiskPolicy ?? {}),
            },
            sellDisciplineRules: existing.sellDisciplineRules
                ? existing.sellDisciplineRules.map((rule) => ({
                    ...rule,
                    auditTrail: rule.auditTrail?.map((event) => ({ ...event })),
                }))
                : defaultRiskPolicy.sellDisciplineRules.map((rule) => ({ ...rule })),
        };
    }
    if (version < 12) {
        const existing = (s.riskPolicy ?? {}) as Partial<RiskPolicySettings>;
        s.riskPolicy = {
            ...defaultRiskPolicy,
            ...existing,
            bucketPolicies: existing.bucketPolicies
                ? [...existing.bucketPolicies]
                : [...defaultRiskPolicy.bucketPolicies],
            themeCaps: {
                ...defaultRiskPolicy.themeCaps,
                ...(existing.themeCaps ?? {}),
            },
            cashJobs: existing.cashJobs
                ? existing.cashJobs.map((job) => ({ ...job }))
                : [],
            cashDeploymentRule: {
                ...DEFAULT_CASH_DEPLOYMENT_RULE,
                ...(existing.cashDeploymentRule ?? {}),
            },
            employerStockPlan: {
                ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
                ...(existing.employerStockPlan ?? {}),
                symbols: [
                    ...((existing.employerStockPlan?.symbols?.length
                        ? existing.employerStockPlan.symbols
                        : DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN.symbols)),
                ],
            },
            optionsRiskPolicy: {
                ...DEFAULT_OPTIONS_RISK_POLICY,
                ...(existing.optionsRiskPolicy ?? {}),
            },
            sellDisciplineRules: existing.sellDisciplineRules
                ? existing.sellDisciplineRules.map((rule) => ({
                    ...rule,
                    auditTrail: rule.auditTrail?.map((event) => ({ ...event })),
                }))
                : defaultRiskPolicy.sellDisciplineRules.map((rule) => ({ ...rule })),
            churnPolicy: {
                ...defaultRiskPolicy.churnPolicy,
                ...(existing.churnPolicy ?? {}),
            },
        };
    }
    if (version < 13) {
        const existing = (s.riskPolicy ?? {}) as Partial<RiskPolicySettings>;
        s.riskPolicy = {
            ...defaultRiskPolicy,
            ...existing,
            bucketPolicies: existing.bucketPolicies
                ? [...existing.bucketPolicies]
                : [...defaultRiskPolicy.bucketPolicies],
            themeCaps: {
                ...defaultRiskPolicy.themeCaps,
                ...(existing.themeCaps ?? {}),
            },
            cashJobs: existing.cashJobs
                ? existing.cashJobs.map((job) => ({ ...job }))
                : [],
            cashDeploymentRule: {
                ...DEFAULT_CASH_DEPLOYMENT_RULE,
                ...(existing.cashDeploymentRule ?? {}),
            },
            employerStockPlan: {
                ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
                ...(existing.employerStockPlan ?? {}),
                symbols: [
                    ...((existing.employerStockPlan?.symbols?.length
                        ? existing.employerStockPlan.symbols
                        : DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN.symbols)),
                ],
            },
            optionsRiskPolicy: {
                ...DEFAULT_OPTIONS_RISK_POLICY,
                ...(existing.optionsRiskPolicy ?? {}),
            },
            sellDisciplineRules: existing.sellDisciplineRules
                ? existing.sellDisciplineRules.map((rule) => ({
                    ...rule,
                    auditTrail: rule.auditTrail?.map((event) => ({ ...event })),
                }))
                : defaultRiskPolicy.sellDisciplineRules.map((rule) => ({ ...rule })),
            churnPolicy: {
                ...defaultRiskPolicy.churnPolicy,
                ...(existing.churnPolicy ?? {}),
            },
        };
    }
    if (version < 14) {
        s.accounts = normalizeConnectedAccounts(s.accounts);
    }
    if (version < 15) {
        s.demo = { ...defaultDemo, ...(s.demo ?? {}) };
        s.accounts = stripSeededDemoAccounts(s.accounts);
        if (s.preferences) {
            s.preferences = {
                ...s.preferences,
                defaultLandingPage: migrateLandingPage(s.preferences.defaultLandingPage),
            };
        }
    }
    if (version < 16 && s.riskPolicy) {
        s.riskPolicy = { ...s.riskPolicy, bucketAssignments: {} };
    }
    return s as Partial<PersistedSettings>;
}
