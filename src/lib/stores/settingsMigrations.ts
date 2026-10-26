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

/** v16: the employer stock every install was seeded with, and the trim band that watched it. */
export const SEEDED_EMPLOYER_SYMBOLS: readonly string[] = ['GOOG', 'GOOGL'];
const SEEDED_EMPLOYER_PLAN_LABEL = 'GOOG employer stock de-risking';
const SEEDED_TRIM_BAND = { id: 'sell-goog-employer-cap', symbol: 'GOOG', label: 'GOOG employer-stock trim band' };

interface EmployerPolicyLike {
    employerStockPlan?: { state?: string; symbols?: readonly string[]; label?: string };
    sellDisciplineRules?: ReadonlyArray<{ id: string; symbol?: string; label: string }>;
}

/**
 * v16: employer stock is the user's to name (launch item i52). Every install
 * was seeded with GOOG and GOOGL and a GOOG trim band, and Settings offered
 * no way to change the tickers, so they say nothing about the user's
 * employer. A plan the user never activated loses them, and the seeded trim
 * band watches whatever employer stock the user names instead of GOOG. A
 * plan the user activated was a choice about GOOG, so it and its band stay;
 * so does anything the user changed.
 */
export function unseedEmployerStock<T extends EmployerPolicyLike>(
    riskPolicy: T,
    { planLabel, trimBandLabel }: { planLabel: string; trimBandLabel: string },
): T {
    const plan = riskPolicy.employerStockPlan;
    const seededPlan = plan !== undefined && plan.state === 'draft' && sameTickers(plan.symbols ?? [], SEEDED_EMPLOYER_SYMBOLS);
    if (plan !== undefined && !seededPlan) return riskPolicy;
    return {
        ...riskPolicy,
        ...(plan && {
            employerStockPlan: {
                ...plan,
                symbols: [],
                label: plan.label === SEEDED_EMPLOYER_PLAN_LABEL ? planLabel : plan.label,
            },
        }),
        ...(riskPolicy.sellDisciplineRules && {
            sellDisciplineRules: riskPolicy.sellDisciplineRules.map((rule) => {
                if (rule.id !== SEEDED_TRIM_BAND.id || rule.symbol !== SEEDED_TRIM_BAND.symbol || rule.label !== SEEDED_TRIM_BAND.label) return rule;
                const band = { ...rule, label: trimBandLabel };
                delete band.symbol;
                return band;
            }),
        }),
    };
}

function sameTickers(a: readonly string[], b: readonly string[]): boolean {
    const normalize = (list: readonly string[]) => [...new Set(list.map((ticker) => ticker.trim().toUpperCase()))].sort().join(',');
    return normalize(a) === normalize(b);
}
