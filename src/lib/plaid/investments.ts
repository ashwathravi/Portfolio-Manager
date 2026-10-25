/**
 * Plaid Investments (launch item i44): a linked account's holdings and its
 * investment transactions, read from /investments/holdings/get and
 * /investments/transactions/get, and turned into what Atlas stores: a
 * portfolio's positions and cash, and transaction rows the API's own rules
 * accept (transactionRowSchema), so a Plaid transaction is held to the
 * same rules as one entered by hand or imported from a CSV.
 *
 * Mapping is pure and keeps what it can't bring in as a counted reason,
 * never a guess: a holding without a ticker, an option, a position in
 * another currency; a transaction type Atlas doesn't record.
 */

import { z } from "zod";

import { normalizeTicker } from "@/lib/research/watchlist";
import { transactionRowSchema, TRANSACTION_LIMITS, type TransactionRow } from "@/lib/validators/transaction";

import { asRecord, postPlaid, type PlaidCredentials, type PlaidFetch } from "./link";
import type { PlaidEnvironment } from "./types";

const number = z.number().finite();
const text = z.string();

const securitySchema = z.object({
    security_id: text,
    ticker_symbol: text.nullish(),
    name: text.nullish(),
    type: text.nullish(),
    is_cash_equivalent: z.boolean().nullish(),
    iso_currency_code: text.nullish(),
    unofficial_currency_code: text.nullish(),
});

const holdingSchema = z.object({
    account_id: text,
    security_id: text,
    quantity: number,
    institution_price: number.nullish(),
    institution_value: number.nullish(),
    cost_basis: number.nullish(),
    iso_currency_code: text.nullish(),
    unofficial_currency_code: text.nullish(),
});

const transactionSchema = z.object({
    investment_transaction_id: text,
    account_id: text,
    security_id: text.nullish(),
    date: text,
    name: text.nullish(),
    quantity: number.nullish(),
    amount: number.nullish(),
    price: number.nullish(),
    fees: number.nullish(),
    type: text,
    subtype: text.nullish(),
    iso_currency_code: text.nullish(),
    unofficial_currency_code: text.nullish(),
});

const holdingsResponseSchema = z.object({
    holdings: z.array(holdingSchema),
    securities: z.array(securitySchema),
});

const transactionsResponseSchema = z.object({
    investment_transactions: z.array(transactionSchema),
    securities: z.array(securitySchema),
    total_investment_transactions: z.number().int().nonnegative(),
});

export type PlaidSecurity = z.infer<typeof securitySchema>;
export type PlaidHolding = z.infer<typeof holdingSchema>;
export type PlaidInvestmentTransaction = z.infer<typeof transactionSchema>;

/** Plaid keeps two years of investment history; it pages it 500 at a time. */
export const PLAID_HISTORY_DAYS = 730;
export const PLAID_TRANSACTIONS_PAGE = 500;

interface PlaidCall {
    credentials: PlaidCredentials;
    environment: PlaidEnvironment;
    accessToken: string;
    accountIds: readonly string[];
    fetchImpl?: PlaidFetch;
    /** When to give up (ms since the epoch, by `clock`): no request runs past it. */
    deadline?: number;
    clock?: () => number;
}

/** Plaid ran past the caller's deadline; the sync stops and tries again next time. */
export class PlaidDeadlineError extends Error {
    constructor() {
        super("Plaid took longer than this sync had");
        this.name = "PlaidDeadlineError";
    }
}

/** A request's cancel signal: whatever is left before the deadline. */
function signalFor({ deadline, clock = Date.now }: Pick<PlaidCall, "deadline" | "clock">): AbortSignal | undefined {
    if (deadline === undefined) return undefined;
    const left = deadline - clock();
    if (left <= 0) throw new PlaidDeadlineError();
    return AbortSignal.timeout(left);
}

/** A cancelled request is the deadline passing, not Plaid failing. */
async function withinDeadline<T>(request: () => Promise<T>): Promise<T> {
    try {
        return await request();
    } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new PlaidDeadlineError();
        throw error;
    }
}

function parse<T>(schema: z.ZodType<T>, payload: unknown, endpoint: string): T {
    const result = schema.safeParse(asRecord(payload));
    if (!result.success) throw new Error(`Plaid ${endpoint} answered in a shape Atlas doesn't read.`);
    return result.data;
}

export async function fetchPlaidHoldings({ credentials, environment, accessToken, accountIds, fetchImpl = fetch, deadline, clock }: PlaidCall) {
    const payload = await withinDeadline(() => postPlaid({
        endpoint: "/investments/holdings/get",
        environment,
        credentials,
        fetchImpl,
        signal: signalFor({ deadline, clock }),
        body: { access_token: accessToken, options: { account_ids: [...accountIds] } },
    }));
    return parse(holdingsResponseSchema, payload, "/investments/holdings/get");
}

/** Every transaction between the dates (YYYY-MM-DD), a page at a time. */
export async function fetchPlaidInvestmentTransactions({
    credentials,
    environment,
    accessToken,
    accountIds,
    startDate,
    endDate,
    fetchImpl = fetch,
    deadline,
    clock,
}: PlaidCall & { startDate: string; endDate: string }) {
    const transactions: PlaidInvestmentTransaction[] = [];
    const securities = new Map<string, PlaidSecurity>();
    for (;;) {
        // Each page within what's left: a long history can't outrun the deadline.
        const payload = await withinDeadline(() => postPlaid({
            endpoint: "/investments/transactions/get",
            environment,
            credentials,
            fetchImpl,
            signal: signalFor({ deadline, clock }),
            body: {
                access_token: accessToken,
                start_date: startDate,
                end_date: endDate,
                options: { account_ids: [...accountIds], count: PLAID_TRANSACTIONS_PAGE, offset: transactions.length },
            },
        }));
        const page = parse(transactionsResponseSchema, payload, "/investments/transactions/get");
        transactions.push(...page.investment_transactions);
        for (const security of page.securities) securities.set(security.security_id, security);
        // An empty page ends it too, so a total that never adds up can't loop.
        if (page.investment_transactions.length === 0 || transactions.length >= page.total_investment_transactions) break;
    }
    return { transactions, securities: [...securities.values()] };
}

// ---------------------------------------------------------------------------
// Holdings → a portfolio's positions and cash
// ---------------------------------------------------------------------------

export interface SyncedPosition {
    symbol: string;
    name: string;
    quantity: number;
    avgCost: number;
    /** The institution's last price; readers prefer a newer one from the price store. */
    price: number | null;
}

export type HoldingSkipReason = "no-ticker" | "option" | "other-currency" | "short";

export interface AccountHoldings {
    positions: SyncedPosition[];
    /** Cash and cash equivalents (a money market sweep), in USD. */
    cashUsd: number;
    skipped: { reason: HoldingSkipReason; name: string }[];
    /** Positions whose cost Plaid doesn't report, valued at their price instead. */
    costUnknown: string[];
}

function isCash(security: PlaidSecurity | undefined): boolean {
    return security?.type === "cash" || security?.is_cash_equivalent === true;
}

function inUsd(code: { iso_currency_code?: string | null; unofficial_currency_code?: string | null }): boolean {
    return !code.unofficial_currency_code && (code.iso_currency_code ?? "USD") === "USD";
}

function round(n: number, places: number): number {
    const f = 10 ** places;
    return Math.round(n * f) / f;
}

/**
 * One account's holdings as Atlas keeps them: a row per ticker (Plaid's
 * lots of one security combined), cash and cash equivalents as the
 * account's cash, and the rest counted as not brought in.
 */
export function accountHoldings(
    accountId: string,
    holdings: readonly PlaidHolding[],
    securities: readonly PlaidSecurity[],
): AccountHoldings {
    const bySecurity = new Map(securities.map((s) => [s.security_id, s]));
    const positions = new Map<string, SyncedPosition & { cost: number; costKnown: boolean }>();
    const skipped: AccountHoldings["skipped"] = [];
    let cashUsd = 0;

    for (const holding of holdings) {
        if (holding.account_id !== accountId) continue;
        const security = bySecurity.get(holding.security_id);
        const name = security?.name?.trim() || security?.ticker_symbol?.trim() || "Unnamed holding";
        const value = holding.institution_value ?? holding.quantity * (holding.institution_price ?? 0);
        if (!inUsd(holding)) {
            skipped.push({ reason: "other-currency", name });
            continue;
        }
        if (isCash(security)) {
            cashUsd += value;
            continue;
        }
        if (security?.type === "derivative") {
            skipped.push({ reason: "option", name });
            continue;
        }
        const symbol = security?.ticker_symbol ? normalizeTicker(security.ticker_symbol) : null;
        if (!symbol) {
            skipped.push({ reason: "no-ticker", name });
            continue;
        }
        if (!(holding.quantity > 0)) {
            if (holding.quantity < 0) skipped.push({ reason: "short", name });
            continue;
        }
        const price = holding.institution_price != null && holding.institution_price > 0 ? holding.institution_price : null;
        const costKnown = holding.cost_basis != null && holding.cost_basis > 0;
        // Without a cost basis, the position is held at its price: no gain
        // or loss is claimed that Plaid didn't report.
        const cost = costKnown ? holding.cost_basis! : holding.quantity * (price ?? 0);
        const existing = positions.get(symbol);
        if (existing) {
            existing.quantity += holding.quantity;
            existing.cost += cost;
            existing.costKnown &&= costKnown;
            existing.price ??= price;
        } else {
            positions.set(symbol, { symbol, name, quantity: holding.quantity, avgCost: 0, price, cost, costKnown });
        }
    }

    const rows = [...positions.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
    return {
        positions: rows.map(({ symbol, name, quantity, cost, price }) => ({
            symbol,
            name,
            quantity: round(quantity, 6),
            avgCost: round(cost / quantity, 6),
            price,
        })),
        cashUsd: round(cashUsd, 2),
        skipped,
        costUnknown: rows.filter((p) => !p.costKnown).map((p) => p.symbol),
    };
}

// ---------------------------------------------------------------------------
// Investment transactions → transaction rows
// ---------------------------------------------------------------------------

/** What Plaid's cash subtypes are, as Atlas records them. */
const CASH_SUBTYPES: Readonly<Record<string, TransactionRow["type"]>> = {
    "dividend": "DIVIDEND",
    "qualified dividend": "DIVIDEND",
    "non-qualified dividend": "DIVIDEND",
    "long-term capital gain": "DIVIDEND",
    "short-term capital gain": "DIVIDEND",
    "unqualified gain": "DIVIDEND",
    "interest": "INTEREST",
    "interest receivable": "INTEREST",
    "deposit": "DEPOSIT",
    "contribution": "DEPOSIT",
    "withdrawal": "WITHDRAWAL",
    "distribution": "WITHDRAWAL",
    "tax": "FEE",
    "tax withheld": "FEE",
    "non-resident tax": "FEE",
    "margin expense": "FEE",
};

export type TransactionSkipReason = "not-recorded" | "no-symbol" | "other-currency" | "cash-sweep" | "invalid";

export type MappedTransaction =
    | { row: TransactionRow & { externalId: string } }
    | { skipped: TransactionSkipReason };

/** Atlas's type for a Plaid type and subtype; null for what it doesn't record. */
export function transactionTypeForPlaid(type: string, subtype: string | null | undefined): TransactionRow["type"] | null {
    const t = type.trim().toLowerCase();
    if (t === "buy") return "BUY";
    if (t === "sell") return "SELL";
    if (t === "fee") return "FEE";
    // A cancel, and a transfer of shares in or out (no cash moved; the
    // holdings say what's held), aren't recorded.
    if (t === "cash") return CASH_SUBTYPES[(subtype ?? "").trim().toLowerCase()] ?? null;
    return null;
}

/** A note from Plaid's description, without what the API refuses in text. */
function noteOf(raw: string | null | undefined): string | null {
    const note = (raw ?? "").replace(/[<>]/g, "").replace(/^[=+\-@\s]+/, "").trim().slice(0, TRANSACTION_LIMITS.notes);
    return note || null;
}

export function mapPlaidTransaction(transaction: PlaidInvestmentTransaction, security: PlaidSecurity | undefined): MappedTransaction {
    const type = transactionTypeForPlaid(transaction.type, transaction.subtype);
    if (!type) return { skipped: "not-recorded" };
    // Kept in its currency (CAD, EUR); an unofficial one (a coin) isn't a currency.
    if (transaction.unofficial_currency_code) return { skipped: "other-currency" };

    const trade = type === "BUY" || type === "SELL";
    // A cash equivalent with a ticker (a money market sweep, SPAXX) is cash
    // in the holdings: buying or selling it moves cash within the account,
    // not into a position, but its dividends are income from that fund.
    const sweep = security?.is_cash_equivalent === true && security.type !== "cash";
    if (sweep && trade) return { skipped: "cash-sweep" };
    // Currency itself ("CUR:USD") has no ticker to keep.
    const symbol = security?.ticker_symbol && security.type !== "cash" ? normalizeTicker(security.ticker_symbol) : null;
    if ((trade || type === "DIVIDEND") && !symbol) return { skipped: "no-symbol" };

    const quantity = transaction.quantity != null ? Math.abs(transaction.quantity) : null;
    const amount = transaction.amount != null ? Math.abs(transaction.amount) : null;
    const fees = transaction.fees != null && transaction.fees > 0 ? round(transaction.fees, 2) : null;
    const candidate = {
        type,
        date: transaction.date,
        symbol: trade || type === "DIVIDEND" ? symbol : null,
        quantity: trade ? (quantity ? round(quantity, 6) : null) : null,
        price: trade ? (transaction.price != null ? round(Math.abs(transaction.price), 6) : null) : null,
        amount: amount ? round(amount, 2) : null,
        fees,
        currency: transaction.iso_currency_code ?? "USD",
        notes: noteOf(transaction.name),
        externalId: `plaid:${transaction.investment_transaction_id}`.slice(0, TRANSACTION_LIMITS.externalId),
    };
    const parsed = transactionRowSchema.safeParse(candidate);
    if (!parsed.success) return { skipped: "invalid" };
    return { row: { ...parsed.data, externalId: candidate.externalId } };
}

/** An account's transactions as rows, with how many of each kind were left out. */
export function accountTransactions(
    accountId: string,
    transactions: readonly PlaidInvestmentTransaction[],
    securities: readonly PlaidSecurity[],
): { rows: (TransactionRow & { externalId: string })[]; skipped: Partial<Record<TransactionSkipReason, number>> } {
    const bySecurity = new Map(securities.map((s) => [s.security_id, s]));
    const rows: (TransactionRow & { externalId: string })[] = [];
    const skipped: Partial<Record<TransactionSkipReason, number>> = {};
    for (const transaction of transactions) {
        if (transaction.account_id !== accountId) continue;
        const mapped = mapPlaidTransaction(transaction, transaction.security_id ? bySecurity.get(transaction.security_id) : undefined);
        if ("row" in mapped) rows.push(mapped.row);
        else skipped[mapped.skipped] = (skipped[mapped.skipped] ?? 0) + 1;
    }
    return { rows, skipped };
}
