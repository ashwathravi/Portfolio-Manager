/**
 * Time-weighted returns from valuation snapshots (launch item i49).
 *
 * A series steps from one snapshot date to the next. A step's return is
 * what the positions held at the first date's close made by the second
 * date's close: each position's market value times its close-to-close
 * price change, over the accounts' total value (cash earns nothing).
 * Chaining the steps gives the time-weighted return.
 *
 * A step prices only what was already held, so money moving in or out
 * (an import, a deposit, a withdrawal, a transfer between the user's own
 * accounts) never reads as a gain or a loss, and no list of flows is
 * needed. Price changes come from stored closes, which are split-adjusted,
 * so a split between two dates isn't a loss either. What it leaves out: a
 * trade's gain or loss on the day it's made (positions are measured from
 * the close before) and dividends (closes are price-only, like the ETF
 * benchmarks it's compared with).
 *
 * All accounts together are one portfolio: a step combines every account
 * with a snapshot at its first date, weighted by value. An account added
 * later joins from its first snapshot; one missing a date sits out the
 * step that starts there.
 */

import { STALE_CLOSE_DAYS, type StoredClose } from "@/lib/portfolio/valuation-snapshots";
import type { DatedValue } from "./periodSummary";

export interface SnapshotPositionValue {
    symbol: string;
    /** Null when the position had no close; the snapshot's total leaves it out. */
    marketValue: number | null;
}

export interface AccountSnapshot {
    portfolioId: string;
    date: string;
    totalValue: number;
    positions: readonly SnapshotPositionValue[];
}

export interface ReturnPoint {
    date: string;
    /** Total value at the close of the accounts with a snapshot that day. */
    value: number;
    /** Growth of 100 since the first date. */
    index: number;
    /** The step's return into this date; null for the first date or a step with nothing invested. */
    stepReturn: number | null;
    /** Positions counted as unchanged in this step because a close was missing. */
    unpriced: string[];
}

export const INDEX_BASE = 100;

function minusCalendarDays(date: string, days: number): string {
    const at = new Date(`${date}T12:00:00Z`);
    at.setUTCDate(at.getUTCDate() - days);
    return at.toISOString().slice(0, 10);
}

/**
 * A symbol's close for `date`: the last stored close on or before it, if
 * at most STALE_CLOSE_DAYS old (the rule snapshots are valued by).
 * `closes` is oldest first.
 */
export function closeOn(closes: readonly StoredClose[] | undefined, date: string): number | null {
    let found: StoredClose | undefined;
    for (const bar of closes ?? []) {
        if (bar.date > date) break;
        found = bar;
    }
    if (!found || !(found.close > 0) || found.date < minusCalendarDays(date, STALE_CLOSE_DAYS)) return null;
    return found.close;
}

/**
 * The return from `snapshots`' date to `to` of what they held. A position
 * without a close at either end is counted as unchanged and listed in
 * `unpriced`. Null when nothing was invested (total value zero or less).
 */
export function stepReturn(
    snapshots: readonly AccountSnapshot[],
    to: string,
    closes: ReadonlyMap<string, readonly StoredClose[]>,
): { stepReturn: number | null; unpriced: string[] } {
    let base = 0;
    let gain = 0;
    const unpriced = new Set<string>();
    for (const snapshot of snapshots) {
        base += snapshot.totalValue;
        for (const { symbol, marketValue } of snapshot.positions) {
            if (marketValue === null || !Number.isFinite(marketValue) || marketValue === 0) continue;
            const from = closeOn(closes.get(symbol), snapshot.date);
            const at = closeOn(closes.get(symbol), to);
            if (from === null || at === null) unpriced.add(symbol);
            else gain += marketValue * (at / from - 1);
        }
    }
    if (!(base > 0)) return { stepReturn: null, unpriced: [] };
    return { stepReturn: gain / base, unpriced: [...unpriced].sort() };
}

/**
 * The chained return series of `snapshots` (one account's, or several
 * accounts' together), one point per snapshot date, oldest first.
 */
export function returnSeries(
    snapshots: readonly AccountSnapshot[],
    closes: ReadonlyMap<string, readonly StoredClose[]>,
): ReturnPoint[] {
    const byDate = new Map<string, AccountSnapshot[]>();
    for (const snapshot of snapshots) {
        const list = byDate.get(snapshot.date) ?? [];
        list.push(snapshot);
        byDate.set(snapshot.date, list);
    }
    const dates = [...byDate.keys()].sort();
    const points: ReturnPoint[] = [];
    let index = INDEX_BASE;
    let previous: AccountSnapshot[] | null = null;
    for (const date of dates) {
        const day = byDate.get(date) ?? [];
        const value = day.reduce((sum, snapshot) => sum + snapshot.totalValue, 0);
        if (previous === null) {
            points.push({ date, value, index, stepReturn: null, unpriced: [] });
        } else {
            const step = stepReturn(previous, date, closes);
            if (step.stepReturn !== null) index *= 1 + step.stepReturn;
            points.push({ date, value, index, stepReturn: step.stepReturn, unpriced: step.unpriced });
        }
        previous = day;
    }
    return points;
}

/**
 * A benchmark's closes on `dates`, or null when any date has none (a
 * comparison over part of the window would mislead).
 */
export function benchmarkSeries(
    dates: readonly string[],
    closes: readonly StoredClose[] | undefined,
): DatedValue[] | null {
    const out: DatedValue[] = [];
    for (const date of dates) {
        const close = closeOn(closes, date);
        if (close === null) return null;
        out.push({ date, value: close });
    }
    return out;
}
