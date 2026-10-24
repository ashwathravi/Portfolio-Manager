/**
 * A user's return history for Performance › Returns (launch item i49):
 * their valuation snapshots, turned into a time-weighted return series by
 * holdings-returns.ts, beside the benchmark ETFs' stored closes.
 */

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { portfolios, portfolioSnapshotPositions } from "@/db/schema";
import {
    buildClosesBetweenQuery,
    buildUserSnapshotsQuery,
    STALE_CLOSE_DAYS,
    type StoredClose,
} from "@/lib/portfolio/valuation-snapshots";
import { benchmarkSeries, returnSeries, type ReturnPoint, type SnapshotPositionValue } from "./holdings-returns";
import type { DatedValue } from "./periodSummary";

type Database = typeof db;

/** What returns are compared with: ETFs the nightly ingest keeps prices for. */
export const RETURN_BENCHMARKS = [
    { key: "sp500", label: "S&P 500", symbol: "SPY" },
    { key: "ndx", label: "NASDAQ-100", symbol: "QQQ" },
    { key: "russell", label: "Russell 2000", symbol: "IWM" },
    { key: "dow", label: "Dow Jones", symbol: "DIA" },
] as const;

export interface ReturnAccount {
    id: string;
    name: string;
    /** Snapshot dates recorded for it. */
    days: number;
}

export interface ReturnBenchmark {
    key: string;
    label: string;
    symbol: string;
    values: DatedValue[];
}

export interface ReturnHistory {
    accounts: ReturnAccount[];
    /** The account shown, or null for all accounts together. */
    accountId: string | null;
    /** Whether the user has any snapshot at all, in any account. */
    hasHistory: boolean;
    points: ReturnPoint[];
    /** Benchmarks with a close on every date of `points`. */
    benchmarks: ReturnBenchmark[];
}

/** The user's accounts, by name. */
export function buildUserAccountsQuery(userId: string, database: Pick<Database, "select"> = db) {
    return database
        .select({ id: portfolios.id, name: portfolios.name })
        .from(portfolios)
        .where(eq(portfolios.userId, userId))
        .orderBy(asc(portfolios.name), asc(portfolios.id));
}

/** The positions of a user's snapshots, oldest first; optionally one portfolio. */
export function buildUserSnapshotPositionsQuery(
    userId: string,
    { portfolioId }: { portfolioId?: string } = {},
    database: Pick<Database, "select"> = db,
) {
    return database
        .select({
            portfolioId: portfolioSnapshotPositions.portfolioId,
            date: portfolioSnapshotPositions.date,
            symbol: portfolioSnapshotPositions.symbol,
            marketValue: portfolioSnapshotPositions.marketValue,
        })
        .from(portfolioSnapshotPositions)
        .innerJoin(portfolios, eq(portfolioSnapshotPositions.portfolioId, portfolios.id))
        .where(and(
            eq(portfolios.userId, userId),
            portfolioId ? eq(portfolioSnapshotPositions.portfolioId, portfolioId) : undefined,
        ))
        .orderBy(asc(portfolioSnapshotPositions.date), asc(portfolioSnapshotPositions.portfolioId), asc(portfolioSnapshotPositions.symbol));
}

function minusCalendarDays(date: string, days: number): string {
    const at = new Date(`${date}T12:00:00Z`);
    at.setUTCDate(at.getUTCDate() - days);
    return at.toISOString().slice(0, 10);
}

export interface ReturnHistoryRows {
    accounts: ReadonlyArray<{ id: string; name: string }>;
    /** Every snapshot of the user's, oldest first. */
    snapshots: ReadonlyArray<{ portfolioId: string; date: string; totalValue: number }>;
    /** Positions of the shown account's snapshots (or all of them). */
    positions: ReadonlyArray<{ portfolioId: string; date: string; symbol: string; marketValue: number | null }>;
}

/** Stored closes for `symbols` from `from` to `to`, oldest first per symbol. */
export type ClosesLoader = (symbols: string[], from: string, to: string) => Promise<Map<string, StoredClose[]>>;

/**
 * The return history from the rows read for it: the series of `accountId`
 * if it is one of the accounts, otherwise of all of them together.
 */
export async function buildReturnHistory(
    { accounts, snapshots, positions }: ReturnHistoryRows,
    accountId: string | null | undefined,
    loadCloses: ClosesLoader,
): Promise<ReturnHistory> {
    const selected = accounts.find((account) => account.id === accountId)?.id ?? null;
    const days = new Map<string, number>();
    for (const snapshot of snapshots) days.set(snapshot.portfolioId, (days.get(snapshot.portfolioId) ?? 0) + 1);

    const byKey = new Map<string, { portfolioId: string; date: string; totalValue: number; positions: SnapshotPositionValue[] }>();
    for (const snapshot of snapshots) {
        if (selected && snapshot.portfolioId !== selected) continue;
        byKey.set(`${snapshot.portfolioId}|${snapshot.date}`, {
            portfolioId: snapshot.portfolioId,
            date: snapshot.date,
            totalValue: snapshot.totalValue,
            positions: [],
        });
    }
    const symbols = new Set<string>(RETURN_BENCHMARKS.map((b) => b.symbol));
    for (const position of positions) {
        const snapshot = byKey.get(`${position.portfolioId}|${position.date}`);
        if (!snapshot) continue;
        snapshot.positions.push({ symbol: position.symbol, marketValue: position.marketValue });
        symbols.add(position.symbol);
    }

    const chosen = [...byKey.values()];
    let points: ReturnPoint[] = [];
    let benchmarks: ReturnBenchmark[] = [];
    if (chosen.length > 0) {
        const dates = chosen.map((snapshot) => snapshot.date).sort();
        const closes = await loadCloses([...symbols].sort(), minusCalendarDays(dates[0], STALE_CLOSE_DAYS), dates[dates.length - 1]);
        points = returnSeries(chosen, closes);
        const pointDates = points.map((point) => point.date);
        benchmarks = RETURN_BENCHMARKS.flatMap((benchmark) => {
            const values = benchmarkSeries(pointDates, closes.get(benchmark.symbol));
            return values ? [{ ...benchmark, values }] : [];
        });
    }

    return {
        accounts: accounts.map((account) => ({ id: account.id, name: account.name, days: days.get(account.id) ?? 0 })),
        accountId: selected,
        hasHistory: snapshots.length > 0,
        points,
        benchmarks,
    };
}

/**
 * The user's return history, for one of their accounts or (`accountId`
 * null, unknown or not theirs) all of them together.
 */
export async function loadReturnHistory(
    userId: string,
    { accountId }: { accountId?: string | null } = {},
    database: Database = db,
): Promise<ReturnHistory> {
    // One repeatable-read transaction: a night's snapshot rewrite (totals
    // and positions) is seen whole or not at all.
    const rows = await database.transaction(async (tx) => {
        const accounts = await buildUserAccountsQuery(userId, tx);
        const selected = accounts.find((account) => account.id === accountId)?.id;
        const snapshots = await buildUserSnapshotsQuery(userId, {}, tx);
        const positions = await buildUserSnapshotPositionsQuery(userId, { portfolioId: selected }, tx);
        return { accounts, snapshots, positions };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });

    return buildReturnHistory(rows, accountId, async (symbols, from, to) => {
        const closes = new Map<string, StoredClose[]>();
        for (const row of await buildClosesBetweenQuery(symbols, from, to, database)) {
            const list = closes.get(row.symbol) ?? [];
            list.push({ date: row.date, close: row.close });
            closes.set(row.symbol, list);
        }
        return closes;
    });
}
