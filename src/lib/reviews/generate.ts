/**
 * AR-114 — review generator.
 *
 * Pure function. Given the journal + week bounds, compute stats and
 * a narrative. No `Date.now()`, no localStorage. Used by both the
 * dashboard hero card (latest completed week) and the Performance
 * archive (last N weeks).
 *
 * Scope calls:
 *   - `navPctChange` uses a fixed nominal NAV (configurable via ctx)
 *     because the seed era has no NAV series. Once live portfolio
 *     value lands, wire that through `ctx.nav`.
 *   - `ruleAdherence` averages the frozen `TradeAdherence.score` on
 *     every entry that carries one. Entries pre-dating AR-111 fall
 *     back to a "hygiene" heuristic (thesisId + conviction ≥ 5 +
 *     non-none setupType → 100; otherwise 0 per failing check).
 *   - `bestDecision` is the single highest-P&L winning trade in the
 *     window, labelled as `"<SIDE> <QTY> <TICKER>"`.
 */
import type { JournalEntry } from '@/types/trade';
import type { WeekBounds, WeeklyReview, ReviewStats, TradeCount, BestDecision } from './types';
import { buildNarrative } from './narrative';
import { computeChurnAnalysis, type ChurnTrade } from '@/lib/risk-policy/churn';

/** Fallback NAV. The JournalPlus seed + pattern feed already assume
 *  $250k — keeping it identical means all JournalPlus surfaces agree
 *  on what "1% of NAV" means. */
export const DEFAULT_NAV = 250_000;

export interface GenerateReviewOptions {
    /** Nominal NAV used to compute `navPctChange`. Default 250k. */
    nav?: number;
}

function inWindow(entry: JournalEntry, startMs: number, endMs: number): boolean {
    const t = Date.parse(entry.closedAt);
    return Number.isFinite(t) && t >= startMs && t <= endMs;
}

function hygieneScore(entry: JournalEntry): number {
    // Three-gate hygiene: thesis present, conviction ≥ 5, setup categorized.
    // `setupType === 'other'` is the un-categorized escape hatch, so we
    // treat it as a missed gate.
    const { rationale } = entry;
    let ok = 0;
    if (rationale?.thesisId) ok++;
    if (typeof rationale?.conviction === 'number' && rationale.conviction >= 5) ok++;
    if (rationale?.setupType && rationale.setupType !== 'other') ok++;
    return Math.round((ok / 3) * 100);
}

function entryAdherenceScore(entry: JournalEntry): number {
    const frozen = entry.adherence?.score;
    if (typeof frozen === 'number') return frozen;
    return hygieneScore(entry);
}

function labelTrade(e: JournalEntry): string {
    const qty = Math.abs(Math.round(e.quantity));
    return `${e.side === 'buy' ? 'Bought' : 'Sold'} ${qty} ${e.ticker}`;
}

function computeTradeCount(entries: JournalEntry[]): TradeCount {
    let buy = 0;
    let sell = 0;
    let rebalance = 0;
    for (const e of entries) {
        if (e.rationale?.setupType === 'rebalance') {
            rebalance += 1;
            continue;
        }
        if (e.side === 'buy') buy += 1;
        else sell += 1;
    }
    return { buy, sell, rebalance, total: entries.length };
}

function computeBestDecision(entries: JournalEntry[]): BestDecision | undefined {
    let best: JournalEntry | null = null;
    for (const e of entries) {
        if (e.realizedPnlUsd <= 0) continue;
        if (best == null || e.realizedPnlUsd > best.realizedPnlUsd) best = e;
    }
    if (!best) return undefined;
    return {
        tradeId: best.id,
        label: labelTrade(best),
        impactUsd: Math.round(best.realizedPnlUsd * 100) / 100,
    };
}

function countPolicyExceptions(entries: JournalEntry[]): number {
    return entries.reduce((sum, entry) => sum + (entry.policyExceptions?.length ?? 0), 0);
}

function countSellDisciplineEvents(entries: JournalEntry[], startMs: number, endMs: number): number {
    return entries.reduce((sum, entry) => {
        const events = entry.sellDisciplineEvents ?? [];
        return sum + events.filter((event) => {
            const createdAt = Date.parse(event.createdAt);
            return Number.isFinite(createdAt) && createdAt >= startMs && createdAt <= endMs;
        }).length;
    }, 0);
}

function computeChurnWarnings(entries: JournalEntry[], bounds: WeekBounds): {
    churnWarnings: number;
    churnSymbols: string[];
} {
    const trades: ChurnTrade[] = entries.map((entry) => ({
        id: entry.id,
        date: entry.closedAt,
        type: entry.side,
        ticker: entry.ticker,
        amount: entry.notionalUsd,
        quantity: entry.quantity,
        price: entry.entryPrice,
        setupType: entry.rationale?.setupType,
        mood: entry.rationale?.mood,
        thesisId: entry.rationale?.thesisId,
        rationale: entry.rationale,
        adherenceScore: entry.adherence?.score,
        holdingPeriodDays: entry.holdingPeriodDays,
        policyExceptions: entry.policyExceptions,
    }));
    const analysis = computeChurnAnalysis(trades, {
        windowDays: 7,
        asOf: bounds.weekEnd,
        watchRepeatSymbols: 1,
        breachRepeatSymbols: 2,
    });
    const warningRows = analysis.rows.filter((row) => row.status !== "inside");

    return {
        churnWarnings: warningRows.length,
        churnSymbols: warningRows.map((row) => row.symbol),
    };
}

export function generateReview(
    entries: JournalEntry[],
    bounds: WeekBounds,
    opts: GenerateReviewOptions = {},
): WeeklyReview {
    const startMs = Date.parse(bounds.weekStart);
    const endMs = Date.parse(bounds.weekEnd);
    const windowed = entries.filter((e) => inWindow(e, startMs, endMs));

    const realizedPnlUsd = Math.round(
        windowed.reduce((s, e) => s + (e.realizedPnlUsd || 0), 0) * 100,
    ) / 100;

    const nav = opts.nav ?? DEFAULT_NAV;
    const navPctChange = nav === 0 ? 0 : (realizedPnlUsd / nav) * 100;

    let ruleAdherence = 100;
    let exceptions = 0;
    if (windowed.length > 0) {
        const sum = windowed.reduce((s, e) => s + entryAdherenceScore(e), 0);
        ruleAdherence = Math.round(sum / windowed.length);
        exceptions = windowed.filter((e) => entryAdherenceScore(e) < 80).length;
    }
    const policyExceptions = countPolicyExceptions(windowed);
    const sellDisciplineEvents = countSellDisciplineEvents(entries, startMs, endMs);
    const churn = computeChurnWarnings(windowed, bounds);

    const stats: ReviewStats = {
        realizedPnlUsd,
        navPctChange: Math.round(navPctChange * 100) / 100,
        ruleAdherence,
        exceptions: exceptions + policyExceptions,
        policyExceptions,
        sellDisciplineEvents,
        churnWarnings: churn.churnWarnings,
        churnSymbols: churn.churnSymbols,
        tradeCount: computeTradeCount(windowed),
        bestDecision: computeBestDecision(windowed),
    };

    return {
        ...bounds,
        stats,
        narrative: buildNarrative(stats),
    };
}
