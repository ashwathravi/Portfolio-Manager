/** Sections of the single-column Settings page, in rail order. */
export const SETTINGS_SECTIONS = [
    { id: 'account', label: 'Account' },
    { id: 'accounts', label: 'Connected accounts' },
    { id: 'data', label: 'Data' },
    { id: 'trading', label: 'Trading rules' },
    { id: 'risk-policy', label: 'Risk policy' },
    { id: 'notifications', label: 'Notifications & alerts' },
    { id: 'preferences', label: 'Preferences' },
    { id: 'api-keys', label: 'Market data keys' },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

/** Legacy `/settings?tab=<slug>` deep links → section anchors. */
const LEGACY_TABS: Readonly<Record<string, SettingsSectionId>> = {
    profile: 'account',
    security: 'account',
    accounts: 'accounts',
    data: 'data',
    notifications: 'notifications',
    alerts: 'notifications',
    preferences: 'preferences',
    appearance: 'preferences',
    tags: 'preferences',
    'api-keys': 'api-keys',
};

export function sectionForTab(tab: string | null | undefined): SettingsSectionId | null {
    if (!tab) return null;
    return LEGACY_TABS[tab] ?? null;
}
