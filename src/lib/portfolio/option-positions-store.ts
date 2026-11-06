/**
 * The option_positions table (launch item i63). Every query is scoped to
 * one user's ID, which the API routes take from the session, and every
 * write checks that the account is theirs (the database also refuses a
 * position in another user's account: option_positions_portfolio_owner_fk).
 */

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { optionMarks, optionPositions, portfolios, theses } from "@/db/schema";
import type { Quote } from "@/types/market-data";
import type { OptionContractRow, OptionPositionInput } from "@/lib/validators/option-position";

import {
    chooseOptionMark,
    optionContractTicker,
    OPTION_POSITION_MULTIPLIER,
    type LoadedOptionPosition,
} from "./option-positions";
import { isSeedThesis } from "@/lib/research/thesis";

import { AccountNotFoundError } from "./transactionsWrite";

type Database = typeof db;
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export class DuplicateOptionPositionError extends Error {
    constructor(readonly contract: string) {
        super(`The account already holds ${contract}`);
        this.name = "DuplicateOptionPositionError";
    }
}

/** The user's positions with their account's name and the contract's stored close. */
export function buildUserOptionPositionsQuery(userId: string, database: Executor = db) {
    return database
        .select({
            position: optionPositions,
            account: portfolios.name,
            close: optionMarks.close,
            closeDate: optionMarks.closeDate,
        })
        .from(optionPositions)
        .innerJoin(portfolios, and(eq(portfolios.id, optionPositions.portfolioId), eq(portfolios.userId, optionPositions.userId)))
        .leftJoin(optionMarks, eq(optionMarks.contract, optionPositions.contract))
        .where(eq(optionPositions.userId, userId))
        .orderBy(asc(optionPositions.expiry), asc(optionPositions.underlying), asc(optionPositions.strike), asc(optionPositions.id));
}

/**
 * The user's positions, each marked (chooseOptionMark) and with its
 * thesis's title. `quotes` prices the underlyings, for the ledger's
 * notional equivalent; without one it uses the strike.
 */
export async function loadOptionPositions(
    userId: string,
    {
        database = db,
        quotes = async () => ({}),
    }: { database?: Database; quotes?: (symbols: string[]) => Promise<Readonly<Record<string, Pick<Quote, "price">>>> } = {},
): Promise<LoadedOptionPosition[]> {
    const rows = await buildUserOptionPositionsQuery(userId, database);
    if (rows.length === 0) return [];
    const thesisIds = [...new Set(rows.flatMap((row) => (row.position.thesisId ? [row.position.thesisId] : [])))];
    const [titles, prices] = await Promise.all([
        thesisIds.length === 0 ? [] : database
            .select({ id: theses.id, title: theses.title })
            .from(theses)
            .where(and(eq(theses.userId, userId), inArray(theses.id, thesisIds), eq(theses.dismissed, false))),
        quotes([...new Set(rows.map((row) => row.position.underlying))]),
    ]);
    const titleOf = new Map(titles.map((t) => [t.id, t.title]));
    return rows.map(({ position: p, account, close, closeDate }) => {
        const premium = Number(p.premium);
        const userMark = p.userMark == null ? null : Number(p.userMark);
        const price = prices[p.underlying]?.price;
        return {
            id: p.id,
            portfolioId: p.portfolioId,
            account,
            contract: p.contract,
            underlying: p.underlying,
            contractType: p.contractType as LoadedOptionPosition["contractType"],
            strike: Number(p.strike),
            expiry: p.expiry,
            quantity: Number(p.quantity),
            premium,
            multiplier: p.multiplier,
            openedAt: p.openedAt,
            userMark,
            userMarkDate: p.userMarkDate,
            thesisId: p.thesisId,
            thesisTitle: p.thesisId ? (titleOf.get(p.thesisId) ?? null) : null,
            expiryTest: p.expiryTest,
            exitRule: p.exitRule,
            mark: chooseOptionMark({ premium, close, closeDate, userMark, userMarkDate: p.userMarkDate }),
            underlyingPrice: price != null && Number.isFinite(price) && price > 0 ? price : null,
        };
    });
}

/** The theses a position can be linked to: the ones the user wrote, by ticker. */
export async function loadThesisChoices(userId: string, database: Database = db): Promise<Array<{ id: string; ticker: string; title: string }>> {
    const rows = await database
        .select({ id: theses.id, ticker: theses.ticker, title: theses.title })
        .from(theses)
        .where(and(eq(theses.userId, userId), eq(theses.dismissed, false)))
        .orderBy(asc(theses.ticker), asc(theses.id));
    return rows.filter((row) => !isSeedThesis(row));
}

async function ownedAccount(tx: Executor, userId: string, portfolioId: string): Promise<void> {
    const [owned] = await tx
        .select({ id: portfolios.id })
        .from(portfolios)
        .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
        .limit(1);
    if (!owned) throw new AccountNotFoundError();
}

/** The stored columns of a position as the form saves it. */
function positionValues(input: OptionPositionInput) {
    return {
        contract: optionContractTicker(input),
        underlying: input.underlying,
        contractType: input.contractType,
        strike: String(input.strike),
        expiry: input.expiry,
        quantity: String(input.quantity),
        premium: String(input.premium),
        multiplier: input.multiplier,
        openedAt: input.openedAt,
        userMark: input.userMark == null ? null : String(input.userMark),
        userMarkDate: input.userMarkDate,
        thesisId: input.thesisId,
        expiryTest: input.expiryTest,
        exitRule: input.exitRule,
    };
}

/** Adds a position to one of the user's accounts and returns its ID. */
export async function addOptionPosition(
    userId: string,
    portfolioId: string,
    input: OptionPositionInput,
    database: Database = db,
): Promise<string> {
    return withDuplicateCheck(input, () => database.transaction(async (tx) => {
        await ownedAccount(tx, userId, portfolioId);
        const [inserted] = await tx
            .insert(optionPositions)
            .values({ userId, portfolioId, ...positionValues(input), source: "manual" })
            .returning({ id: optionPositions.id });
        return inserted.id;
    }));
}

/**
 * Saves the position as the form now has it, possibly in another of the
 * user's accounts. False when the user has no position with that ID.
 */
export async function updateOptionPosition(
    userId: string,
    id: string,
    portfolioId: string,
    input: OptionPositionInput,
    { database = db, now = new Date() }: { database?: Database; now?: Date } = {},
): Promise<boolean> {
    return withDuplicateCheck(input, () => database.transaction(async (tx) => {
        await ownedAccount(tx, userId, portfolioId);
        const updated = await tx
            .update(optionPositions)
            .set({ portfolioId, ...positionValues(input), updatedAt: now })
            .where(and(eq(optionPositions.id, id), eq(optionPositions.userId, userId)))
            .returning({ id: optionPositions.id });
        return updated.length > 0;
    }));
}

export function buildDeleteOptionPositionQuery(userId: string, id: string, database: Executor = db) {
    return database
        .delete(optionPositions)
        .where(and(eq(optionPositions.id, id), eq(optionPositions.userId, userId)))
        .returning({ id: optionPositions.id });
}

/** False when the user has no position with that ID. */
export async function deleteOptionPosition(userId: string, id: string, database: Database = db): Promise<boolean> {
    return (await buildDeleteOptionPositionQuery(userId, id, database)).length > 0;
}

export interface OptionImportResult {
    insert: number;
    update: number;
    unchanged: number;
}

/**
 * The option rows of a positions CSV, into an account `tx` has already
 * checked is the user's (importHoldings). As for stocks, the file is a
 * snapshot of the account: a contract it already holds takes the file's
 * contracts and premium, keeping the user's thesis, rules and own price;
 * positions not in the file are left alone.
 */
export async function importOptionRows(
    tx: Executor,
    userId: string,
    portfolioId: string,
    rows: readonly OptionContractRow[],
    now: Date = new Date(),
): Promise<OptionImportResult> {
    const result: OptionImportResult = { insert: 0, update: 0, unchanged: 0 };
    if (rows.length === 0) return result;
    const existing = await tx
        .select({ id: optionPositions.id, contract: optionPositions.contract, quantity: optionPositions.quantity, premium: optionPositions.premium })
        .from(optionPositions)
        .where(and(eq(optionPositions.portfolioId, portfolioId), eq(optionPositions.userId, userId)));
    const byContract = new Map(existing.map((row) => [row.contract, row]));
    const inserts: (typeof optionPositions.$inferInsert)[] = [];
    for (const row of rows) {
        const contract = optionContractTicker(row);
        const current = byContract.get(contract);
        if (!current) {
            inserts.push({
                userId,
                portfolioId,
                contract,
                underlying: row.underlying,
                contractType: row.contractType,
                strike: String(row.strike),
                expiry: row.expiry,
                quantity: String(row.quantity),
                premium: String(row.premium),
                multiplier: OPTION_POSITION_MULTIPLIER,
                source: "csv",
            });
            continue;
        }
        if (Math.abs(Number(current.quantity) - row.quantity) < 1e-9 && Math.abs(Number(current.premium) - row.premium) < 1e-6) {
            result.unchanged++;
            continue;
        }
        await tx
            .update(optionPositions)
            .set({ quantity: String(row.quantity), premium: String(row.premium), updatedAt: now })
            .where(and(eq(optionPositions.id, current.id), eq(optionPositions.userId, userId)));
        result.update++;
    }
    if (inserts.length > 0) await tx.insert(optionPositions).values(inserts);
    result.insert = inserts.length;
    return result;
}

async function withDuplicateCheck<T>(input: OptionPositionInput, write: () => Promise<T>): Promise<T> {
    try {
        return await write();
    } catch (error) {
        if (isUniqueViolation(error, "option_positions_portfolio_contract_idx")) {
            throw new DuplicateOptionPositionError(optionContractTicker(input));
        }
        throw error;
    }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
    for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
        const candidate = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
        if (candidate.code === "23505") {
            return candidate.constraint_name === constraint || candidate.constraint === constraint;
        }
    }
    return false;
}
