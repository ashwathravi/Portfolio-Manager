/**
 * Pure helpers for the settings store's persisted-state migrations.
 * Kept separate from the store so they can be unit tested without
 * bootstrapping Zustand's persist middleware.
 */

export const LANDING_PAGES = [
    '/',
    '/portfolios/holdings',
    '/performance',
    '/performance/behaviour',
    '/research',
    '/strategies',
    '/execution',
] as const;

export type LandingPage = (typeof LANDING_PAGES)[number];

/** v15: routes retired by the IA consolidation map onto their replacements. */
const LEGACY_LANDING_PAGES: Readonly<Record<string, LandingPage>> = {
    '/analytics': '/performance/behaviour',
    '/portfolios': '/portfolios/holdings',
    '/portfolios/trade-log': '/portfolios/holdings',
};

export function migrateLandingPage(value: unknown): LandingPage {
    if (typeof value !== 'string') return '/';
    if ((LANDING_PAGES as readonly string[]).includes(value)) return value as LandingPage;
    return LEGACY_LANDING_PAGES[value] ?? '/';
}

/**
 * Example accounts that earlier versions seeded into every new install.
 * They were never the user's, so v15 removes them. Matched on id + mask +
 * manual provider so a real account that happens to reuse an id survives.
 */
export const SEEDED_DEMO_ACCOUNTS: ReadonlyArray<{ id: string; accountMask: string }> = [
    { id: 'fidelity', accountMask: '****1234' },
    { id: 'vanguard', accountMask: '****5678' },
    { id: 'ibkr', accountMask: '****9012' },
];

export function isSeededDemoAccount(account: { id: string; accountMask?: string; provider?: string }): boolean {
    if (account.provider && account.provider !== 'manual') return false;
    return SEEDED_DEMO_ACCOUNTS.some((seed) => seed.id === account.id && seed.accountMask === account.accountMask);
}

export function stripSeededDemoAccounts<T extends { id: string; accountMask?: string; provider?: string }>(
    accounts: readonly T[] | undefined,
): T[] {
    return (accounts ?? []).filter((a) => !isSeededDemoAccount(a));
}
