/**
 * Mood analytics (AR-110 — JournalPlus Integration).
 *
 * Pure functions over `JournalEntry[]`. The Performance surface calls
 * these; they have no access to window, no access to stores, no side
 * effects. That's deliberate:
 *
 *   1. Easy to unit-test (Playwright can `evaluate()` them in-browser
 *      with fixture data, there's no DOM).
 *   2. Easy to memoize in a consuming component with `useMemo` on
 *      `[trades, rangeDays]`.
 *   3. Easy to move to a worker or the server later if the journal
 *      ever gets big enough to need it.
 *
 * Every field is computed; nothing is stored. Changing the trade set
 * recomputes everything.
 */

import type { JournalEntry, Mood } from '@/types/trade';
import { MOOD_META } from '@/types/trade';

/** Stat row for a single mood. Exactly six of these come back from
 *  `moodBreakdown`, one per entry in `MOOD_META`, in that order — even
 *  for moods with zero trades in range. The UI counts on a stable row
 *  set to render its six-row layout without conditional rendering per
 *  row.
 */
export interface MoodStat {
    mood: Mood;
    emoji: string;
    label: string;
    /** `'ok'` or `'caution'` — copied from `MOOD_META` so callers can
     *  style the row without reimporting the meta list. */
    tone: 'ok' | 'caution';
    /** Number of trades in the range with this mood. */
    tradeCount: number;
    /** Sum of realized P&L across those trades, USD. Can be negative. */
    totalPnlUsd: number;
    /** Share of trades that closed green. `0` when `tradeCount === 0`
     *  — the UI reads `tradeCount` to decide whether to render a rate
     *  at all, so there's no NaN surface. */
    winRate: number;
    /** Mean P&L per trade, USD. `0` when `tradeCount === 0`. */
    avgPnlUsd: number;
}

/**
 * Filter predicate for "trade closed within the last N days". Null
 * `rangeDays` means "no filter, include every trade" (the `ALL` pill).
 *
 * Using `closedAt` not `openedAt` — the user cares about when the P&L
 * hit the book, not when the decision was made. That matches how
 * brokerages bucket realized gains for tax reporting and keeps the
 * heatmap coherent with the range selector.
 */
function isInRange(
    trade: JournalEntry,
    rangeDays: number | null,
    now: number,
): boolean {
    if (rangeDays == null) return true;
    const closedMs = Date.parse(trade.closedAt);
    if (!Number.isFinite(closedMs)) return false;
    const cutoff = now - rangeDays * 86_400_000;
    return closedMs >= cutoff;
}

/**
 * Reduce a list of closed trades down to per-mood totals.
 *
 * Returns a stable six-row array (one per mood in `MOOD_META`'s order)
 * so consumers can `.map()` straight into the table without sorting or
 * handling missing rows. Moods with no trades in range get a zeroed
 * row — the Performance card shows those greyed out rather than
 * hiding them, so the user can see "I haven't been frustrated in 90
 * days" as real signal.
 *
 * The `now` parameter exists so tests (and the "last 30 days" range
 * pill) can freeze the window explicitly. Defaults to `Date.now()` so
 * normal callers don't have to thread it through.
 */
export function moodBreakdown(
    trades: JournalEntry[],
    rangeDays: number | null,
    now: number = Date.now(),
): MoodStat[] {
    const filtered = trades.filter((t) => isInRange(t, rangeDays, now));

    // Bucket by mood. One pass over the filtered list; keeps the
    // aggregation O(n) even on very long journals.
    const buckets = new Map<Mood, { count: number; total: number; wins: number }>();
    for (const t of filtered) {
        const b = buckets.get(t.rationale.mood) ?? { count: 0, total: 0, wins: 0 };
        b.count += 1;
        b.total += t.realizedPnlUsd;
        if (t.realizedPnlUsd > 0) b.wins += 1;
        buckets.set(t.rationale.mood, b);
    }

    // Walk MOOD_META so row order and metadata stay consistent with
    // the chip row in <PreTradeRationale>. Moods absent from the
    // filtered set land as zero rows.
    return MOOD_META.map((meta) => {
        const b = buckets.get(meta.value);
        const count = b?.count ?? 0;
        const total = b?.total ?? 0;
        const wins = b?.wins ?? 0;
        return {
            mood: meta.value,
            emoji: meta.emoji,
            label: meta.label,
            tone: meta.tone,
            tradeCount: count,
            totalPnlUsd: Math.round(total * 100) / 100,
            winRate: count > 0 ? wins / count : 0,
            avgPnlUsd: count > 0 ? Math.round((total / count) * 100) / 100 : 0,
        };
    });
}

/**
 * Total number of trades in range. Used by the `<MoodBreakdownCard>`
 * empty-state threshold — we only render the full analytics when the
 * user has at least 10 tagged trades, otherwise we show a "capture a
 * few more trades" coach copy. Ten is arbitrary but matches the
 * threshold in AR-110's acceptance criteria.
 */
export function totalTaggedTrades(stats: MoodStat[]): number {
    return stats.reduce((sum, s) => sum + s.tradeCount, 0);
}

/**
 * Pick the single row the verdict panel should call out. The rule is:
 *
 *   - Only consider caution moods (fomo / frustrated / revenge). Good
 *     moods with negative P&L are statistical noise, not a story.
 *   - Pick the most negative `totalPnlUsd` — that's the mood with the
 *     biggest dollar cost, which is the one worth naming.
 *   - If every caution mood is in the green (a rare but possible
 *     week), return `null` — the verdict switches to a celebratory
 *     tone the card handles separately.
 *
 * Kept as a standalone function so the card can unit-test the pick
 * logic without rendering.
 */
export function worstCautionMood(stats: MoodStat[]): MoodStat | null {
    const cautionInRed = stats.filter(
        (s) => s.tone === 'caution' && s.totalPnlUsd < 0,
    );
    if (cautionInRed.length === 0) return null;
    // Sort ascending by totalPnlUsd — most negative first.
    return [...cautionInRed].sort((a, b) => a.totalPnlUsd - b.totalPnlUsd)[0];
}
