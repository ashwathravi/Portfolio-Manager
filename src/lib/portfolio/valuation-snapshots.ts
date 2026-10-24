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
 * value and listed as `unpriced`. One valued at an earlier day's close (the
 * session's own is missing) is provisional. Either way the snapshot isn't
 * complete and is recomputed on later runs, so a close that arrives late
 * (a new symbol's history, a recovered bar) replaces the stand-in.
 *
 * Stored closes are split-adjusted, so a holding must be on the same share
 * scale: snapshots wait until the latest price run has reconciled held
 * positions with splits through the newest stored close (`holdingSplits` in
 * its job_runs detail). A portfolio still holding a position from before a
 * split that couldn't be applied (`unadjusted`) is skipped until it is
 * re-imported. Values are in dollars, so adjusted pairs of quantity and
 * close value the same.
 *
 * The state is read in one repeatable-read transaction, so an import that
 * commits mid-run is either entirely seen or entirely not. Writes to a
 * portfolio or its holdings must bump updated_at for the last-change rule to
 * hold (importHoldings does).
 */

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { holdings, jobRuns, portfolios, portfolioSnapshotPositions, portfolioSnapshots, priceBars } from "@/db/schema";
import { splitTakesEffectAt } from "@/lib/portfolio/split-adjustments";
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
    /** When the holding last changed (split readiness compares it with split dates). */
    updatedAt?: Date;
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
export function buildPortfolioStatesQuery(database: Pick<Database, "select"> = db) {
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

/** Every holding (the job values all portfolios). */
export function buildPositionsQuery(database: Pick<Database, "select"> = db) {
    return database
        .select({
            portfolioId: holdings.portfolioId,
            symbol: holdings.symbol,
            quantity: holdings.quantity,
            avgCost: holdings.avgCost,
            updatedAt: holdings.updatedAt,
        })
        .from(holdings);
}

export function buildClosesBetweenQuery(symbols: string[], from: string, to: string, database: Database = db) {
    return database
        .select({ symbol: priceBars.symbol, date: priceBars.date, close: priceBars.close })
        .from(priceBars)
        .where(and(inArray(priceBars.symbol, symbols), gte(priceBars.date, from), lte(priceBars.date, to)))
        .orderBy(asc(priceBars.symbol), asc(priceBars.date));
}

/**
 * Sessions from `from` on that already have a complete snapshot: every
 * position priced, at that session's own close. One valued at an earlier
 * close is provisional and is recomputed.
 */
export function buildCompleteDaysQuery(portfolioIds: string[], from: string, database: Database = db) {
    return database
        .select({ portfolioId: portfolioSnapshots.portfolioId, date: portfolioSnapshots.date })
        .from(portfolioSnapshots)
        .where(and(
            inArray(portfolioSnapshots.portfolioId, portfolioIds),
            gte(portfolioSnapshots.date, from),
            sql`cardinality(${portfolioSnapshots.unpriced}) = 0`,
            sql`not exists (select 1 from ${portfolioSnapshotPositions} where ${portfolioSnapshotPositions.portfolioId} = ${portfolioSnapshots.portfolioId} and ${portfolioSnapshotPositions.date} = ${portfolioSnapshots.date} and ${portfolioSnapshotPositions.closeDate} is distinct from ${portfolioSnapshots.date})`,
        ));
}

/** The newest successful price run that checked held positions against splits. */
export function buildLatestHoldingSplitsQuery(database: Database = db) {
    return database
        .select({ holdingSplits: sql<unknown>`${jobRuns.detail} -> 'holdingSplits'` })
        .from(jobRuns)
        .where(and(eq(jobRuns.job, "prices"), eq(jobRuns.status, "succeeded"), sql`${jobRuns.detail} ? 'holdingSplits'`))
        .orderBy(desc(jobRuns.startedAt))
        .limit(1);
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

/**
 * Whether held positions are on the same split scale as the stored closes
 * through `latest`, from the latest price run's `holdingSplits` detail
 * (price-ingest.ts). Ready when that check succeeded through `latest`, or
 * had nothing to check; its `unadjusted` splits come back so the portfolios
 * still holding a position from before one can wait.
 */
export type SplitReadiness =
    | { ready: true; unadjusted: Array<{ symbol: string; executionDate: string | null }> }
    | { ready: false; reason: string };

export function splitReadiness(holdingSplits: unknown, latest: string): SplitReadiness {
    if (!holdingSplits || typeof holdingSplits !== "object") {
        return { ready: false, reason: "held positions haven't been checked against splits yet" };
    }
    const check = holdingSplits as { to?: unknown; skipped?: unknown; unadjusted?: unknown };
    if (typeof check.skipped === "string") {
        return check.skipped === "nothing held" || check.skipped === "up to date"
            ? { ready: true, unadjusted: [] }
            : { ready: false, reason: `the holdings split check didn't run: ${check.skipped}` };
    }
    if (typeof check.to !== "string" || check.to < latest) {
        return { ready: false, reason: "held positions haven't been checked against splits through the latest close" };
    }
    const unadjusted = Array.isArray(check.unadjusted)
        ? check.unadjusted.flatMap((entry: unknown) => {
            // An entry without a date (an older run's format) holds back every position in the stock.
            if (typeof entry === "string") return [{ symbol: entry.toUpperCase(), executionDate: null }];
            const split = entry as { symbol?: unknown; executionDate?: unknown } | null;
            return split && typeof split.symbol === "string"
                ? [{ symbol: split.symbol.toUpperCase(), executionDate: typeof split.executionDate === "string" ? split.executionDate : null }]
                : [];
        })
        : [];
    return { ready: true, unadjusted };
}

/** A position still on the old share scale: last updated before a split that couldn't be applied. */
export function awaitsSplit(
    position: PositionInput,
    unadjusted: ReadonlyArray<{ symbol: string; executionDate: string | null }>,
): boolean {
    const symbol = position.symbol.trim().toUpperCase();
    return unadjusted.some((split) =>
        split.symbol === symbol
        && (split.executionDate === null
            || !position.updatedAt
            || position.updatedAt.getTime() < splitTakesEffectAt(split.executionDate).getTime()));
}

/** The database calls the job makes; Postgres in production, a fake in tests. */
export interface SnapshotStore {
    latestCloseDate(): Promise<string | null>;
    /** The latest successful price run's `holdingSplits` detail, or undefined. */
    latestHoldingSplits(): Promise<unknown>;
    /** Every portfolio with its cash, last change and positions, read as one consistent snapshot. */
    portfolios(): Promise<Array<{ portfolioId: string; cash: number; lastChange: Date; positions: PositionInput[] }>>;
    closes(symbols: string[], from: string, to: string): Promise<Map<string, StoredClose[]>>;
    completeDays(portfolioIds: string[], from: string): Promise<Map<string, Set<string>>>;
    write(portfolioId: string, snapshots: readonly SnapshotValue[]): Promise<void>;
}

export function createSnapshotStore(database: Database = db): SnapshotStore {
    return {
        latestCloseDate: () => getLatestBarDate(database),
        async latestHoldingSplits() {
            const [row] = await buildLatestHoldingSplitsQuery(database);
            return row?.holdingSplits ?? undefined;
        },
        // One repeatable-read transaction: an import committing meanwhile is
        // seen whole (new holdings and the timestamp that guards them) or not at all.
        portfolios: () => database.transaction(async (tx) => {
            const states = await buildPortfolioStatesQuery(tx);
            const byPortfolio = new Map<string, PositionInput[]>();
            for (const row of await buildPositionsQuery(tx)) {
                const list = byPortfolio.get(row.portfolioId) ?? [];
                list.push({ symbol: row.symbol, quantity: Number(row.quantity), avgCost: Number(row.avgCost), updatedAt: row.updatedAt });
                byPortfolio.set(row.portfolioId, list);
            }
            return states.map((state) => ({
                portfolioId: state.portfolioId,
                cash: state.cash ?? 0,
                lastChange: state.lastChange,
                positions: byPortfolio.get(state.portfolioId) ?? [],
            }));
        }, { isolationLevel: "repeatable read", accessMode: "read only" }),
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
        /** Snapshots written (new days, and incomplete ones recomputed). */
        written: number;
        /** Of those, how many have unpriced holdings. */
        partial: number;
        /** Of those, how many value a holding at an earlier day's close (recomputed later). */
        provisional: number;
        /** Portfolios that changed after the latest close: nothing to record until the next session. */
        changedSinceClose: number;
        /** Portfolios holding a position from before a split that couldn't be applied: re-import them. */
        waitingForSplits: number;
    };

/** Records every portfolio's missing or incomplete snapshots; see the module comment. */
export async function recordValuationSnapshots({
    store = createSnapshotStore(),
    max = MAX_SNAPSHOT_DAYS,
}: { store?: SnapshotStore; max?: number } = {}): Promise<SnapshotJobDetail> {
    const latest = await store.latestCloseDate();
    if (!latest) return { skipped: "no closes stored yet" };
    // Nothing is written until positions and closes are on the same split
    // scale; the days are filled in by the first run where they are.
    const readiness = splitReadiness(await store.latestHoldingSplits(), latest);
    if (!readiness.ready) return { skipped: readiness.reason };

    const all = await store.portfolios();
    const empty = { latest, portfolios: all.length, written: 0, partial: 0, provisional: 0, changedSinceClose: 0, waitingForSplits: 0 };
    if (all.length === 0) return empty;

    const waiting = all.filter((portfolio) => portfolio.positions.some((position) => awaitsSplit(position, readiness.unadjusted)));
    const ready = all.filter((portfolio) => !waiting.includes(portfolio));
    const from = windowStart(latest, max);
    const complete = await store.completeDays(ready.map((portfolio) => portfolio.portfolioId), from);
    const plans = ready.map((portfolio) => ({
        ...portfolio,
        days: snapshotDays({ latest, lastChange: portfolio.lastChange, complete: complete.get(portfolio.portfolioId) ?? new Set(), max }),
    }));
    const changedSinceClose = plans.filter((plan) => sessionClosedAt(latest).getTime() < plan.lastChange.getTime()).length;
    const due = plans.filter((plan) => plan.days.length > 0);
    if (due.length === 0) return { ...empty, changedSinceClose, waitingForSplits: waiting.length };

    const symbols = [...new Set(due.flatMap((plan) => plan.positions.map((position) => position.symbol.trim().toUpperCase())))].sort();
    const earliest = due.map((plan) => plan.days[0]).sort()[0];
    const closes = await store.closes(symbols, minusCalendarDays(earliest, STALE_CLOSE_DAYS), latest);

    let written = 0;
    let partial = 0;
    let provisional = 0;
    for (const plan of due) {
        const snapshots = plan.days.map((day) => valueSnapshot(day, plan.positions, closes, plan.cash));
        await store.write(plan.portfolioId, snapshots);
        written += snapshots.length;
        partial += snapshots.filter((snapshot) => snapshot.unpriced.length > 0).length;
        provisional += snapshots.filter((snapshot) =>
            snapshot.positions.some((position) => position.closeDate !== null && position.closeDate !== snapshot.date)).length;
    }
    return { latest, portfolios: all.length, written, partial, provisional, changedSinceClose, waitingForSplits: waiting.length };
}
