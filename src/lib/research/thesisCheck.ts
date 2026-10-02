import type { Thesis } from './thesis';

/**
 * A transparent replacement for the old opaque "health score": four plain
 * checks a reviewer would make before trusting a thesis, each with the
 * reason it passed or failed. The score is simply the share of checks
 * that pass, so it can never disagree with the reasons shown beside it.
 */

export type ThesisCheckId = 'fresh' | 'falsifiable' | 'evidence' | 'catalyst';

export interface ThesisCheckItem {
    id: ThesisCheckId;
    label: string;
    ok: boolean;
    detail: string;
}

export interface ThesisCheck {
    /** 0–100: share of checks passing. */
    score: number;
    items: ThesisCheckItem[];
}

const DAY_MS = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}/;

function daysBetween(fromIso: string, now: number): number | null {
    if (!ISO.test(fromIso)) return null;
    const t = Date.parse(fromIso.length === 10 ? `${fromIso}T00:00:00Z` : fromIso);
    return Number.isFinite(t) ? Math.floor((now - t) / DAY_MS) : null;
}

export function checkThesis(thesis: Thesis, now: number, opts: { staleAfterDays?: number } = {}): ThesisCheck {
    const staleAfter = opts.staleAfterDays ?? 90;

    const age = daysBetween(thesis.dateUpdated, now);
    const fresh: ThesisCheckItem = {
        id: 'fresh',
        label: 'Reviewed recently',
        ok: age !== null && age <= staleAfter,
        detail: age === null ? 'No review date recorded.' : age === 0 ? 'Updated today.' : `Updated ${age} day${age === 1 ? '' : 's'} ago (review every ${staleAfter}).`,
    };

    const against = thesis.type === 'bull' ? thesis.bearCase.length : thesis.bullCase.length;
    const falsifiable: ThesisCheckItem = {
        id: 'falsifiable',
        label: 'Says what would prove it wrong',
        ok: against > 0,
        detail: against > 0 ? `${against} point${against === 1 ? '' : 's'} against the thesis.` : 'No counter-arguments written.',
    };

    const evidenceAges = thesis.linkedEvidence
        .map((e) => daysBetween(e.date, now))
        .filter((d): d is number => d !== null);
    const newestEvidence = evidenceAges.length ? Math.min(...evidenceAges) : null;
    const evidence: ThesisCheckItem = {
        id: 'evidence',
        label: 'Backed by recent evidence',
        ok: newestEvidence !== null && newestEvidence <= staleAfter,
        detail: newestEvidence === null
            ? 'No dated evidence linked.'
            : `Newest evidence is ${newestEvidence} day${newestEvidence === 1 ? '' : 's'} old.`,
    };

    const upcoming = thesis.catalysts.filter((c) => {
        const d = daysBetween(c.date, now);
        return d === null ? c.date.trim().length > 0 : d <= 0;
    });
    const catalyst: ThesisCheckItem = {
        id: 'catalyst',
        label: 'Has an upcoming catalyst',
        ok: upcoming.length > 0,
        detail: upcoming.length > 0 ? `${upcoming.length} upcoming or recurring.` : 'Every tracked catalyst has passed.',
    };

    const items = [fresh, falsifiable, evidence, catalyst];
    return { score: Math.round((items.filter((i) => i.ok).length / items.length) * 100), items };
}
