/**
 * AR-113 — P&L density heatmap data layer.
 *
 * Pure functions. No React, no browser APIs, no Date.now() side
 * effects — callers pass `now` so the module stays test-deterministic.
 *
 * Convention: `day` is Mon-based, 0=Mon … 5=Sat. Sunday is dropped
 * entirely per the acceptance spec ("6 rows Mon–Sat"). Hours are
 * 0..23 in the JS environment's local timezone, which in practice is
 * what the journal fixtures record. A v2 pass should normalise to
 * US-Eastern once trade timestamps carry timezone info.
 */
import type { JournalEntry } from '@/types/trade';

/** A single grid cell: one weekday/hour pair. */
export interface HeatCell {
    /** 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat. Sunday is excluded. */
    day: number;
    /** 0..23. */
    hour: number;
    /** Count of closed trades that landed in this cell. */
    trades: number;
    /** Sum of realized P&L (USD) for those trades. */
    totalPnl: number;
    /** `totalPnl / trades`, or 0 when `trades === 0`. */
    avgPnl: number;
}

/** Plain-language callout for the best and worst trading windows. */
export interface HeatmapCallouts {
    /** `{ day, hour, totalPnl, trades, sharePct }` for the single best cell,
     *  or `null` if no positive P&L exists in the set. */
    best: { day: number; hour: number; totalPnl: number; trades: number; sharePct: number } | null;
    /** Same shape for the single worst cell, or `null` when nothing is
     *  in the red. Requires at least 2 trades so a single catastrophic
     *  loss doesn't hijack the narrative. */
    worst: { day: number; hour: number; totalPnl: number; trades: number } | null;
}

const DAYS_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Mon-based weekday index (0..5), or `-1` if the date falls on a
 *  Sunday (which is excluded from the grid). */
export function mondayIndex(dt: Date): number {
    const js = dt.getDay(); // 0=Sun..6=Sat
    if (js === 0) return -1;
    return js - 1; // Mon=0..Sat=5
}

/** Human label for a Mon-based index. Safe for out-of-range input. */
export function dayLabel(mondayIdx: number): string {
    return DAYS_MON_FIRST[mondayIdx] ?? '??';
}

/** `"09:00"` / `"14:00"` — padded for stable column widths. */
export function hourLabel(h: number): string {
    return `${String(h).padStart(2, '0')}:00`;
}

/**
 * Build the full 6×24 = 144 cells. Always returns the complete grid
 * even when empty, so the view layer can render the scaffold without
 * null-checks for missing cells.
 *
 * @param entries   Journal entries (only `realizedPnlUsd` + `closedAt`
 *                  are consulted).
 * @param rangeDays Days to include, counted back from `now`. Pass
 *                  `null` for "all time".
 * @param now       Epoch millis. Omit to use `Date.now()`. Tests pass
 *                  a fixed value for determinism.
 */
export function buildHeatmap(
    entries: JournalEntry[],
    rangeDays: number | null,
    now: number = Date.now(),
): HeatCell[] {
    const cells: HeatCell[] = [];
    for (let d = 0; d < 6; d++) {
        for (let h = 0; h < 24; h++) {
            cells.push({ day: d, hour: h, trades: 0, totalPnl: 0, avgPnl: 0 });
        }
    }
    const cutoff = rangeDays == null ? -Infinity : now - rangeDays * 86_400_000;
    for (const e of entries) {
        if (e.realizedPnlUsd == null) continue;
        const ts = Date.parse(e.closedAt);
        if (!Number.isFinite(ts) || ts < cutoff) continue;
        const dt = new Date(ts);
        const d = mondayIndex(dt);
        if (d < 0) continue; // Sunday — skip
        const h = dt.getHours();
        const idx = d * 24 + h;
        cells[idx].trades += 1;
        cells[idx].totalPnl += e.realizedPnlUsd;
    }
    for (const c of cells) {
        c.avgPnl = c.trades > 0 ? c.totalPnl / c.trades : 0;
        // Round to two decimals so serialised JSON stays tidy. Math is
        // already lossy here; this just keeps the e2e snapshots stable.
        c.totalPnl = Math.round(c.totalPnl * 100) / 100;
        c.avgPnl = Math.round(c.avgPnl * 100) / 100;
    }
    return cells;
}

/**
 * Compute the colour scale — the maximum absolute *average* P&L across
 * cells with at least one trade. `colorFor` then normalises the cell
 * average to that scale. Scale of 0 means "no coloured cells" and
 * `colorFor` will return the neutral tone for everything.
 */
export function computeScale(cells: HeatCell[]): number {
    let max = 0;
    for (const c of cells) {
        if (c.trades === 0) continue;
        const a = Math.abs(c.avgPnl);
        if (a > max) max = a;
    }
    return max;
}

/**
 * 5-stop diverging colour map keyed off the ratio `avg / scale`.
 * Thresholds match the AR-113 spec exactly:
 *   > 0.6     deep green  #17cf54
 *   > 0.2     light green #bbf7d0
 *   [-0.2,+0.2] neutral   #f0f2f4
 *   < -0.2    light red   #fee2e2
 *   < -0.6    deep red    #fecaca
 */
export function colorFor(avgPnl: number, scale: number): string {
    if (scale === 0 || avgPnl === 0) return '#f0f2f4';
    const r = avgPnl / scale;
    if (r > 0.6) return '#17cf54';
    if (r > 0.2) return '#bbf7d0';
    if (r > -0.2) return '#f0f2f4';
    if (r > -0.6) return '#fee2e2';
    return '#fecaca';
}

/**
 * Pick the single best (highest totalPnl) and worst (most-negative
 * totalPnl) cells, and compute the best cell's share of the grid's
 * total positive P&L. The worst cell requires ≥ 2 trades so a single
 * catastrophic loss doesn't write the headline.
 */
export function computeCallouts(cells: HeatCell[]): HeatmapCallouts {
    let best: HeatCell | null = null;
    let worst: HeatCell | null = null;
    let totalPositive = 0;
    for (const c of cells) {
        if (c.trades === 0) continue;
        if (c.totalPnl > 0) totalPositive += c.totalPnl;
        if (c.totalPnl > 0 && (best == null || c.totalPnl > best.totalPnl)) {
            best = c;
        }
        if (
            c.totalPnl < 0 &&
            c.trades >= 2 &&
            (worst == null || c.totalPnl < worst.totalPnl)
        ) {
            worst = c;
        }
    }
    return {
        best:
            best == null
                ? null
                : {
                      day: best.day,
                      hour: best.hour,
                      totalPnl: best.totalPnl,
                      trades: best.trades,
                      sharePct:
                          totalPositive > 0
                              ? (best.totalPnl / totalPositive) * 100
                              : 0,
                  },
        worst:
            worst == null
                ? null
                : {
                      day: worst.day,
                      hour: worst.hour,
                      totalPnl: worst.totalPnl,
                      trades: worst.trades,
                  },
    };
}

/** `$1,420` / `-$980`. No fractional dollars — heatmap copy is
 *  rounded at the callout surface. */
export function usd(n: number): string {
    const abs = Math.abs(Math.round(n));
    const formatted = abs.toLocaleString('en-US');
    return `${n < 0 ? '-$' : '$'}${formatted}`;
}

/** Helper: total trades across the grid. Handy for the "no data"
 *  check in the card. */
export function totalTrades(cells: HeatCell[]): number {
    let s = 0;
    for (const c of cells) s += c.trades;
    return s;
}
