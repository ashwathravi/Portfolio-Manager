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
                }),
        }),
        {
            name: 'atlas-settings',
            // Sentinel: Only persist non-sensitive preferences. API keys are
            // intentionally excluded so they don't end up in localStorage.
            partialize: (state) => ({
                appearance: state.appearance,
                notifications: state.notifications,
                preferences: state.preferences,
                tags: state.tags,
            }),
        }
    )
);
