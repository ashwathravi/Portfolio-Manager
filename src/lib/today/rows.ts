import type { ActivityRow as PortfolioActivityRow } from '@/lib/portfolio/activity';
import type { Thesis } from '@/lib/research/thesis';
import { formatShortDate } from '@/lib/format';

/** Row shapes consumed by the Today cards (kept structural to avoid importing UI). */
export interface TodayActivityRow {
    id: string;
    type: 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal';
    date: string;
    ticker?: string;
    quantity?: number;
    amount: number;
    notes?: string;
}

export interface TodayThesisRow {
    id: string;
    tag: string;
    name: string;
    state: string;
    conviction: 'High' | 'Med' | 'Low';
    href?: string;
}

const ACTIVITY_TYPES = new Set(['buy', 'sell', 'dividend', 'deposit', 'withdrawal']);

/**
 * Today › Recent activity from real transactions (newest first). Replaces
 * the mock transaction list the dashboard used to render.
 */
export function toTodayActivity(rows: readonly PortfolioActivityRow[], limit = 8): TodayActivityRow[] {
    return rows
        .filter((r) => ACTIVITY_TYPES.has(r.side.toLowerCase()))
        .slice(0, limit)
        .map((r) => ({
            id: r.id,
            type: r.side.toLowerCase() as TodayActivityRow['type'],
            date: formatShortDate(r.date).replace(/, \d{4}$/, ''),
            ticker: r.symbol ?? undefined,
            quantity: r.quantity ?? undefined,
            amount: r.value,
            notes: r.notes ?? undefined,
        }));
}

const CONVICTION: Record<Thesis['conviction'], TodayThesisRow['conviction']> = { HIGH: 'High', MEDIUM: 'Med', LOW: 'Low' };

/** Today › Active theses from the research store (same source as Research). */
export function toTodayTheses(theses: readonly Thesis[]): TodayThesisRow[] {
    return theses
        .filter((t) => t.status === 'active')
        .sort((a, b) => (a.dateUpdated < b.dateUpdated ? 1 : a.dateUpdated > b.dateUpdated ? -1 : 0))
        .map((t) => ({
            id: t.id,
            tag: t.ticker,
            name: t.title,
            state: `${t.type === 'bull' ? 'Bull' : 'Bear'} · target $${t.targetPrice.toLocaleString('en-US')}`,
            conviction: CONVICTION[t.conviction],
            href: `/research/thesis/${encodeURIComponent(t.ticker)}`,
        }));
}
