/**
 * What the nightly "alerts" job raises (launch item i57), worked out from
 * what it read: no database here, so every rule can be tested.
 *
 * Market rules are evaluated once per session, on that session's stored
 * closes (the job runs after the price ingest):
 *   - a price rule on the symbol's close, and a daily-change rule on its
 *     close against the one before; a symbol with no close for the session
 *     raises nothing that evening;
 *   - an accounts-value rule on the user's cash plus holdings at their
 *     latest close (at cost without one in the last week, as Today counts
 *     them), and a day-change rule on the holdings priced that session.
 * Alpha Radar rules are evaluated on 13F changes Atlas stored since the job
 * last ran (and since the rule was made), with the user's own overlap, as
 * Research shows it (../alpha-radar/user-overlap.ts): the company in their
 * holdings, watchlist or active theses, by ticker or, as a 13F names it, by
 * name, and the change's score with what that overlap adds.
 *
 * Each rule raises at most one notification an evening, except an Alpha
 * Radar rule set to "always", which raises one per change (up to
 * MAX_CHANGES_PER_RULE). A notification names what raised it
 * (`occurrence`: the session, or the change and the filing it came from),
 * so a rerun records it once, and an Alpha Radar rule never raises the
 * same change twice: a refresh stores a period's changes again. The user's settings decide
 * which kinds they get: Price Alerts, Portfolio Updates, and Alpha Radar
 * Signals with its in-app channel and delivery filters.
 */

import { alphaRadarRelevanceBoost } from "@/lib/alpha-radar/diff";
import { buildAlphaRadarOverlapMatcher, NO_USER_OVERLAP, type AlphaRadarUserOverlap } from "@/lib/alpha-radar/user-overlap";

import { compare } from "./evaluator";
import { isAlphaRadarAlertMetric } from "./metrics";
import type { AlertComparator, AlertMetric } from "./types";

/** A close older than this, in calendar days before the session, counts as no price (as in valuation snapshots). */
export const STALE_CLOSE_DAYS = 7;
/** The most notifications one Alpha Radar rule set to "always" raises in a run. */
export const MAX_CHANGES_PER_RULE = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlannedRule {
    id: string;
    userId: string;
    name: string;
    metric: AlertMetric;
    symbol: string | null;
    comparator: AlertComparator;
    threshold: number;
    rearm: "once" | "always" | "daily";
    createdAt: Date;
    lastTriggeredAt: Date | null;
}

export interface StoredClose {
    date: string;
    close: number;
}

export interface UserAccounts {
    cash: number;
    /** `updatedAt`: when the holding last changed (split readiness compares it with split dates). */
    positions: readonly { symbol: string; quantity: number; avgCost: number; updatedAt?: Date }[];
}

export interface AlertableChange {
    trackedFilerId: string;
    filerName: string;
    reportPeriod: string;
    /** The filing the change was computed from (a later filing for the period is a new change). */
    currentFilingId: string | null;
    priorFilingId: string | null;
    cusip: string;
    ticker: string | null;
    issuerName: string;
    changeType: string;
    materialityScore: number;
    createdAt: Date;
}

export interface AlertPreferences {
    priceAlerts: boolean;
    portfolioUpdates: boolean;
    alphaRadarSignals: boolean;
    alphaRadar: {
        /** Delivery on, with the in-app channel. */
        inApp: boolean;
        overlapOnly: boolean;
        minMaterialityScore: number;
        tickerFilters: readonly string[];
        trackedFilerIds: readonly string[];
    };
}

export interface AlertPlanInput {
    rules: readonly PlannedRule[];
    /** The newest stored session, or null with no closes stored. */
    session: string | null;
    /** Each symbol's newest closes, newest first (two are enough). */
    closes: ReadonlyMap<string, readonly StoredClose[]>;
    /** Per user with at least one account. */
    accounts: ReadonlyMap<string, UserAccounts>;
    /** Per user with an Alpha Radar rule. */
    overlap: ReadonlyMap<string, AlphaRadarUserOverlap>;
    changes: readonly AlertableChange[];
    preferences: ReadonlyMap<string, AlertPreferences>;
    /** When the job last succeeded: Alpha Radar changes stored before it were seen then. */
    alphaRadarSince: Date | null;
    /** Each rule's occurrences already recorded (cleared ones included). */
    notified: ReadonlyMap<string, ReadonlySet<string>>;
    /** The run's date (YYYY-MM-DD, UTC): an Alpha Radar rule set to "daily" raises one a day. */
    runDate: string;
}

export interface AlertFiring {
    ruleId: string;
    userId: string;
    occurrence: string;
    ruleName: string;
    metric: AlertMetric;
    symbol: string | null;
    comparator: AlertComparator;
    threshold: number;
    observedValue: number;
    message: string;
    href: string | null;
}

export const DEFAULT_ALERT_PREFERENCES: AlertPreferences = {
    priceAlerts: true,
    portfolioUpdates: true,
    alphaRadarSignals: true,
    alphaRadar: { inApp: true, overlapOnly: false, minMaterialityScore: 0, tickerFilters: [], trackedFilerIds: [] },
};

export function planAlertFirings(input: AlertPlanInput): AlertFiring[] {
    const firings: AlertFiring[] = [];
    const accountValues = new Map<string, AccountsObservation | null>();
    for (const rule of input.rules) {
        const preferences = input.preferences.get(rule.userId) ?? DEFAULT_ALERT_PREFERENCES;
        if (!wantsKind(rule.metric, preferences)) continue;
        if (isAlphaRadarAlertMetric(rule.metric)) {
            firings.push(...alphaRadarFirings(rule, input, preferences));
            continue;
        }
        if (!input.session || input.notified.get(rule.id)?.has(`session:${input.session}`)) continue;
        let accounts: AccountsObservation | null = null;
        if (rule.metric === "portfolio_value" || rule.metric === "portfolio_day_change_pct") {
            if (!accountValues.has(rule.userId)) {
                const held = input.accounts.get(rule.userId);
                accountValues.set(rule.userId, held ? observeAccounts(held, input.closes, input.session) : null);
            }
            accounts = accountValues.get(rule.userId) ?? null;
        }
        const firing = marketFiring(rule, input.session, input.closes, accounts);
        if (firing) firings.push(firing);
    }
    return firings;
}

function wantsKind(metric: AlertMetric, preferences: AlertPreferences): boolean {
    if (isAlphaRadarAlertMetric(metric)) return preferences.alphaRadarSignals && preferences.alphaRadar.inApp;
    if (metric === "price" || metric === "price_change_pct") return preferences.priceAlerts;
    return preferences.portfolioUpdates;
}

// ---------------------------------------------------------------------------
// Market rules
// ---------------------------------------------------------------------------

export interface AccountsObservation {
    value: number;
    /** The holdings' move over the session as a fraction of the value before it; null if none was priced that session. */
    dayChangePct: number | null;
}

/** A move as a fraction, to a millionth: an exact 5% move meets a 5% threshold despite float error. */
function asFraction(value: number): number {
    return Math.round(value * 1e6) / 1e6;
}

function calendarDaysBetween(earlier: string, later: string): number {
    return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS);
}

export function observeAccounts(accounts: UserAccounts, closes: AlertPlanInput["closes"], session: string): AccountsObservation {
    let value = accounts.cash;
    let dayChange = 0;
    let pricedToday = false;
    for (const position of accounts.positions) {
        const [latest, previous] = closes.get(position.symbol) ?? [];
        const priced = latest && calendarDaysBetween(latest.date, session) <= STALE_CLOSE_DAYS;
        value += position.quantity * (priced ? latest.close : position.avgCost);
        if (latest?.date === session && previous) {
            dayChange += position.quantity * (latest.close - previous.close);
            pricedToday = true;
        }
    }
    const before = value - dayChange;
    return { value, dayChangePct: pricedToday && before > 0 ? asFraction(dayChange / before) : null };
}

function marketFiring(
    rule: PlannedRule,
    session: string,
    closes: AlertPlanInput["closes"],
    accounts: AccountsObservation | null,
): AlertFiring | null {
    const on = formatSessionDate(session);
    let observed: number | null = null;
    let message = "";
    let href: string | null = "/portfolios/holdings";
    if (rule.metric === "price" || rule.metric === "price_change_pct") {
        const symbol = rule.symbol ?? "";
        const [latest, previous] = closes.get(symbol) ?? [];
        if (latest?.date !== session) return null;
        href = `/portfolios/detail/${encodeURIComponent(symbol)}`;
        if (rule.metric === "price") {
            observed = latest.close;
            message = `${symbol} closed at ${formatMoney(observed)} on ${on}, ${comparatorWords(rule.comparator)} ${formatMoney(rule.threshold)}.`;
        } else {
            if (!previous || !(previous.close > 0)) return null;
            observed = asFraction(latest.close / previous.close - 1);
            message = `${symbol} moved ${formatPct(observed)} on ${on}, ${comparatorWords(rule.comparator)} ${formatPct(rule.threshold)}.`;
        }
    } else if (accounts) {
        if (rule.metric === "portfolio_value") {
            observed = accounts.value;
            message = `Your accounts were worth ${formatMoney(observed)} at the ${on} close, ${comparatorWords(rule.comparator)} ${formatMoney(rule.threshold)}.`;
        } else {
            if (accounts.dayChangePct === null) return null;
            observed = accounts.dayChangePct;
            message = `Your accounts moved ${formatPct(observed)} on ${on}, ${comparatorWords(rule.comparator)} ${formatPct(rule.threshold)}.`;
        }
    }
    if (observed === null || !compare(observed, rule.comparator, rule.threshold)) return null;
    return firing(rule, `session:${session}`, observed, message, href);
}

// ---------------------------------------------------------------------------
// Alpha Radar rules
// ---------------------------------------------------------------------------

const ALPHA_RADAR_HREF = "/research?tab=alpha-radar";

function alphaRadarFirings(rule: PlannedRule, input: AlertPlanInput, preferences: AlertPreferences): AlertFiring[] {
    // A rule set to "daily" that already fired today (a rerun) waits for tomorrow.
    if (rule.rearm === "daily" && rule.lastTriggeredAt?.toISOString().slice(0, 10) === input.runDate) return [];
    const since = input.alphaRadarSince && input.alphaRadarSince > rule.createdAt ? input.alphaRadarSince : rule.createdAt;
    const match = buildAlphaRadarOverlapMatcher(input.overlap.get(rule.userId) ?? NO_USER_OVERLAP);
    const notified = input.notified.get(rule.id);
    const delivery = preferences.alphaRadar;
    const matching = input.changes
        .filter((change) => change.createdAt > since && !notified?.has(changeOccurrence(change)))
        .map((change) => observe(change, match))
        .filter(({ change, score, reasons, tickers }) =>
            matchesMetric(rule.metric, change, reasons)
            && compare(score, rule.comparator, rule.threshold)
            && (!delivery.overlapOnly || reasons.length > 0)
            && score >= delivery.minMaterialityScore
            && (delivery.tickerFilters.length === 0 || tickers.some((ticker) => delivery.tickerFilters.includes(ticker)))
            && (delivery.trackedFilerIds.length === 0 || delivery.trackedFilerIds.includes(change.trackedFilerId)))
        .sort((a, b) => b.score - a.score
            || a.change.createdAt.getTime() - b.change.createdAt.getTime()
            || changeKey(a.change).localeCompare(changeKey(b.change)));

    const chosen = rule.rearm === "always" ? matching.slice(0, MAX_CHANGES_PER_RULE) : matching.slice(0, 1);
    return chosen.map((observed) => firing(
        rule,
        changeOccurrence(observed.change),
        observed.score,
        alphaRadarMessage(observed),
        ALPHA_RADAR_HREF,
    ));
}

interface ObservedChange {
    change: AlertableChange;
    /** The stored score with what the user's overlap adds, as Research shows it. */
    score: number;
    reasons: string[];
    /** The change's ticker, or without one the user's tickers its company matched. */
    tickers: string[];
}

function observe(change: AlertableChange, match: ReturnType<typeof buildAlphaRadarOverlapMatcher>): ObservedChange {
    const matched = match({ issuerName: change.issuerName, ticker: change.ticker ?? undefined });
    const relevance = { portfolio: matched.portfolio.length > 0, watchlist: matched.watchlist.length > 0, thesis: matched.thesis.length > 0 };
    const reasons = [
        relevance.portfolio ? "You hold it" : null,
        relevance.watchlist ? "It's on your watchlist" : null,
        relevance.thesis ? "You have a thesis on it" : null,
    ].filter((reason): reason is string => reason !== null);
    const own = change.ticker?.trim().toUpperCase();
    const tickers = own ? [own] : [...new Set([...matched.portfolio, ...matched.watchlist, ...matched.thesis])].sort();
    return { change, score: Math.min(100, change.materialityScore + alphaRadarRelevanceBoost(relevance)), reasons, tickers };
}

function changeKey(change: AlertableChange): string {
    const filing = change.currentFilingId ?? change.priorFilingId ?? "unknown-filing";
    return [change.trackedFilerId, change.reportPeriod, filing, change.cusip, change.changeType].join(":");
}

function changeOccurrence(change: AlertableChange): string {
    return `change:${changeKey(change)}`;
}

function matchesMetric(metric: AlertMetric, change: AlertableChange, reasons: readonly string[]): boolean {
    switch (metric) {
        case "alpha_radar_new_position": return change.changeType === "new";
        case "alpha_radar_exit": return change.changeType === "exited";
        case "alpha_radar_large_add": return change.changeType === "increased";
        case "alpha_radar_large_trim": return change.changeType === "decreased";
        case "alpha_radar_user_overlap": return change.changeType !== "unchanged" && reasons.length > 0;
        default: return false;
    }
}

const CHANGE_VERBS: Record<string, string> = {
    new: "opened a new position in",
    exited: "exited",
    increased: "added to",
    decreased: "trimmed",
    amended: "amended its filing on",
    unchanged: "held",
};

function alphaRadarMessage({ change, score, reasons, tickers }: ObservedChange): string {
    const issuer = tickers.length > 0 ? `${change.issuerName} (${tickers.join(", ")})` : change.issuerName;
    const verb = CHANGE_VERBS[change.changeType] ?? change.changeType;
    const why = reasons.length > 0 ? ` ${reasons.join("; ")}.` : "";
    return `${change.filerName} ${verb} ${issuer} in ${change.reportPeriod}. Materiality ${Math.round(score)}/100.${why}`;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

function firing(rule: PlannedRule, occurrence: string, observedValue: number, message: string, href: string | null): AlertFiring {
    return {
        ruleId: rule.id,
        userId: rule.userId,
        occurrence,
        ruleName: rule.name,
        metric: rule.metric,
        symbol: rule.symbol,
        comparator: rule.comparator,
        threshold: rule.threshold,
        observedValue,
        message,
        href,
    };
}

const COMPARATOR_WORDS: Record<AlertComparator, string> = {
    gte: "at or above",
    gt: "above",
    lte: "at or below",
    lt: "below",
    eq: "at",
};

function comparatorWords(comparator: AlertComparator): string {
    return COMPARATOR_WORDS[comparator];
}

function formatMoney(value: number): string {
    return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(fraction: number): string {
    const pct = fraction * 100;
    const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
    return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

function formatSessionDate(session: string): string {
    return new Date(`${session}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
