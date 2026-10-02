/**
 * Information architecture — the single source of truth for where things
 * live in Atlas Wealth.
 *
 * The app collapses its former 21 routes into eight destinations. The
 * sidebar, the in-page section tabs, the ⌘K command palette, and the
 * legacy-route redirects in `next.config.ts` all read from this module, so
 * renaming or moving a page is a one-line change here.
 *
 * Keep this file free of React / icon imports: `next.config.ts` imports
 * `LEGACY_REDIRECTS` at build time.
 */

export type NavDestinationId =
    | 'today'
    | 'portfolio'
    | 'performance'
    | 'research'
    | 'strategies'
    | 'trade'
    | 'ask'
    | 'settings'
    | 'help';

export interface SectionTab {
    label: string;
    href: string;
    /** Extra path prefixes that select this tab (e.g. a detail view). */
    matchPrefixes?: readonly string[];
}

export interface NavDestination {
    id: NavDestinationId;
    title: string;
    href: string;
    /** One-line description used by the command palette. */
    description: string;
    /** Extra path prefixes that count as "inside" this destination. */
    matchPrefixes?: readonly string[];
    /** Section tabs rendered under the page title for multi-view destinations. */
    tabs?: readonly SectionTab[];
    /** Short tag rendered next to the title (e.g. "Beta"). */
    pill?: string;
}

export const PRIMARY_NAV: readonly NavDestination[] = [
    {
        id: 'today',
        title: 'Today',
        href: '/',
        description: 'Net worth, today’s change, and what needs your attention',
    },
    {
        id: 'portfolio',
        title: 'Portfolio',
        href: '/portfolios/holdings',
        description: 'Holdings, connected accounts, and transaction activity',
        matchPrefixes: ['/portfolios'],
        tabs: [
            { label: 'Holdings', href: '/portfolios/holdings', matchPrefixes: ['/portfolios/detail'] },
            { label: 'Accounts', href: '/portfolios/accounts' },
            { label: 'Activity', href: '/portfolios/activity' },
        ],
    },
    {
        id: 'performance',
        title: 'Performance',
        href: '/performance',
        description: 'Returns, attribution, and trading behaviour',
        tabs: [
            { label: 'Returns', href: '/performance' },
            { label: 'Behaviour', href: '/performance/behaviour' },
        ],
    },
    {
        id: 'research',
        title: 'Research',
        href: '/research',
        description: 'Theses, watchlist, Alpha Radar, and decision journal',
    },
    {
        id: 'strategies',
        title: 'Strategies',
        href: '/strategies',
        description: 'Rule builder, backtests, and adherence',
    },
    {
        id: 'trade',
        title: 'Trade',
        href: '/execution',
        description: 'Draft orders, policy checks, and the order blotter',
    },
    {
        id: 'ask',
        title: 'Ask',
        href: '/ask',
        description: 'Ask questions about your book, journal, and performance',
        pill: 'Beta',
    },
];

export const SYSTEM_NAV: readonly NavDestination[] = [
    {
        id: 'settings',
        title: 'Settings',
        href: '/settings',
        description: 'Profile, accounts, guardrails, and appearance',
    },
    {
        id: 'help',
        title: 'Help',
        href: '/help',
        description: 'Getting started, glossary, and what’s new',
    },
];

export const ALL_DESTINATIONS: readonly NavDestination[] = [...PRIMARY_NAV, ...SYSTEM_NAV];

/**
 * Routes retired by the IA consolidation. Each permanently redirects to the
 * view that replaced it so old bookmarks and links keep working.
 */
export const LEGACY_REDIRECTS: readonly { source: string; destination: string }[] = [
    { source: '/portfolios', destination: '/portfolios/holdings' },
    { source: '/portfolios/trade-log', destination: '/portfolios/activity' },
    { source: '/analytics', destination: '/performance/behaviour' },
    { source: '/research/journal', destination: '/research?tab=journal' },
    { source: '/strategies/builder', destination: '/strategies' },
    { source: '/strategies/deploy', destination: '/strategies' },
];

/** True when `href` should be highlighted for `pathname`. `/` only matches itself. */
export function isActiveHref(href: string, pathname: string): boolean {
    const path = href.split('?')[0];
    if (path === '/') return pathname === '/';
    return pathname === path || pathname.startsWith(`${path}/`);
}

/** The destination that owns `pathname`, or null (e.g. /login). */
export function activeDestination(pathname: string): NavDestination | null {
    for (const dest of ALL_DESTINATIONS) {
        if (isActiveHref(dest.href, pathname)) return dest;
        if (dest.matchPrefixes?.some((prefix) => isActiveHref(prefix, pathname))) return dest;
    }
    return null;
}

/** Section tabs for the destination owning `pathname`, or [] when it has none. */
export function sectionTabsFor(pathname: string): readonly SectionTab[] {
    return activeDestination(pathname)?.tabs ?? [];
}

/**
 * The active tab inside a section. Picks the longest matching href so
 * `/performance/behaviour` selects "Behaviour" rather than "Returns".
 */
export function activeSectionTab(pathname: string): SectionTab | null {
    const tabs = sectionTabsFor(pathname);
    let best: SectionTab | null = null;
    let bestLength = -1;
    for (const tab of tabs) {
        for (const candidate of [tab.href, ...(tab.matchPrefixes ?? [])]) {
            const matches = pathname === candidate || pathname.startsWith(`${candidate}/`);
            if (matches && candidate.length > bestLength) {
                best = tab;
                bestLength = candidate.length;
            }
        }
    }
    return best;
}
