/**
 * Valuation snapshots (launch item i42): each portfolio's value at a
 * session's close, holdings × close + cash, recorded nightly by the
 * "snapshots" job after the price ingest.
 *
 * A snapshot for day D is written only while nothing in the portfolio has
 * changed since D's close (no import, edit or cash change: the portfolio's
 * and its holdings' created_at/updated_at are all earlier). Today's holdings
 * are then exactly what it held at that close, so the snapshot is a true
 * record, and missed days can be filled in from stored closes, back to the
 * last change and at most MAX_SNAPSHOT_DAYS. A day after which the portfolio
 * changed gets no snapshot; nothing records what it held then.
 *
 * A holding without a close at most STALE_CLOSE_DAYS old is left out of the
 * value and listed as `unpriced`; such a partial snapshot is recomputed on
 * later runs (a new symbol's history usually arrives a night later). Values
 * are in dollars, so price-store split adjustments don't change them.
 *
 * Writes to a portfolio or its holdings must bump updated_at for this rule
 * to hold (importHoldings does).
 */

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { holdings, portfolios, portfolioSnapshotPositions, portfolioSnapshots, priceBars } from "@/db/schema";
import { previousTradingDay } from "@/lib/markets/market-hours";
import { getLatestBarDate } from "@/lib/markets/price-store";
import { sessionCloseTime } from "@/lib/markets/stored-quote-provider";

type Database = typeof db;

/** How many trading days back from the newest stored close a run fills or recomputes. */
export const MAX_SNAPSHOT_DAYS = 260;
/** A close older than this, in calendar days before the session, counts as no price. */
export const STALE_CLOSE_DAYS = 7;
const WRITE_CHUNK = 500;

export interface PositionInput {
    symbol: string;
    quantity: number;
    avgCost: number;
}

export interface StoredClose {
    date: string;
    close: number;
}

export interface SnapshotPosition {
    symbol: string;
    quantity: number;
    costBasis: number;
    close: number | null;
    closeDate: string | null;
    marketValue: number | null;
}

export interface SnapshotValue {
    date: string;
    holdingsValue: number;
    cash: number;
    totalValue: number;
    costBasis: number;
    positions: SnapshotPosition[];
    unpriced: string[];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** When a session's close happened (4:00 PM ET, 1:00 PM on early-close days). */
export function sessionClosedAt(date: string): Date {
    return new Date(sessionCloseTime(date));
}

function minusCalendarDays(date: string, days: number): string {
    const at = new Date(`${date}T12:00:00Z`);
    at.setUTCDate(at.getUTCDate() - days);
    return at.toISOString().slice(0, 10);
}

/** The trading day `count - 1` sessions before `latest`: the start of a window of `count` sessions. */
export function windowStart(latest: string, count: number = MAX_SNAPSHOT_DAYS): string {
    let day = latest;
    for (let i = 1; i < count; i++) {
        try {
            day = previousTradingDay(day);
        } catch {
            break; // before the calendar's first year
        }
    }
    return day;
}

/**
 * The sessions to (re)compute for a portfolio, oldest first: back from
 * `latest` while the portfolio hasn't changed since the session's close, at
 * most `max` sessions, leaving out those with a complete snapshot already.
 */
export function snapshotDays({
    latest,
    lastChange,
    complete,
    max = MAX_SNAPSHOT_DAYS,
}: {
    latest: string;
    lastChange: Date;
    complete: ReadonlySet<string>;
    max?: number;
}): string[] {
    const days: string[] = [];
    let day = latest;
    for (let seen = 0; seen < max; seen++) {
        if (sessionClosedAt(day).getTime() < lastChange.getTime()) break;
        if (!complete.has(day)) days.push(day);
        try {
            day = previousTradingDay(day);
        } catch {
            break;
        }
    }
    return days.reverse();
}

/**
 * A portfolio's value at `date`'s close. Holdings of one symbol are combined;
 * zero-quantity rows are ignored. Each symbol is valued at its last close on
 * or before `date`, if that is at most STALE_CLOSE_DAYS old; otherwise it is
 * unpriced (its cost basis still counts, its value doesn't).
 */
export function valueSnapshot(
    date: string,
    positions: readonly PositionInput[],
    closes: ReadonlyMap<string, readonly StoredClose[]>,
    cash: number,
): SnapshotValue {
    const bySymbol = new Map<string, { quantity: number; costBasis: number }>();
    for (const position of positions) {
        if (!Number.isFinite(position.quantity) || position.quantity === 0) continue;
        const symbol = position.symbol.trim().toUpperCase();
        const current = bySymbol.get(symbol) ?? { quantity: 0, costBasis: 0 };
        current.quantity += position.quantity;
        current.costBasis += position.quantity * (Number.isFinite(position.avgCost) ? position.avgCost : 0);
        bySymbol.set(symbol, current);
    }

    const oldest = minusCalendarDays(date, STALE_CLOSE_DAYS);
    const rows: SnapshotPosition[] = [];
    const unpriced: string[] = [];
    let holdingsValue = 0;
    let costBasis = 0;
    for (const [symbol, { quantity, costBasis: cost }] of [...bySymbol].sort(([a], [b]) => a.localeCompare(b))) {
        let found: StoredClose | undefined;
        for (const bar of closes.get(symbol) ?? []) {
            if (bar.date > date) break;
            found = bar;
        }
        const priced = found && found.date >= oldest && found.close > 0 ? found : undefined;
        const marketValue = priced ? quantity * priced.close : null;
        if (marketValue === null) unpriced.push(symbol);
        else holdingsValue += marketValue;
        costBasis += cost;
        rows.push({
            symbol,
            quantity,
            costBasis: cost,
            close: priced?.close ?? null,
            closeDate: priced?.date ?? null,
            marketValue,
        });
    }
    const safeCash = Number.isFinite(cash) ? cash : 0;
    return { date, holdingsValue, cash: safeCash, totalValue: holdingsValue + safeCash, costBasis, positions: rows, unpriced };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

/**
 * Every portfolio, its cash, and when it or any of its holdings last
 * changed. Deliberately not user-scoped: the nightly job values every
 * portfolio and returns nothing to a user.
 */
export function buildPortfolioStatesQuery(database: Database = db) {
    return database
        .select({
            portfolioId: portfolios.id,
            cash: portfolios.cashBalance,
            // greatest() skips nulls, so a portfolio without holdings uses its own times.
            lastChange: sql<Date>`greatest(${portfolios.createdAt}, ${portfolios.updatedAt}, max(${holdings.createdAt}), max(${holdings.updatedAt}))`
                .mapWith(portfolios.updatedAt),
        })
        .from(portfolios)
        .leftJoin(holdings, eq(holdings.portfolioId, portfolios.id))
        .groupBy(portfolios.id);
}

export function buildPositionsQuery(portfolioIds: string[], database: Database = db) {
    return database
        .select({ portfolioId: holdings.portfolioId, symbol: holdings.symbol, quantity: holdings.quantity, avgCost: holdings.avgCost })
        .from(holdings)
        .where(inArray(holdings.portfolioId, portfolioIds));
}

export function buildClosesBetweenQuery(symbols: string[], from: string, to: string, database: Database = db) {
    return database
        .select({ symbol: priceBars.symbol, date: priceBars.date, close: priceBars.close })
        .from(priceBars)
        .where(and(inArray(priceBars.symbol, symbols), gte(priceBars.date, from), lte(priceBars.date, to)))
        .orderBy(asc(priceBars.symbol), asc(priceBars.date));
}

/** Sessions from `from` on that already have a complete (fully priced) snapshot. */
export function buildCompleteDaysQuery(portfolioIds: string[], from: string, database: Database = db) {
    return database
        .select({ portfolioId: portfolioSnapshots.portfolioId, date: portfolioSnapshots.date })
        .from(portfolioSnapshots)
        .where(and(
            inArray(portfolioSnapshots.portfolioId, portfolioIds),
            gte(portfolioSnapshots.date, from),
            sql`cardinality(${portfolioSnapshots.unpriced}) = 0`,
        ));
}

export function buildUpsertSnapshotsQuery(portfolioId: string, snapshots: readonly SnapshotValue[], database: Pick<Database, "insert"> = db) {
    const now = new Date();
    return database
        .insert(portfolioSnapshots)
        .values(snapshots.map((snapshot) => ({
            portfolioId,
            date: snapshot.date,
            holdingsValue: snapshot.holdingsValue,
            cash: snapshot.cash,
            totalValue: snapshot.totalValue,
            costBasis: snapshot.costBasis,
            positions: snapshot.positions.length,
            unpriced: snapshot.unpriced,
            updatedAt: now,
        })))
        .onConflictDoUpdate({
            target: [portfolioSnapshots.portfolioId, portfolioSnapshots.date],
            set: {
                holdingsValue: sql`excluded.holdings_value`,
                cash: sql`excluded.cash`,
                totalValue: sql`excluded.total_value`,
                costBasis: sql`excluded.cost_basis`,
                positions: sql`excluded.positions`,
                unpriced: sql`excluded.unpriced`,
                updatedAt: sql`excluded.updated_at`,
            },
        });
}

/**
 * Writes a portfolio's snapshots and their positions in one transaction:
 * a recomputed day's positions replace the old ones.
 */
export async function writeSnapshots(portfolioId: string, snapshots: readonly SnapshotValue[], database: Database = db): Promise<void> {
    if (snapshots.length === 0) return;
    await database.transaction(async (tx) => {
        for (let start = 0; start < snapshots.length; start += WRITE_CHUNK) {
            const chunk = snapshots.slice(start, start + WRITE_CHUNK);
            await buildUpsertSnapshotsQuery(portfolioId, chunk, tx);
            await tx.delete(portfolioSnapshotPositions).where(and(
                eq(portfolioSnapshotPositions.portfolioId, portfolioId),
                inArray(portfolioSnapshotPositions.date, chunk.map((snapshot) => snapshot.date)),
            ));
        }
        const rows = snapshots.flatMap((snapshot) => snapshot.positions.map((position) => ({
            portfolioId,
            date: snapshot.date,
            symbol: position.symbol,
            quantity: String(position.quantity),
            costBasis: position.costBasis,
            close: position.close,
            closeDate: position.closeDate,
            marketValue: position.marketValue,
        })));
        for (let start = 0; start < rows.length; start += WRITE_CHUNK) {
            await tx.insert(portfolioSnapshotPositions).values(rows.slice(start, start + WRITE_CHUNK));
        }
    });
}

/** A user's snapshots, oldest first; optionally one portfolio and a date range. */
export function buildUserSnapshotsQuery(
    userId: string,
    { portfolioId, from, to }: { portfolioId?: string; from?: string; to?: string } = {},
    database: Database = db,
) {
    return database
        .select({
            portfolioId: portfolioSnapshots.portfolioId,
            date: portfolioSnapshots.date,
            holdingsValue: portfolioSnapshots.holdingsValue,
            cash: portfolioSnapshots.cash,
            totalValue: portfolioSnapshots.totalValue,
            costBasis: portfolioSnapshots.costBasis,
            positions: portfolioSnapshots.positions,
            unpriced: portfolioSnapshots.unpriced,
        })
        .from(portfolioSnapshots)
        .innerJoin(portfolios, eq(portfolioSnapshots.portfolioId, portfolios.id))
        .where(and(
            eq(portfolios.userId, userId),
            portfolioId ? eq(portfolioSnapshots.portfolioId, portfolioId) : undefined,
            from ? gte(portfolioSnapshots.date, from) : undefined,
            to ? lte(portfolioSnapshots.date, to) : undefined,
        ))
        .orderBy(asc(portfolioSnapshots.date), asc(portfolioSnapshots.portfolioId));
}

export async function listUserSnapshots(
    userId: string,
    options: { portfolioId?: string; from?: string; to?: string } = {},
    database: Database = db,
) {
    return buildUserSnapshotsQuery(userId, options, database);
}

// ---------------------------------------------------------------------------
// The nightly job
// ---------------------------------------------------------------------------

/** The database calls the job makes; Postgres in production, a fake in tests. */
export interface SnapshotStore {
    latestCloseDate(): Promise<string | null>;
    portfolioStates(): Promise<Array<{ portfolioId: string; cash: number; lastChange: Date }>>;
    positions(portfolioIds: string[]): Promise<Map<string, PositionInput[]>>;
    closes(symbols: string[], from: string, to: string): Promise<Map<string, StoredClose[]>>;
    completeDays(portfolioIds: string[], from: string): Promise<Map<string, Set<string>>>;
    write(portfolioId: string, snapshots: readonly SnapshotValue[]): Promise<void>;
}

export function createSnapshotStore(database: Database = db): SnapshotStore {
    return {
        latestCloseDate: () => getLatestBarDate(database),
        async portfolioStates() {
            return (await buildPortfolioStatesQuery(database)).map((row) => ({
                portfolioId: row.portfolioId,
                cash: row.cash ?? 0,
                lastChange: row.lastChange,
            }));
        },
        async positions(portfolioIds) {
            const byPortfolio = new Map<string, PositionInput[]>();
            if (portfolioIds.length === 0) return byPortfolio;
            for (const row of await buildPositionsQuery(portfolioIds, database)) {
                const list = byPortfolio.get(row.portfolioId) ?? [];
                list.push({ symbol: row.symbol, quantity: Number(row.quantity), avgCost: Number(row.avgCost) });
                byPortfolio.set(row.portfolioId, list);
            }
            return byPortfolio;
        },
        async closes(symbols, from, to) {
            const bySymbol = new Map<string, StoredClose[]>();
            if (symbols.length === 0) return bySymbol;
            for (const row of await buildClosesBetweenQuery(symbols, from, to, database)) {
                const list = bySymbol.get(row.symbol) ?? [];
                list.push({ date: row.date, close: row.close });
                bySymbol.set(row.symbol, list);
            }
            return bySymbol;
        },
        async completeDays(portfolioIds, from) {
            const byPortfolio = new Map<string, Set<string>>();
            if (portfolioIds.length === 0) return byPortfolio;
            for (const row of await buildCompleteDaysQuery(portfolioIds, from, database)) {
                const days = byPortfolio.get(row.portfolioId) ?? new Set<string>();
                days.add(row.date);
                byPortfolio.set(row.portfolioId, days);
            }
            return byPortfolio;
        },
        write: (portfolioId, snapshots) => writeSnapshots(portfolioId, snapshots, database),
    };
}

export type SnapshotJobDetail =
    | { skipped: string }
    | {
        /** The newest stored close: the latest session a snapshot can be valued at. */
        latest: string;
        portfolios: number;
        /** Snapshots written (new days, and partial ones recomputed). */
        written: number;
        /** Of those, how many still have unpriced holdings. */
        partial: number;
        /** Portfolios that changed after the latest close: nothing to record until the next session. */
        changedSinceClose: number;
    };

/** Records every portfolio's missing or partial snapshots; see the module comment. */
export async function recordValuationSnapshots({
    store = createSnapshotStore(),
    max = MAX_SNAPSHOT_DAYS,
}: { store?: SnapshotStore; max?: number } = {}): Promise<SnapshotJobDetail> {
    const latest = await store.latestCloseDate();
    if (!latest) return { skipped: "no closes stored yet" };
    const states = await store.portfolioStates();
    if (states.length === 0) return { latest, portfolios: 0, written: 0, partial: 0, changedSinceClose: 0 };

    const from = windowStart(latest, max);
    const complete = await store.completeDays(states.map((state) => state.portfolioId), from);
    const plans = states.map((state) => ({
        ...state,
        days: snapshotDays({ latest, lastChange: state.lastChange, complete: complete.get(state.portfolioId) ?? new Set(), max }),
    }));
    const changedSinceClose = plans.filter((plan) => sessionClosedAt(latest).getTime() < plan.lastChange.getTime()).length;
    const due = plans.filter((plan) => plan.days.length > 0);
    if (due.length === 0) return { latest, portfolios: states.length, written: 0, partial: 0, changedSinceClose };

    const positions = await store.positions(due.map((plan) => plan.portfolioId));
    const symbols = [...new Set([...positions.values()].flat().map((position) => position.symbol.trim().toUpperCase()))].sort();
    const earliest = due.map((plan) => plan.days[0]).sort()[0];
    const closes = await store.closes(symbols, minusCalendarDays(earliest, STALE_CLOSE_DAYS), latest);

    let written = 0;
    let partial = 0;
    for (const plan of due) {
        const held = positions.get(plan.portfolioId) ?? [];
        const snapshots = plan.days.map((day) => valueSnapshot(day, held, closes, plan.cash));
        await store.write(plan.portfolioId, snapshots);
        written += snapshots.length;
        partial += snapshots.filter((snapshot) => snapshot.unpriced.length > 0).length;
    }
    return { latest, portfolios: states.length, written, partial, changedSinceClose };
}
