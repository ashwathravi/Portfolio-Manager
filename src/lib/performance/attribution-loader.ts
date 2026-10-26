/**
 * A user's attribution history for Performance › Attribution (launch item
 * i50): the steps between their valuation snapshots, split into segments
 * (attribution-history.ts), and the benchmark's estimated sector weights.
 * The page links the steps of the period it shows.
 */

import { db } from "@/db";
import { sectorFor } from "@/lib/holdings/sector";
import { getSecurityProfiles } from "@/lib/markets/price-store";
import type { SecurityProfile } from "@/lib/markets/security-profile";
import { STALE_CLOSE_DAYS } from "@/lib/portfolio/valuation-snapshots";
import {
    benchmarkSectorReturns,
    BENCHMARK_ETF,
    estimateBenchmarkWeights,
    SECTOR_ETFS,
    stepSegments,
    symbolSegments,
    type AttributionStep,
    type BenchmarkWeights,
    type StepSnapshot,
} from "./attribution-history";
import { readHistoryRows, storedClosesLoader, type ClosesLoader, type ReturnAccount, type ReturnHistoryRows } from "./return-history";

type Database = typeof db;

/** How far back the benchmark's weights are estimated from: a year of sessions, with slack. */
export const STYLE_LOOKBACK_DAYS = 400;

export interface AttributionHistory {
    accounts: ReturnAccount[];
    /** The account shown, or null for all accounts together. */
    accountId: string | null;
    /** Whether the user has any snapshot at all, in any account. */
    hasHistory: boolean;
    /** Snapshot dates of the account shown, oldest first. */
    dates: string[];
    steps: AttributionStep[];
    /** The S&P 500's sector weights, estimated from prices; null until there are enough. */
    benchmark: BenchmarkWeights | null;
}

export type ProfilesLoader = (symbols: Iterable<string>) => Promise<Map<string, SecurityProfile>>;

function minusCalendarDays(date: string, days: number): string {
    const at = new Date(`${date}T12:00:00Z`);
    at.setUTCDate(at.getUTCDate() - days);
    return at.toISOString().slice(0, 10);
}

/**
 * The attribution history from the rows read for it: steps for `accountId`
 * if it is one of the accounts, otherwise for all of them together.
 */
export async function buildAttributionHistory(
    { accounts, snapshots, positions }: ReturnHistoryRows,
    accountId: string | null | undefined,
    loadCloses: ClosesLoader,
    loadProfiles: ProfilesLoader,
): Promise<AttributionHistory> {
    const selected = accounts.find((account) => account.id === accountId)?.id ?? null;
    const days = new Map<string, number>();
    for (const snapshot of snapshots) days.set(snapshot.portfolioId, (days.get(snapshot.portfolioId) ?? 0) + 1);

    const byKey = new Map<string, { date: string; totalValue: number; positions: Array<{ symbol: string; marketValue: number | null }> }>();
    for (const snapshot of snapshots) {
        if (selected && snapshot.portfolioId !== selected) continue;
        byKey.set(`${snapshot.portfolioId}|${snapshot.date}`, { date: snapshot.date, totalValue: snapshot.totalValue, positions: [] });
    }
    const held = new Set<string>();
    for (const position of positions) {
        const snapshot = byKey.get(`${position.portfolioId}|${position.date}`);
        if (!snapshot) continue;
        snapshot.positions.push({ symbol: position.symbol, marketValue: position.marketValue });
        held.add(position.symbol);
    }
    const byDate = new Map<string, StepSnapshot[]>();
    for (const snapshot of byKey.values()) {
        const list = byDate.get(snapshot.date) ?? [];
        list.push(snapshot);
        byDate.set(snapshot.date, list);
    }
    const dates = [...byDate.keys()].sort();

    let steps: AttributionStep[] = [];
    let benchmark: BenchmarkWeights | null = null;
    if (dates.length >= 2) {
        const last = dates[dates.length - 1];
        // From a week before the earlier of the first snapshot and the
        // benchmark estimate's year: closes may be up to a week old.
        const lookback = minusCalendarDays(last, STYLE_LOOKBACK_DAYS);
        const from = minusCalendarDays(dates[0] < lookback ? dates[0] : lookback, STALE_CLOSE_DAYS);
        const [closes, profiles] = await Promise.all([
            loadCloses([...new Set([...held, BENCHMARK_ETF, ...SECTOR_ETFS])].sort(), from, last),
            loadProfiles(held),
        ]);
        const spyDates = (closes.get(BENCHMARK_ETF) ?? []).map((c) => c.date).filter((date) => date >= lookback);
        benchmark = estimateBenchmarkWeights(spyDates, closes);
        const segmentsOf = (symbol: string) => symbolSegments(profiles.get(symbol.toUpperCase()), sectorFor(symbol));
        for (let i = 1; i < dates.length; i++) {
            const segments = stepSegments(byDate.get(dates[i - 1]) ?? [], dates[i], closes, segmentsOf);
            if (!segments) continue;
            steps.push({
                from: dates[i - 1],
                to: dates[i],
                ...segments,
                benchmarkSectorReturns: benchmark ? benchmarkSectorReturns(dates[i - 1], dates[i], closes, benchmark.etfs) : null,
            });
        }
    }
    if (!benchmark) steps = steps.map((step) => ({ ...step, benchmarkSectorReturns: null }));

    return {
        accounts: accounts.map((account) => ({ id: account.id, name: account.name, days: days.get(account.id) ?? 0 })),
        accountId: selected,
        hasHistory: snapshots.length > 0,
        dates,
        steps,
        benchmark,
    };
}

/**
 * The user's attribution history, for one of their accounts or (`accountId`
 * null, unknown or not theirs) all of them together.
 */
export async function loadAttributionHistory(
    userId: string,
    { accountId }: { accountId?: string | null } = {},
    database: Database = db,
): Promise<AttributionHistory> {
    return buildAttributionHistory(
        await readHistoryRows(userId, accountId, database),
        accountId,
        storedClosesLoader(database),
        (symbols) => getSecurityProfiles(symbols, database),
    );
}
