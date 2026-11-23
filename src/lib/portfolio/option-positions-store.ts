/**
 * The option_positions table (launch item i63). Every query is scoped to
 * one user's ID, which the API routes take from the session, and every
 * write checks that the account is theirs (the database also refuses a
 * position in another user's account: option_positions_portfolio_owner_fk).
 *
 * A Plaid sync writes the contracts a linked account reports (source
 * "plaid", launch item i44). While that account syncs, the contract, the
 * number of contracts, the premium and the account are the institution's:
 * an edit saves only the user's fields (the opened date, their own price,
 * the thesis and the rules), and moving or deleting the position is
 * refused (SyncedOptionPositionError). Once it no longer syncs, the
 * position is the user's like any other. Every write takes the user's
 * account lock first, as a sync does, so the two never cross.
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
    type OptionPositionSource,
} from "./option-positions";
import { isSeedThesis } from "@/lib/research/thesis";

import { buildLockUserAccountsQuery, buildSyncingAccountsQuery } from "./manage";
import { AccountNotFoundError } from "./transactionsWrite";

type Database = typeof db;
type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export class DuplicateOptionPositionError extends Error {
    constructor(readonly contract: string) {
        super(`The account already holds ${contract}`);
        this.name = "DuplicateOptionPositionError";
    }
}

/** A position a linked account syncs can't be moved to another account, or deleted, while it syncs. */
export class SyncedOptionPositionError extends Error {
    constructor(readonly action: "move" | "delete") {
        super(`A synced option position can't be ${action === "move" ? "moved" : "deleted"} while its account syncs`);
        this.name = "SyncedOptionPositionError";
    }
}

/** Whether the user's linked account still syncs, so what it brought in is the institution's. */
async function accountSyncs(tx: Executor, userId: string, portfolioId: string): Promise<boolean> {
    return (await buildSyncingAccountsQuery(userId, tx, portfolioId)).length > 0;
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
    const [titles, prices, syncing] = await Promise.all([
        thesisIds.length === 0 ? [] : database
            .select({ id: theses.id, title: theses.title })
            .from(theses)
            .where(and(eq(theses.userId, userId), inArray(theses.id, thesisIds), eq(theses.dismissed, false))),
        quotes([...new Set(rows.map((row) => row.position.underlying))]),
        // Which linked accounts still sync, only when one brought a position in.
        rows.some((row) => row.position.source === "plaid") ? buildSyncingAccountsQuery(userId, database) : [],
    ]);
    const titleOf = new Map(titles.map((t) => [t.id, t.title]));
    const syncingAccounts = new Set(syncing.map((a) => a.id));
    return rows.map(({ position: p, account, close, closeDate }) => {
        const premium = Number(p.premium);
        const userMark = p.userMark == null ? null : Number(p.userMark);
        const institutionPrice = p.institutionPrice == null ? null : Number(p.institutionPrice);
        const price = prices[p.underlying]?.price;
        return {
            id: p.id,
            portfolioId: p.portfolioId,
            account,
            contract: p.contract,
            source: p.source as OptionPositionSource,
            synced: p.source === "plaid" && syncingAccounts.has(p.portfolioId),
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
            institutionPrice,
            institutionPriceDate: p.institutionPriceDate,
            thesisId: p.thesisId,
            thesisTitle: p.thesisId ? (titleOf.get(p.thesisId) ?? null) : null,
            expiryTest: p.expiryTest,
            exitRule: p.exitRule,
            mark: chooseOptionMark({
                premium, close, closeDate, userMark, userMarkDate: p.userMarkDate, institutionPrice, institutionPriceDate: p.institutionPriceDate,
            }),
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

/**
 * Adds a position to one of the user's accounts and returns its ID. A
 * contract the account already holds, a synced one included, is a
 * DuplicateOptionPositionError.
 */
export async function addOptionPosition(
    userId: string,
    portfolioId: string,
    input: OptionPositionInput,
    database: Database = db,
): Promise<string> {
    return withDuplicateCheck(input, () => database.transaction(async (tx) => {
        await buildLockUserAccountsQuery(userId, tx);
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
 *
 * One a linked account syncs keeps the institution's contract, contracts,
 * premium and account while it syncs: only the opened date, the user's
 * price, the thesis and the rules are saved, and a move to another
 * account is a SyncedOptionPositionError. Once it no longer syncs, the
 * whole position is saved and it is the user's ("manual").
 */
export async function updateOptionPosition(
    userId: string,
    id: string,
    portfolioId: string,
    input: OptionPositionInput,
    { database = db, now = new Date() }: { database?: Database; now?: Date } = {},
): Promise<boolean> {
    return withDuplicateCheck(input, () => database.transaction(async (tx) => {
        await buildLockUserAccountsQuery(userId, tx);
        await ownedAccount(tx, userId, portfolioId);
        const [current] = await tx
            .select({
                portfolioId: optionPositions.portfolioId,
                source: optionPositions.source,
                contract: optionPositions.contract,
                underlying: optionPositions.underlying,
                contractType: optionPositions.contractType,
                strike: optionPositions.strike,
                expiry: optionPositions.expiry,
            })
            .from(optionPositions)
            .where(and(eq(optionPositions.id, id), eq(optionPositions.userId, userId)))
            .limit(1);
        if (!current) return false;
        const where = and(eq(optionPositions.id, id), eq(optionPositions.userId, userId));
        if (current.source === "plaid" && (await accountSyncs(tx, userId, current.portfolioId))) {
            if (portfolioId !== current.portfolioId) throw new SyncedOptionPositionError("move");
            const values = positionValues(input);
            await tx
                .update(optionPositions)
                .set({
                    openedAt: values.openedAt,
                    userMark: values.userMark,
                    userMarkDate: values.userMarkDate,
                    thesisId: values.thesisId,
                    expiryTest: values.expiryTest,
                    exitRule: values.exitRule,
                    updatedAt: now,
                })
                .where(where);
            return true;
        }
        // The same contract keeps its stored name: a weekly a sync brought
        // in is filed under its own root (SPXW), which the form's fields
        // alone would name as the underlying's (SPX). A changed contract
        // drops the institution's price, which was for the old one.
        const sameContract = current.underlying === input.underlying
            && current.contractType === input.contractType
            && Number(current.strike) === input.strike
            && current.expiry === input.expiry;
        const updated = await tx
            .update(optionPositions)
            .set({
                portfolioId,
                ...positionValues(input),
                ...(sameContract ? { contract: current.contract } : { institutionPrice: null, institutionPriceDate: null }),
                ...(current.source === "plaid" ? { source: "manual" } : {}),
                updatedAt: now,
            })
            .where(where)
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

/**
 * False when the user has no position with that ID. One a linked account
 * syncs goes when the account no longer holds it, not before: while the
 * account syncs, deleting it is a SyncedOptionPositionError.
 */
export async function deleteOptionPosition(userId: string, id: string, database: Database = db): Promise<boolean> {
    return database.transaction(async (tx) => {
        await buildLockUserAccountsQuery(userId, tx);
        const [current] = await tx
            .select({ portfolioId: optionPositions.portfolioId, source: optionPositions.source })
            .from(optionPositions)
            .where(and(eq(optionPositions.id, id), eq(optionPositions.userId, userId)))
            .limit(1);
        if (!current) return false;
        if (current.source === "plaid" && (await accountSyncs(tx, userId, current.portfolioId))) throw new SyncedOptionPositionError("delete");
        return (await buildDeleteOptionPositionQuery(userId, id, tx)).length > 0;
    });
}

export interface OptionImportResult {
    insert: number;
    update: number;
    unchanged: number;
}

/**
 * The option rows of a positions CSV, into an account `tx` has already
 * checked is the user's, under the user's account lock (importHoldings).
 * As for stocks, the file is a snapshot of the account: a contract it
 * already holds takes the file's contracts and premium, keeping the user's
 * thesis, rules and own price; positions not in the file are left alone.
 * A contract the account's sync brought in stays as the sync has it while
 * the account syncs, and counts as unchanged.
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
        .select({
            id: optionPositions.id,
            contract: optionPositions.contract,
            quantity: optionPositions.quantity,
            premium: optionPositions.premium,
            source: optionPositions.source,
        })
        .from(optionPositions)
        .where(and(eq(optionPositions.portfolioId, portfolioId), eq(optionPositions.userId, userId)));
    const byContract = new Map(existing.map((row) => [row.contract, row]));
    const syncing = existing.some((row) => row.source === "plaid") && (await accountSyncs(tx, userId, portfolioId));
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
        if (
            (syncing && current.source === "plaid")
            || (Math.abs(Number(current.quantity) - row.quantity) < 1e-9 && Math.abs(Number(current.premium) - row.premium) < 1e-6)
        ) {
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
