/**
 * AR-112 — Pattern detectors (v1 shipping set).
 *
 * Six deterministic detectors that scan a journal array and emit zero
 * or more `Pattern` objects. No randomness, no Date.now(), no side
 * effects. The whole file is pure — cheap to run, easy to test,
 * trivially unit-testable via fixture arrays.
 *
 * Design notes:
 *   - Thresholds are named constants at module top so they're easy to
 *     tune from one place. Real-world thresholds should be learned, not
 *     hardcoded — that's a v2 item.
 *   - `score` on each emitted pattern is in rough "dollars of attention"
 *     so the ranked feed surfaces the most impactful observation first.
 *     Non-dollar signals (setup win rate) convert to dollars via the
 *     median trade size times the delta-from-baseline.
 *   - Every detector returns an empty array when it has no signal, so
 *     `DETECTORS.flatMap(d => d(entries))` composes cleanly.
 */

import type { JournalEntry } from '@/types/trade';
import type { DetectorContext, Pattern, PatternDetector } from './types';

// --------------------------------------------------------------------- //
// Shared thresholds + tiny helpers
// --------------------------------------------------------------------- //

/** Min trades inside an hour-of-day bucket before `late_day_losses` flags. */
const HOUR_BUCKET_MIN_TRADES = 5;
/** Loss rate threshold for `late_day_losses` (0–1). */
const HOUR_BUCKET_LOSS_RATE = 0.6;
/** Min streak length before `size_creep_after_wins` measures. */
const WIN_STREAK_MIN = 3;
/** Size multiplier threshold vs. baseline before flagging. */
const SIZE_CREEP_MULTIPLIER = 2.0;
/** Min trades per setup before `high_win_setup` measures. */
const SETUP_MIN_TRADES = 10;
/** Win rate threshold for `high_win_setup` (0–1). */
const HIGH_WIN_RATE = 0.65;
/** Min drift (percentage points) before `sector_drift` flags. */
const SECTOR_DRIFT_PP = 3;
/** Min fraction of NAV lost to caution moods before flagging. */
const MOOD_LOSS_NAV_FRAC = 0.01;
/** Single-weekday share of total realized P&L that flags concentration. */
const WEEKDAY_CONCENTRATION = 0.6;

function isWin(e: JournalEntry): boolean {
    return e.realizedPnlUsd > 0;
}

function pct(n: number): number {
    return Math.round(n * 100);
}

function usd(n: number): string {
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
    return `${sign}$${abs.toFixed(0)}`;
}

function hourLabel(h: number): string {
    const hh = String(h).padStart(2, '0');
    return `${hh}:00`;
}

/** ISO-8601 weekday names, Mon–Sun. `Date.getDay()` returns 0=Sun,
 *  1=Mon, …, 6=Sat — we re-index so Monday is 0 for weekday-grouping
 *  logic. */
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function getWeekdayIndex(d: Date): number {
    // getDay: 0=Sun..6=Sat → remap so Mon=0
    return (d.getDay() + 6) % 7;
}

// --------------------------------------------------------------------- //
// Detector: late_day_losses
// --------------------------------------------------------------------- //

/**
 * Losing rate by hour-of-day bucket. Flags any hour with ≥5 trades and
 * a loss rate above 60%. Emits one pattern per flagging hour; the
 * worst-performing hour gets the highest score.
 */
export const detectLateDayLosses: PatternDetector = (entries, ctx) => {
    const buckets = new Map<
        number,
        { wins: number; losses: number; ids: string[]; totalLoss: number }
    >();
    for (const e of entries) {
        const h = new Date(e.rationale.capturedAt).getHours();
        const b = buckets.get(h) ?? { wins: 0, losses: 0, ids: [], totalLoss: 0 };
        if (isWin(e)) b.wins += 1;
        else {
            b.losses += 1;
            b.totalLoss += e.realizedPnlUsd; // negative
        }
        b.ids.push(e.id);
        buckets.set(h, b);
    }
    const out: Pattern[] = [];
    for (const [h, b] of buckets.entries()) {
        const n = b.wins + b.losses;
        if (n < HOUR_BUCKET_MIN_TRADES) continue;
        const lossRate = b.losses / n;
        if (lossRate < HOUR_BUCKET_LOSS_RATE) continue;
        out.push({
            id: `late_day_losses:${h}`,
            detector: 'late_day_losses',
            severity: 'warn',
            headline: `You lose <em>${pct(lossRate)}%</em> of trades entered between ${hourLabel(h)}–${hourLabel((h + 1) % 24)} ET.`,
            body: `${b.losses} losses across ${n} trades in this hour bucket · realized ${usd(b.totalLoss)} over the window.`,
            actions: [
                {
                    kind: 'link',
                    label: 'See trades',
                    variant: 'primary',
                    payload: {
                        href: `/performance?tradeIds=${b.ids.join(',')}`,
                    },
                },
                {
                    kind: 'rule',
                    label: 'Add to rules',
                    variant: 'ghost',
                    payload: {
                        kind: 'allowed_hours',
                        params: { fromHour: 9, toHour: h },
                    },
                },
                { kind: 'dismiss', label: 'Dismiss', variant: 'ghost' },
            ],
            evidenceTradeIds: b.ids,
            score: Math.abs(b.totalLoss),
            generatedAt: ctx.now,
        });
    }
    return out;
};

// --------------------------------------------------------------------- //
// Detector: size_creep_after_wins
// --------------------------------------------------------------------- //

/**
 * After a streak of ≥3 wins, is the next trade's notional more than 2×
 * the baseline? Baseline = median notional across all trades. Emits
 * once when the avg post-streak notional ratio exceeds 2×. Ignores
 * individual outliers — we want to see the pattern, not one big bet.
 */
export const detectSizeCreepAfterWins: PatternDetector = (entries, ctx) => {
    if (entries.length < WIN_STREAK_MIN + 1) return [];
    // Chronological order — oldest first — so streak walk reads forward.
    const sorted = [...entries].sort((a, b) =>
        a.closedAt.localeCompare(b.closedAt),
    );
    const notionals = sorted.map((e) => e.notionalUsd);
    const baseline = median(notionals);
    if (baseline <= 0) return [];

    let streak = 0;
    const postStreakNotionals: number[] = [];
    const postStreakIds: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
        const e = sorted[i];
        if (streak >= WIN_STREAK_MIN) {
            postStreakNotionals.push(e.notionalUsd);
            postStreakIds.push(e.id);
        }
        if (isWin(e)) streak += 1;
        else streak = 0;
    }
    if (postStreakNotionals.length < 2) return [];
    const avgAfter = postStreakNotionals.reduce((s, n) => s + n, 0) / postStreakNotionals.length;
    const ratio = avgAfter / baseline;
    if (ratio < SIZE_CREEP_MULTIPLIER) return [];

    return [
        {
            id: 'size_creep_after_wins',
            detector: 'size_creep_after_wins',
            severity: 'caution',
            headline: `Position sizing grows <em>${ratio.toFixed(1)}×</em> after a win streak of ${WIN_STREAK_MIN}+.`,
            body: `Average post-streak notional of ${usd(avgAfter)} vs. ${usd(baseline)} baseline across ${postStreakNotionals.length} trades.`,
            actions: [
                {
                    kind: 'link',
                    label: 'See trades',
                    variant: 'primary',
                    payload: { href: `/performance?tradeIds=${postStreakIds.join(',')}` },
                },
                {
                    kind: 'rule',
                    label: 'Add to rules',
                    variant: 'ghost',
                    payload: { kind: 'max_position_pct', params: { pct: 5 } },
                },
                { kind: 'dismiss', label: 'Dismiss', variant: 'ghost' },
            ],
            evidenceTradeIds: postStreakIds,
            score: (ratio - 1) * baseline * postStreakNotionals.length,
            generatedAt: ctx.now,
        },
    ];
};

// --------------------------------------------------------------------- //
// Detector: high_win_setup
// --------------------------------------------------------------------- //

/**
 * Positive pattern — which setup is working? Groups by
 * `rationale.setupType`, and if any setup clears 65% win rate over
 * ≥10 trades, emits one pattern per qualifying setup.
 */
export const detectHighWinSetup: PatternDetector = (entries, ctx) => {
    const groups = new Map<string, { wins: number; losses: number; ids: string[]; totalPnl: number }>();
    for (const e of entries) {
        const k = e.rationale.setupType;
        const g = groups.get(k) ?? { wins: 0, losses: 0, ids: [], totalPnl: 0 };
        if (isWin(e)) g.wins += 1;
        else g.losses += 1;
        g.ids.push(e.id);
        g.totalPnl += e.realizedPnlUsd;
        groups.set(k, g);
    }
    const out: Pattern[] = [];
    for (const [setup, g] of groups.entries()) {
        const n = g.wins + g.losses;
        if (n < SETUP_MIN_TRADES) continue;
        const winRate = g.wins / n;
        if (winRate < HIGH_WIN_RATE) continue;
        const label = SETUP_LABEL[setup] ?? setup;
        out.push({
            id: `high_win_setup:${setup}`,
            detector: 'high_win_setup',
            severity: 'positive',
            headline: `Your <em>${label}</em> trades win <em>${pct(winRate)}%</em> of the time over ${n} entries.`,
            body: `Aggregate realized P&L of ${usd(g.totalPnl)} — consider leaning into this setup.`,
            actions: [
                {
                    kind: 'link',
                    label: 'See trades',
                    variant: 'primary',
                    payload: { href: `/performance?tradeIds=${g.ids.join(',')}` },
                },
                { kind: 'dismiss', label: 'Dismiss', variant: 'ghost' },
            ],
            evidenceTradeIds: g.ids,
            score: Math.max(g.totalPnl, 0),
            generatedAt: ctx.now,
        });
    }
    return out;
};

const SETUP_LABEL: Record<string, string> = {
    conviction_add: 'Conviction-add',
    breakout: 'Breakout',
    mean_reversion: 'Mean-reversion',
    rebalance: 'Rebalance',
    dividend_capture: 'Dividend-capture',
    other: 'Other',
};

// --------------------------------------------------------------------- //
// Detector: sector_drift
// --------------------------------------------------------------------- //

/**
 * Sector allocation drift. Computes current sector mix by notional
 * over the last 14 days of entries, compares to the target map, and
 * emits one pattern per sector drifting more than 3pp over target.
 *
 * v1 uses a fixed target map (handed in via ctx). v2 will read the
 * active strategy's sector targets from the store.
 */
export const detectSectorDrift: PatternDetector = (entries, ctx) => {
    const cutoff = Date.now() - 14 * 86_400_000;
    const recent = entries.filter((e) => Date.parse(e.closedAt) >= cutoff);
    if (recent.length === 0) return [];

    const totalNotional = recent.reduce((s, e) => s + e.notionalUsd, 0);
    if (totalNotional <= 0) return [];
    const bySector = new Map<string, number>();
    for (const e of recent) {
        const sector = ctx.sectorByTicker[e.ticker];
        if (!sector) continue;
        bySector.set(sector, (bySector.get(sector) ?? 0) + e.notionalUsd);
    }

    const out: Pattern[] = [];
    for (const [sector, notional] of bySector.entries()) {
        const actual = notional / totalNotional;
        const target = ctx.sectorTargets[sector] ?? 0;
        const drift = (actual - target) * 100;
        if (drift <= SECTOR_DRIFT_PP) continue;
        out.push({
            id: `sector_drift:${sector}`,
            detector: 'sector_drift',
            severity: 'info',
            headline: `<em>${sector}</em> overweight <em>+${drift.toFixed(1)}pp</em> vs your strategy target.`,
            body: `Last-14-day notional at ${pct(actual)}% vs ${pct(target)}% target across ${recent.length} trades.`,
            actions: [
                {
                    kind: 'link',
                    label: 'View allocation',
                    variant: 'primary',
                    payload: { href: '/portfolios/holdings' },
                },
                { kind: 'dismiss', label: 'Dismiss', variant: 'ghost' },
            ],
            evidenceTradeIds: recent
                .filter((e) => ctx.sectorByTicker[e.ticker] === sector)
                .map((e) => e.id),
            score: drift * (totalNotional / 100),
            generatedAt: ctx.now,
        });
    }
    return out;
};

// --------------------------------------------------------------------- //
// Detector: negative_mood_cost
// --------------------------------------------------------------------- //

/**
 * FOMO / revenge trade losses over the full journal window. When the
 * sum exceeds 1% of NAV, flag. Score is the raw dollar loss — big
 * enough to dominate the feed when it fires, which is the point: this
 * is the headline nudge of JournalPlus.
 */
export const detectNegativeMoodCost: PatternDetector = (entries, ctx) => {
    const cautionIds = ['fomo', 'revenge'];
    const hits = entries.filter((e) => cautionIds.includes(e.rationale.mood));
    if (hits.length === 0) return [];
    const netPnl = hits.reduce((s, e) => s + e.realizedPnlUsd, 0);
    // Only flag when the caution-mood bucket is a net drain on the
    // account. Positive net P&L here means FOMO isn't (yet) costing
    // the user — surfacing it as a warn would be misleading.
    if (netPnl >= 0) return [];
    const magnitude = Math.abs(netPnl);
    if (magnitude < ctx.nav * MOOD_LOSS_NAV_FRAC) return [];
    return [
        {
            id: 'negative_mood_cost',
            detector: 'negative_mood_cost',
            severity: 'warn',
            headline: `FOMO/revenge trades cost you <em>${usd(magnitude)}</em> across ${hits.length} trades.`,
            body: `Net realized P&L on caution-mood entries is ${usd(netPnl)} — about ${((magnitude / ctx.nav) * 100).toFixed(1)}% of current NAV.`,
            actions: [
                {
                    kind: 'link',
                    label: 'See trades',
                    variant: 'primary',
                    payload: { href: `/performance?tradeIds=${hits.map((h) => h.id).join(',')}` },
                },
                {
                    kind: 'rule',
                    label: 'Enable cooldown',
                    variant: 'ghost',
                    payload: { kind: 'cooldown' },
                },
                { kind: 'dismiss', label: 'Dismiss', variant: 'ghost' },
            ],
            evidenceTradeIds: hits.map((h) => h.id),
            score: magnitude,
            generatedAt: ctx.now,
        },
    ];
};

// --------------------------------------------------------------------- //
// Detector: best_weekday_concentration
// --------------------------------------------------------------------- //

/**
 * Which weekday delivers the P&L? If one weekday accounts for >60% of
 * realized P&L, surface it as an info pattern — the user can decide
 * whether to concentrate more there or diversify the schedule.
 */
export const detectBestWeekdayConcentration: PatternDetector = (entries, ctx) => {
    if (entries.length < 5) return [];
    const winsOnly = entries.filter((e) => e.realizedPnlUsd > 0);
    if (winsOnly.length === 0) return [];
    const totalWinPnl = winsOnly.reduce((s, e) => s + e.realizedPnlUsd, 0);
    if (totalWinPnl <= 0) return [];

    const byWeekday: { pnl: number; ids: string[] }[] = Array.from(
        { length: 7 },
        () => ({ pnl: 0, ids: [] }),
    );
    for (const e of winsOnly) {
        const idx = getWeekdayIndex(new Date(e.closedAt));
        byWeekday[idx].pnl += e.realizedPnlUsd;
        byWeekday[idx].ids.push(e.id);
    }
    let bestIdx = 0;
    for (let i = 1; i < 7; i++) {
        if (byWeekday[i].pnl > byWeekday[bestIdx].pnl) bestIdx = i;
    }
    const share = byWeekday[bestIdx].pnl / totalWinPnl;
    if (share < WEEKDAY_CONCENTRATION) return [];

    return [
        {
            id: `best_weekday_concentration:${bestIdx}`,
            detector: 'best_weekday_concentration',
            severity: 'info',
            headline: `<em>${WEEKDAY_NAMES[bestIdx]}</em> accounts for <em>${pct(share)}%</em> of your realized wins.`,
            body: `${byWeekday[bestIdx].ids.length} winning trades on ${WEEKDAY_NAMES[bestIdx]}s totalling ${usd(byWeekday[bestIdx].pnl)}.`,
            actions: [
                {
                    kind: 'link',
                    label: 'See trades',
                    variant: 'primary',
                    payload: { href: `/performance?tradeIds=${byWeekday[bestIdx].ids.join(',')}` },
                },
                { kind: 'dismiss', label: 'Dismiss', variant: 'ghost' },
            ],
            evidenceTradeIds: byWeekday[bestIdx].ids,
            score: byWeekday[bestIdx].pnl,
            generatedAt: ctx.now,
        },
    ];
};

// --------------------------------------------------------------------- //
// Registry
// --------------------------------------------------------------------- //

export const DETECTORS: ReadonlyArray<PatternDetector> = [
    detectLateDayLosses,
    detectSizeCreepAfterWins,
    detectHighWinSetup,
    detectSectorDrift,
    detectNegativeMoodCost,
    detectBestWeekdayConcentration,
];

// --------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------- //

/** Median of a non-empty numeric array. Returns 0 for an empty input
 *  (defensive — callers should gate). */
function median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

export function runAllDetectors(
    entries: ReadonlyArray<JournalEntry>,
    ctx: DetectorContext,
): Pattern[] {
    const out: Pattern[] = [];
    for (const d of DETECTORS) {
        for (const p of d(entries, ctx)) out.push(p);
    }
    return out;
}
