import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// --- Type Definitions ---

export interface ProfileSettings {
    fullName: string;
    email: string;
    phone: string;
}

export interface NotificationSettings {
    portfolioUpdates: boolean;
    priceAlerts: boolean;
    strategySignals: boolean;
    accountSync: boolean;
    weeklySummary: boolean;
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
export type DefaultLandingPage = '/' | '/performance' | '/analytics' | '/portfolios' | '/research' | '/strategies';

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
    name: string;
    type: string;
    accountMask: string;
    holdings: number;
    accountValue: number;
    lastSynced: string;
    status: 'reconciled' | 'needs-review' | 'error';
    errorMessage?: string;
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

export interface SettingsState {
    // State slices
    profile: ProfileSettings;
    notifications: NotificationSettings;
    security: SecuritySettings;
    appearance: AppearanceSettings;
    apiKeys: ApiKeysSettings;
    preferences: PreferencesSettings;
    tags: Tag[];
    accounts: ConnectedAccount[];
    guardrails: GuardrailSettings;
    execution: ExecutionSettings;

    // Actions - Profile
    updateProfile: (profile: Partial<ProfileSettings>) => void;

    // Actions - Notifications
    updateNotification: (key: keyof NotificationSettings, value: boolean) => void;

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

    // Actions - Guardrails
    updateGuardrails: (updates: Partial<GuardrailSettings>) => void;

    // Actions - Execution
    updateExecution: (updates: Partial<ExecutionSettings>) => void;

    // Reset
    resetSettings: () => void;
}

// --- Defaults ---

const defaultProfile: ProfileSettings = {
    fullName: 'John Doe',
    email: 'john@example.com',
    phone: '+1 (555) 123-4567',
};

const defaultNotifications: NotificationSettings = {
    portfolioUpdates: true,
    priceAlerts: true,
    strategySignals: false,
    accountSync: true,
    weeklySummary: true,
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

const defaultAccounts: ConnectedAccount[] = [
    {
        id: 'fidelity',
        name: 'Fidelity',
        type: 'Individual Brokerage',
        accountMask: '****1234',
        holdings: 12,
        accountValue: 324500.75,
        lastSynced: 'Feb 6, 10:30 AM',
        status: 'reconciled',
    },
    {
        id: 'vanguard',
        name: 'Vanguard',
        type: 'Roth IRA',
        accountMask: '****5678',
        holdings: 8,
        accountValue: 162749.57,
        lastSynced: 'Feb 6, 9:15 AM',
        status: 'reconciled',
    },
    {
        id: 'ibkr',
        name: 'Interactive Brokers',
        type: 'Trading Account',
        accountMask: '****9012',
        holdings: 0,
        accountValue: 0,
        lastSynced: 'Feb 5, 3:45 PM',
        status: 'needs-review',
        errorMessage: 'Connection error. Please re-authenticate this account.',
    },
];

// --- Store ---

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            // Initial state
            profile: defaultProfile,
            notifications: defaultNotifications,
            security: defaultSecurity,
            appearance: defaultAppearance,
            apiKeys: defaultApiKeys,
            preferences: defaultPreferences,
            tags: defaultTags,
            accounts: defaultAccounts,
            guardrails: defaultGuardrails,
            execution: defaultExecution,

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
                            ? { ...acc, lastSynced: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) }
                            : acc
                    ),
                })),

            reconnectAccount: (id) =>
                set((state) => ({
                    accounts: state.accounts.map((acc) =>
                        acc.id === id
                            ? { ...acc, status: 'reconciled' as const, errorMessage: undefined }
                            : acc
                    ),
                })),

            removeAccount: (id) =>
                set((state) => ({
                    accounts: state.accounts.filter((acc) => acc.id !== id),
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

            // Reset
            resetSettings: () =>
                set({
                    profile: defaultProfile,
                    notifications: defaultNotifications,
                    security: defaultSecurity,
                    appearance: defaultAppearance,
                    apiKeys: defaultApiKeys,
                    preferences: defaultPreferences,
                    tags: defaultTags,
                    accounts: defaultAccounts,
                    guardrails: defaultGuardrails,
                    execution: defaultExecution,
                }),
        }),
        {
            name: 'atlas-settings',
            /**
             * Bump when the shape of any persisted slice changes.
             *   v1 — pre-Ledger: `appearance = { theme, compactMode, animationsEnabled }`
             *   v2 — AR-64 + AR-65: adds `density` and `accent` as required fields.
             *   v3 — AR-89: adds the `guardrails` slice (approval threshold,
             *        concentration cap, thesis linkage). Existing users
             *        migrate to the defaults — the numbers match what the
             *        Execution surface hardcoded before the slice existed,
             *        so behavior is unchanged.
             *   v4 — AR-109: adds the `execution` slice (`rationaleRequired`).
             *        Existing users migrate to `{ rationaleRequired: true }`
             *        so pre-trade rationale capture turns on transparently
             *        — matches the out-of-the-box JournalPlus UX.
             *   v5 — AR-110: adds `execution.cooldownSeconds`. Existing v4
             *        users had `execution = { rationaleRequired }` only;
             *        the migration fills in `cooldownSeconds: 10` so the
             *        caution-mood nudge turns on without disrupting the
             *        rationale preference they already set.
             */
            version: 5,
            migrate: (persistedState, version) => {
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
                return s as SettingsState;
            },
            // Sentinel: Only persist non-sensitive preferences. API keys are
            // intentionally excluded so they don't end up in localStorage.
            partialize: (state) => ({
                appearance: state.appearance,
                notifications: state.notifications,
                preferences: state.preferences,
                tags: state.tags,
                guardrails: state.guardrails,
                execution: state.execution,
            }),
        }
    )
);
