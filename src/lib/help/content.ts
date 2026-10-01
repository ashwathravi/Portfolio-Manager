/**
 * Help content: a five-step getting-started path and a glossary of the
 * policy and analytics terms the app uses. Kept as data so links can be
 * checked against the live navigation in tests.
 */

export interface GettingStartedStep {
    title: string;
    body: string;
    href: string;
    cta: string;
}

export const GETTING_STARTED: readonly GettingStartedStep[] = [
    {
        title: 'Connect an account',
        body: 'Link a brokerage so holdings, cash, and transactions come from your own data. Until then, example data is labelled “Sample”.',
        href: '/settings#accounts',
        cta: 'Connect an account',
    },
    {
        title: 'Start each day on Today',
        body: 'Net worth and today’s change come first, then “Needs your attention”: policy breaches, theses due for review, and the weekly review.',
        href: '/',
        cta: 'Open Today',
    },
    {
        title: 'Write a thesis before you trade',
        body: 'Record why you own a name, what would prove you wrong, and the catalysts to watch. The thesis check flags when one goes stale.',
        href: '/research?tab=theses',
        cta: 'Open Research',
    },
    {
        title: 'Set your rules',
        body: 'Guardrails (approval threshold, concentration cap) and risk policy (buckets, themes, sell discipline) are checked on every order you draft.',
        href: '/settings#trading',
        cta: 'Set guardrails',
    },
    {
        title: 'Draft orders, then review the week',
        body: 'Draft orders on Trade with a pre-trade rationale. Each week, the review summarises what you traded and how closely you followed your rules.',
        href: '/execution',
        cta: 'Open Trade',
    },
];

export interface GlossaryTerm {
    term: string;
    definition: string;
    href?: string;
}

export const GLOSSARY: readonly GlossaryTerm[] = [
    { term: 'Alpha', definition: 'Your return minus the benchmark’s over the same period, in percentage points.', href: '/performance' },
    { term: 'Bucket', definition: 'A policy group for holdings — core, active, or speculative — each with a target share and a cap.', href: '/settings#risk-policy' },
    { term: 'Churn', definition: 'Repeated buying and selling of the same names inside a window. High churn adds tax friction and is often a sign of reacting rather than following a plan.', href: '/portfolios/activity' },
    { term: 'Concentration', definition: 'The share of your portfolio in a single name or in your top three or five names.', href: '/portfolios/holdings' },
    { term: 'Conviction', definition: 'How strongly you hold a thesis: high, medium, or low. It sets how much evidence you need before acting.', href: '/research' },
    { term: 'Guardrail', definition: 'A rule checked before an order is drafted, such as an approval threshold or a concentration cap.', href: '/settings#trading' },
    { term: 'Missing data', definition: 'A policy check that can’t be evaluated yet because the holdings, trades, or classifications it needs aren’t connected.' },
    { term: 'Re-underwrite', definition: 'Re-read and update a thesis against current facts. Today asks for this when a thesis hasn’t been reviewed recently.', href: '/research' },
    { term: 'Sample', definition: 'Example data shown so you can explore before connecting accounts. It is always labelled and can be hidden in Settings › Data.', href: '/settings#data' },
    { term: 'Sell discipline', definition: 'Rules that trigger a trim, review, or no-add block when a position crosses a threshold you set.', href: '/settings#risk-policy' },
    { term: 'Theme', definition: 'A cross-cutting exposure such as AI infrastructure or semiconductors, with its own cap.', href: '/portfolios/holdings' },
    { term: 'TWR', definition: 'Time-weighted return: performance that removes the effect of deposits and withdrawals.', href: '/performance' },
    { term: '13F', definition: 'Quarterly holdings filing by large investment managers, used by Alpha Radar. Filings are delayed by up to 45 days.', href: '/research?tab=alpha-radar' },
];
