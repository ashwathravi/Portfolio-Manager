import type { RiskPolicyNextAction } from '@/lib/risk-policy';
import type { Thesis } from '@/lib/research/thesis';
import { checkThesis } from '@/lib/research/thesisCheck';

/**
 * "Needs you" — the Today screen's triage list. Research for the review
 * found the daily job is "does anything need me?" rather than analysis,
 * so Today leads with a short, ranked list of things to act on, each with
 * one link, instead of a wall of dashboards.
 */

export type TriageSeverity = 'breach' | 'warn' | 'info';

export interface TriageItem {
    id: string;
    severity: TriageSeverity;
    title: string;
    detail: string;
    href: string;
    source: 'policy' | 'thesis' | 'review';
    /** Derived from example data — rendered with a Sample tag. */
    sample: boolean;
}

export interface TriageInput {
    policyActions: readonly RiskPolicyNextAction[];
    /** Policy actions are computed from real holdings; flag when they are not. */
    policyIsSample?: boolean;
    theses: readonly Thesis[];
    isSampleThesis: (t: Pick<Thesis, 'id'>) => boolean;
    reviewDue: boolean;
    reviewIsSample?: boolean;
    now: number;
}

const RANK: Record<TriageSeverity, number> = { breach: 0, warn: 1, info: 2 };

export function buildTriage(input: TriageInput, limit = 6): TriageItem[] {
    const items: TriageItem[] = [];

    for (const action of input.policyActions) {
        if (action.status === 'inside') continue;
        items.push({
            id: `policy:${action.id}`,
            severity: action.status === 'breached' ? 'breach' : action.status === 'watch' ? 'warn' : 'info',
            title: action.label,
            detail: action.status === 'missing_data' ? `Missing data · ${action.detail}` : action.detail,
            href: action.href,
            source: 'policy',
            sample: Boolean(input.policyIsSample),
        });
    }

    for (const thesis of input.theses) {
        if (thesis.status !== 'active') continue;
        const fresh = checkThesis(thesis, input.now).items.find((i) => i.id === 'fresh');
        if (!fresh || fresh.ok) continue;
        items.push({
            id: `thesis:${thesis.id}`,
            severity: 'warn',
            title: `Re-underwrite the ${thesis.ticker} thesis`,
            detail: fresh.detail,
            href: `/research/thesis/${encodeURIComponent(thesis.ticker)}`,
            source: 'thesis',
            sample: input.isSampleThesis(thesis),
        });
    }

    if (input.reviewDue) {
        items.push({
            id: 'review:this-week',
            severity: 'info',
            title: "This week's review is ready",
            detail: 'Two minutes: what you traded, rule adherence, and one reflection.',
            href: '/#weekly-review',
            source: 'review',
            sample: Boolean(input.reviewIsSample),
        });
    }

    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => RANK[a.item.severity] - RANK[b.item.severity] || a.index - b.index)
        .slice(0, limit)
        .map(({ item }) => item);
}
