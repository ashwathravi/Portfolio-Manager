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
}

export interface AppearanceSettings {
    theme: 'light' | 'dark' | 'system';
    compactMode: boolean;
    animationsEnabled: boolean;
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
    tags: Tag[];
    accounts: ConnectedAccount[];

    // Actions - Profile
    updateProfile: (profile: Partial<ProfileSettings>) => void;

    // Actions - Notifications
    updateNotification: (key: keyof NotificationSettings, value: boolean) => void;

    // Actions - Security
    toggleTwoFactor: () => void;

    // Actions - Appearance
    setTheme: (theme: 'light' | 'dark' | 'system') => void;
    toggleCompactMode: () => void;
    toggleAnimations: () => void;

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
};

const defaultAppearance: AppearanceSettings = {
    theme: 'light',
    compactMode: false,
    animationsEnabled: true,
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

            // Appearance
            setTheme: (theme) =>
                set((state) => ({
                    appearance: { ...state.appearance, theme },
                })),

            toggleCompactMode: () =>
                set((state) => ({
                    appearance: { ...state.appearance, compactMode: !state.appearance.compactMode },
                })),

            toggleAnimations: () =>
                set((state) => ({
                    appearance: { ...state.appearance, animationsEnabled: !state.appearance.animationsEnabled },
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
                    tags: defaultTags,
                    accounts: defaultAccounts,
                }),
        }),
        {
            name: 'atlas-settings',
        }
    )
);
