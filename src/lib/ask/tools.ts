/**
 * AR-115 — fixed tool catalogue for Ask Ledger.
 *
 * Deliberately narrow: the planner may only invoke one of these five
 * functions, and every return shape is `AskRow[]`. That shape shows up
 * in the rendered answer as a `kv` table without the renderer needing
 * tool-specific knowledge.
 *
 * All tools are pure: they read from the context (seed journal + mock
 * portfolios) and return deterministic numbers. When the real LLM lands
 * in v2 we swap the planner — the tools stay identical.
 */
import type { JournalEntry } from '@/types/trade';
import type { Holding, Portfolio } from '@/lib/mockData';
import { sectorFor } from '@/lib/holdings/sector';
import type {
    AskRow,
    AskToolName,
    AskToolRun,
} from './types';

export interface AskContext {
    portfolios: Portfolio[];
    holdings: Holding[];
    entries: JournalEntry[];
    /** Unix ms. Frozen per run so outputs are stable. */
    now: number;
}

// --------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------- //

function usd(n: number): string {
    if (!Number.isFinite(n)) return '$0';
    const sign = n < 0 ? '-' : '';
    const abs = Math.round(Math.abs(n)).toLocaleString('en-US');
    return `${sign}$${abs}`;
}

function usdSigned(n: number): string {
    if (n === 0) return '$0';
    const sign = n > 0 ? '+' : '-';
    const abs = Math.round(Math.abs(n)).toLocaleString('en-US');
    return `${sign}$${abs}`;
}

function pct(n: number): string {
    if (!Number.isFinite(n)) return '0%';
    return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function msBetween(a: string, b: number): number {
    return b - Date.parse(a);
}

function inRange(entry: JournalEntry, rangeDays: number, now: number): boolean {
    if (rangeDays <= 0) return true; // all time
    const ms = msBetween(entry.closedAt, now);
    return ms >= 0 && ms <= rangeDays * 86_400_000;
}

// --------------------------------------------------------------------- //
// 1. top_alpha_contributors
// --------------------------------------------------------------------- //

/**
 * Who moved the number most? Rank holdings by realized total return and
 * return the top N. Used by "what's helped / hurt alpha" questions.
 */
export function top_alpha_contributors(
    ctx: AskContext,
    args: { topN?: number; direction?: 'positive' | 'negative' | 'all' } = {},
): AskRow[] {
    const topN = args.topN ?? 5;
    const direction = args.direction ?? 'all';

    // Different directions want different sorts. For "negative" we want
    // the WORST performers first; when the book is all-green that means
    // the weakest winners ("relative drags"), not an empty reply.
    let pool = [...ctx.holdings];
    if (direction === 'positive') {
        pool = pool.filter((h) => h.totalReturn >= 0);
        pool.sort((a, b) => {
            const diff = b.totalReturn - a.totalReturn;
            return diff !== 0 ? diff : a.ticker.localeCompare(b.ticker);
        });
    } else if (direction === 'negative') {
        // Ascending by totalReturn: losses first, then weakest winners.
        pool.sort((a, b) => {
            const diff = a.totalReturn - b.totalReturn;
            return diff !== 0 ? diff : a.ticker.localeCompare(b.ticker);
        });
    } else {
        pool.sort((a, b) => {
            const diff = Math.abs(b.totalReturn) - Math.abs(a.totalReturn);
            return diff !== 0 ? diff : a.ticker.localeCompare(b.ticker);
        });
    }

    return pool.slice(0, topN).map((h) => ({
        label: h.ticker,
        value: usdSigned(h.totalReturn),
        sub: `${pct(h.totalReturnPercent)} · ${h.name}`,
        tone: h.totalReturn >= 0 ? 'pos' : 'neg',
        href: `/portfolios/holdings`,
    }));
}

// --------------------------------------------------------------------- //
// 2. pnl_attribution
// --------------------------------------------------------------------- //

/**
 * Where did P&L come from over the last `rangeDays`? Groups the journal's
 * round-trip entries by `sector | ticker | setup` and sums realized P&L.
 */
export function pnl_attribution(
    ctx: AskContext,
    args: { rangeDays?: number; groupBy?: 'sector' | 'ticker' | 'setup' } = {},
): AskRow[] {
    const rangeDays = args.rangeDays ?? 30;
    const groupBy = args.groupBy ?? 'sector';
    const windowed = ctx.entries.filter((e) => inRange(e, rangeDays, ctx.now));

    const bucket = new Map<string, number>();
    for (const e of windowed) {
        let key: string;
        switch (groupBy) {
            case 'ticker':
                key = e.ticker;
                break;
            case 'setup':
                key = e.rationale?.setupType ?? 'other';
                break;
            default:
                key = sectorFor(e.ticker);
        }
        bucket.set(key, (bucket.get(key) ?? 0) + (e.realizedPnlUsd || 0));
    }

    const rows = Array.from(bucket.entries())
        .map(([k, v]) => ({ k, v }))
        .sort((a, b) => b.v - a.v);

    return rows.map((r) => ({
        label: r.k,
        value: usdSigned(r.v),
        tone: r.v >= 0 ? 'pos' : 'neg',
        href:
            groupBy === 'sector'
                ? `/portfolios/holdings?sector=${encodeURIComponent(r.k)}`
                : `/trade-log`,
    }));
}

// --------------------------------------------------------------------- //
// 3. sector_exposure
// --------------------------------------------------------------------- //

/** Allocation % by sector, computed from current market values. */
export function sector_exposure(ctx: AskContext, _args: Record<string, unknown> = {}): AskRow[] {
    void _args;
    const bucket = new Map<string, number>();
    let total = 0;
    for (const h of ctx.holdings) {
        const s = sectorFor(h.ticker);
        bucket.set(s, (bucket.get(s) ?? 0) + h.marketValue);
        total += h.marketValue;
    }
    if (total === 0) return [];
    return Array.from(bucket.entries())
        .map(([s, v]) => ({ s, v, pct: (v / total) * 100 }))
        .sort((a, b) => b.v - a.v)
        .map((r) => ({
            label: r.s,
            value: `${r.pct.toFixed(1)}%`,
            sub: usd(r.v),
            // Tint red when any one sector exceeds 40% — a blunt
            // concentration warning. The adherence rules have their own
            // per-user threshold; this is just the conversational signal.
            tone: r.pct > 40 ? 'warn' : 'neutral',
            href: `/portfolios/holdings?sector=${encodeURIComponent(r.s)}`,
        }));
}

// --------------------------------------------------------------------- //
// 4. trades_matching
// --------------------------------------------------------------------- //

/**
 * Journal entries that match a filter. v1 supports:
 *   - `setup` (setupType name)
 *   - `ticker` (exact match, case-insensitive)
 *   - `rangeDays`
 *   - `outcome` ('win' | 'loss')
 */
export function trades_matching(
    ctx: AskContext,
    args: {
        setup?: string;
        ticker?: string;
        rangeDays?: number;
        outcome?: 'win' | 'loss';
    } = {},
): AskRow[] {
    const rangeDays = args.rangeDays ?? 0;
    const filtered = ctx.entries.filter((e) => {
        if (!inRange(e, rangeDays, ctx.now)) return false;
        if (args.setup && e.rationale?.setupType !== args.setup) return false;
        if (args.ticker && e.ticker.toUpperCase() !== args.ticker.toUpperCase()) return false;
        if (args.outcome === 'win' && e.realizedPnlUsd <= 0) return false;
        if (args.outcome === 'loss' && e.realizedPnlUsd >= 0) return false;
        return true;
    });
    return filtered
        .sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt))
        .slice(0, 10)
        .map((e) => ({
            label: `${e.side === 'buy' ? 'Bought' : 'Sold'} ${Math.abs(Math.round(e.quantity))} ${e.ticker}`,
            value: usdSigned(e.realizedPnlUsd),
            sub: new Date(e.closedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
            }),
            tone: e.realizedPnlUsd >= 0 ? 'pos' : 'neg',
            href: `/trade-log`,
        }));
}

// --------------------------------------------------------------------- //
// 5. correlation_with
// --------------------------------------------------------------------- //

/**
 * Heuristic "how close" the requested ticker's sector neighbors move —
 * the seed era has no price series, so we return the neighbors' allocation
 * share with a stub correlation coefficient derived from the shared
 * sector. This satisfies the UI contract and slots a real corr() call in
 * when the live price series lands.
 */
export function correlation_with(
    ctx: AskContext,
    args: { symbol?: string } = {},
): AskRow[] {
    const target = (args.symbol ?? '').toUpperCase();
    if (!target) return [];
    const targetSector = sectorFor(target);
    return ctx.holdings
        .filter((h) => h.ticker.toUpperCase() !== target)
        .map((h) => {
            const sameSector = sectorFor(h.ticker) === targetSector;
            // Deterministic stub: same-sector peers show higher correlation.
            const coef = sameSector ? 0.78 : 0.12;
            return {
                label: h.ticker,
                value: coef.toFixed(2),
                sub: `${sectorFor(h.ticker)} · ${pct(h.allocation)} of NAV`,
                tone: coef >= 0.6 ? 'warn' : 'neutral',
                href: `/portfolios/holdings`,
            } as AskRow;
        })
        .sort((a, b) => parseFloat(b.value) - parseFloat(a.value))
        .slice(0, 5);
}

// --------------------------------------------------------------------- //
// Dispatch table
// --------------------------------------------------------------------- //

export const TOOLS: Record<
    AskToolName,
    (ctx: AskContext, args: Record<string, unknown>) => AskRow[]
> = {
    top_alpha_contributors: (ctx, args) => top_alpha_contributors(ctx, args),
    pnl_attribution: (ctx, args) => pnl_attribution(ctx, args),
    sector_exposure: (ctx, args) => sector_exposure(ctx, args),
    trades_matching: (ctx, args) => trades_matching(ctx, args),
    correlation_with: (ctx, args) => correlation_with(ctx, args),
};

/** Runs a tool and wraps the return in a recorded `AskToolRun`. */
export function runTool(
    name: AskToolName,
    args: Record<string, unknown>,
    ctx: AskContext,
): AskToolRun {
    const fn = TOOLS[name];
    const rows = fn(ctx, args);
    // Compute a headline — first row's value, or a summed total when
    // that makes sense.
    let headline: string | undefined;
    if (name === 'pnl_attribution') {
        const total = rows.reduce((s, r) => {
            const n = parseFloat(r.value.replace(/[+$,]/g, ''));
            return s + (Number.isFinite(n) ? (r.value.startsWith('-') ? -n : n) : 0);
        }, 0);
        headline = usdSigned(total);
    } else if (rows.length > 0) {
        headline = rows[0].value;
    }
    return { name, args, rows, headline };
}
