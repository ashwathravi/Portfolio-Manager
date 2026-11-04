/**
 * Strategies in the database (launch item i55): the user's own, each with
 * its definition, discipline rules and last backtest. Every read and write
 * is scoped to the user, whose ID the API routes take from the session;
 * another user's strategy reads as missing.
 *
 * Saving a strategy also starts tracking its tickers in the price store, so
 * the nightly price job fetches their history (two years, a few tickers a
 * night) and the next backtest can use them.
 */

import { and, asc, count, eq, gte, inArray, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { priceBars, strategies } from "@/db/schema";
import { trackRequestedSecurities } from "@/lib/markets/price-store";
import type { StrategyInput } from "@/lib/validators/strategy";

import { BENCHMARK_SYMBOL, runBacktest, type BacktestBar, type BacktestOutcome } from "./backtest";
import { STRATEGY_LIMITS, type Strategy } from "./strategy";

type Database = typeof db;
type StrategyRow = typeof strategies.$inferSelect;

/** Bars read for a backtest: a little over the two years the price store keeps. */
const HISTORY_DAYS = 800;

export class StrategyLimitError extends Error {
    constructor() {
        super(`At most ${STRATEGY_LIMITS.perUser} strategies`);
        this.name = "StrategyLimitError";
    }
}

export function strategyFromRow(row: StrategyRow): Strategy {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        ...row.definition,
        adherenceRules: row.adherenceRules,
        backtest: row.backtest ?? null,
    };
}

export function buildUserStrategiesQuery(userId: string, database: Pick<Database, "select"> = db) {
    return database.select().from(strategies).where(eq(strategies.userId, userId)).orderBy(asc(strategies.createdAt), asc(strategies.id));
}

export async function loadUserStrategies(userId: string, database: Pick<Database, "select"> = db): Promise<Strategy[]> {
    return (await buildUserStrategiesQuery(userId, database)).map(strategyFromRow);
}

const userLock = (userId: string) => sql`select pg_advisory_xact_lock(hashtext(${`atlas:strategies:${userId}`}))`;

export async function createStrategy(userId: string, input: StrategyInput, database: Database = db): Promise<Strategy> {
    const row = await database.transaction(async (tx) => {
        await tx.execute(userLock(userId));
        const [existing] = await tx.select({ n: count() }).from(strategies).where(eq(strategies.userId, userId));
        if (Number(existing?.n ?? 0) >= STRATEGY_LIMITS.perUser) throw new StrategyLimitError();
        const [inserted] = await tx.insert(strategies).values({
            userId,
            name: input.name,
            description: input.description,
            definition: input.definition,
            adherenceRules: input.adherenceRules,
        }).returning();
        return inserted;
    });
    await trackSymbols(input.definition.symbols, database);
    return strategyFromRow(row);
}

/**
 * Replaces the strategy's name, description, definition and discipline
 * rules; its backtest stays. A save that carries its page's order is
 * skipped when the same page already saved a later one (a save sent as the
 * page closes can overtake an older one still on its way); the strategy
 * is returned as it stands either way. Null when the user has no such
 * strategy.
 */
export async function updateStrategy(userId: string, id: string, input: StrategyInput, database: Database = db): Promise<Strategy | null> {
    const { order } = input;
    const mine = and(eq(strategies.id, id), eq(strategies.userId, userId));
    const newer = order
        ? or(sql`${strategies.writeSession} is distinct from ${order.session}`, sql`${strategies.writeSeq} < ${order.seq}`)
        : undefined;
    const [row] = await database.update(strategies).set({
        name: input.name,
        description: input.description,
        definition: input.definition,
        adherenceRules: input.adherenceRules,
        writeSession: order?.session ?? null,
        writeSeq: order?.seq ?? null,
        updatedAt: new Date(),
    }).where(and(mine, newer)).returning();
    if (row) {
        await trackSymbols(input.definition.symbols, database);
        return strategyFromRow(row);
    }
    const [current] = await database.select().from(strategies).where(mine);
    return current ? strategyFromRow(current) : null;
}

export async function deleteStrategy(userId: string, id: string, database: Database = db): Promise<boolean> {
    const rows = await database.delete(strategies)
        .where(and(eq(strategies.id, id), eq(strategies.userId, userId)))
        .returning({ id: strategies.id });
    return rows.length > 0;
}

/** Tracking is a courtesy for the next backtest: a full price store doesn't fail the save. */
async function trackSymbols(symbols: readonly string[], database: Database) {
    try {
        await trackRequestedSecurities(symbols, undefined, database);
    } catch (err) {
        console.warn("Could not track a strategy's tickers:", err instanceof Error ? err.message : err);
    }
}

export function buildStrategyBarsQuery(symbols: readonly string[], from: string, to: string, database: Pick<Database, "select"> = db) {
    return database
        .select({
            symbol: priceBars.symbol,
            date: priceBars.date,
            open: priceBars.open,
            high: priceBars.high,
            low: priceBars.low,
            close: priceBars.close,
            volume: priceBars.volume,
        })
        .from(priceBars)
        .where(and(inArray(priceBars.symbol, [...symbols]), gte(priceBars.date, from), lte(priceBars.date, to)))
        .orderBy(asc(priceBars.symbol), asc(priceBars.date));
}

/**
 * Runs the saved strategy's backtest over the stored bars and keeps the
 * result with it. Null when the user has no such strategy; a run that
 * can't start (no rules, no history) is returned and nothing is stored.
 */
export async function runStrategyBacktest(
    userId: string,
    id: string,
    { database = db, now = new Date() }: { database?: Database; now?: Date } = {},
): Promise<{ strategy: Strategy; outcome: BacktestOutcome } | null> {
    const [row] = await database.select().from(strategies).where(and(eq(strategies.id, id), eq(strategies.userId, userId)));
    if (!row) return null;
    const definition = row.definition;
    const to = now.toISOString().slice(0, 10);
    const from = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
    const symbols = [...new Set([...definition.symbols, BENCHMARK_SYMBOL])];
    const bars = definition.symbols.length ? await buildStrategyBarsQuery(symbols, from, to, database) : [];

    const bySymbol: Record<string, BacktestBar[]> = {};
    for (const bar of bars) (bySymbol[bar.symbol] ??= []).push(bar);
    const benchmark = bySymbol[BENCHMARK_SYMBOL];
    const traded = Object.fromEntries(definition.symbols.filter((s) => bySymbol[s]).map((s) => [s, bySymbol[s]]));

    const outcome = runBacktest(definition, traded, { benchmark });
    if (!outcome.ok) return { strategy: strategyFromRow(row), outcome };

    const backtest = { ...outcome.backtest, ranAt: now.toISOString() };
    const [saved] = await database.update(strategies)
        .set({ backtest })
        .where(and(eq(strategies.id, id), eq(strategies.userId, userId)))
        .returning();
    return saved ? { strategy: strategyFromRow(saved), outcome } : null;
}
