/**
 * Plaid Investments (launch item i44): a linked account's holdings and its
 * investment transactions, read from /investments/holdings/get and
 * /investments/transactions/get, and turned into what Atlas stores: a
 * portfolio's positions and cash, and transaction rows the API's own rules
 * accept (transactionRowSchema), so a Plaid transaction is held to the
 * same rules as one entered by hand or imported from a CSV.
 *
 * Option contracts Plaid reports with their details become the account's
 * option positions (launch item i63), as many contracts as the holding's
 * quantity, price and value agree on, read the same way for every lot of
 * a contract.
 *
 * Mapping is pure and keeps what it can't bring in as a counted reason,
 * never a guess: a holding without a ticker or a value, an option or
 * warrant without clear contract details, a position in another currency;
 * a transaction type Atlas doesn't record, an option trade.
 */

import { z } from "zod";

import { getMarketDay, previousTradingDay } from "@/lib/markets/market-hours";
import {
    describeOptionContract,
    isCalendarDate,
    isOptionStrike,
    optionContractTicker,
    OPTION_POSITION_MULTIPLIER,
    parseOptionContract,
    type OptionContract,
} from "@/lib/portfolio/option-positions";
import { normalizeTicker } from "@/lib/research/watchlist";
import { transactionRowSchema, TRANSACTION_LIMITS, type TransactionRow } from "@/lib/validators/transaction";

import { asRecord, postPlaid, type PlaidCredentials, type PlaidFetch } from "./link";
import type { PlaidEnvironment } from "./types";

const number = z.number().finite();
const text = z.string();

const securitySchema = z.object({
    security_id: text,
    ticker_symbol: text.nullish(),
    cusip: text.nullish(),
    name: text.nullish(),
    type: text.nullish(),
    is_cash_equivalent: z.boolean().nullish(),
    iso_currency_code: text.nullish(),
    unofficial_currency_code: text.nullish(),
    // An option's contract, read on its own (optionContractSchema): a
    // detail Atlas can't read leaves that one option out, not the sync.
    option_contract: z.unknown().optional(),
});

const holdingSchema = z.object({
    account_id: text,
    security_id: text,
    quantity: number,
    institution_price: number.nullish(),
    // The day of the institution's price (YYYY-MM-DD), when Plaid has it.
    institution_price_as_of: z.unknown().optional(),
    institution_value: number.nullish(),
    cost_basis: number.nullish(),
    iso_currency_code: text.nullish(),
    unofficial_currency_code: text.nullish(),
});

/** A security's option_contract, as Plaid documents it. */
const optionContractSchema = z.object({
    contract_type: text.nullish(),
    expiration_date: text.nullish(),
    strike_price: number.nullish(),
    underlying_security_ticker: text.nullish(),
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

/**
 * Why a holding wasn't brought in: no ticker and no value; an option or
 * warrant without contract details clear enough to bring in; held in
 * another currency; a short stock position.
 */
export type HoldingSkipReason = "no-ticker" | "option" | "other-currency" | "short";

/**
 * An option contract the account holds, as Plaid reports it: it becomes
 * one of the account's option positions (source "plaid").
 */
export interface SyncedOptionContract {
    /** Massive's ticker for it (O:ACME270115C00150000). */
    contract: string;
    underlying: string;
    contractType: "call" | "put";
    strike: number;
    /** YYYY-MM-DD. */
    expiry: string;
    /** Contracts; negative when written. */
    quantity: number;
    /** Per share: paid, or received when written. */
    premium: number;
    /** The institution's price per share, when it reports one. */
    price: number | null;
    /** The day of that price, when Plaid says. */
    priceDate: string | null;
}

/**
 * A holding with no ticker that the institution values (a 401(k)'s
 * collective trust, a 529 portfolio): kept as a holding valued by hand
 * (manual_holdings), at the institution's value, which each sync replaces.
 */
export interface InstitutionValuedHolding {
    /** Plaid's security_id: the same holding on the next sync. */
    externalId: string;
    name: string;
    identifier: string | null;
    quantity: number | null;
    value: number;
    costBasis: number | null;
    /** The day of the institution's value, when Plaid dates it; of lots, the earliest. */
    priceDate: string | null;
}

export interface AccountHoldings {
    positions: SyncedPosition[];
    /** Holdings with no ticker, at the institution's value. */
    institutionValued: InstitutionValuedHolding[];
    /** Cash and cash equivalents (a money market sweep), in USD. */
    cashUsd: number;
    /** Option contracts with their details. */
    options: SyncedOptionContract[];
    /**
     * Contracts reported this time without details clear enough to bring
     * in: the rows an earlier sync wrote for them stay as they were.
     */
    optionsKept: string[];
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
 * An option or a warrant: Plaid's derivative type, a security with
 * option_contract details, or one whose ticker is a contract's symbol
 * (ACME270115C00150000) whatever its type, so an option Plaid gives no
 * type, or a stock's, never counts as a holding the institution values.
 */
function isOption(security: PlaidSecurity | undefined): boolean {
    if (!security) return false;
    if (security.type === "derivative" || security.option_contract != null) return true;
    return Boolean(security.ticker_symbol && parseOptionContract(security.ticker_symbol));
}

/**
 * The contract an option security is, from its option_contract details;
 * null when they aren't all there and valid. When its ticker is a
 * contract's symbol too, the two must agree. A symbol whose root is the
 * underlying with letters after it (SPXW for SPX's weeklies) is a contract
 * of its own and keeps that root in its ticker; one with digits after it
 * (ACME1) is an adjusted contract, after a split or a merger, which
 * delivers something other than 100 shares, and isn't read. `standard`
 * says a symbol confirmed it, so it delivers 100 shares; without one, it
 * may be an adjusted contract all the same.
 */
function plaidOptionContract(security: PlaidSecurity): { contract: string; details: OptionContract; standard: boolean } | null {
    const parsed = optionContractSchema.safeParse(security.option_contract);
    if (!parsed.success) return null;
    const { contract_type, expiration_date, strike_price, underlying_security_ticker } = parsed.data;
    const contractType = contract_type?.trim().toLowerCase();
    const expiry = expiration_date?.trim().slice(0, 10) ?? "";
    const underlying = underlying_security_ticker ? normalizeTicker(underlying_security_ticker) : null;
    if ((contractType !== "call" && contractType !== "put") || !isCalendarDate(expiry) || strike_price == null || !isOptionStrike(strike_price) || !underlying) {
        return null;
    }
    const details: OptionContract = { underlying, contractType, strike: strike_price, expiry };
    const symbol = security.ticker_symbol ? parseOptionContract(security.ticker_symbol) : null;
    if (!symbol) return { contract: optionContractTicker(details), details, standard: false };
    if (symbol.contractType !== details.contractType || symbol.expiry !== details.expiry || Math.abs(symbol.strike - details.strike) > 1e-9) return null;
    // BRKB and BRK.B are one root.
    const root = symbol.underlying.replace(/[^A-Z0-9]/g, "");
    const base = underlying.replace(/[^A-Z0-9]/g, "");
    if (root === base) return { contract: optionContractTicker(details), details, standard: true };
    if (root.startsWith(base) && /^[A-Z]+$/.test(root.slice(base.length))) {
        return { contract: optionContractTicker({ ...details, underlying: root }), details, standard: true };
    }
    return null;
}

/**
 * The option contracts a holdings response has, and their underlyings: what
 * the stored prices that help read them are looked up for
 * ({@link OptionPriceEvidence}).
 */
export function optionContractsIn(securities: readonly PlaidSecurity[]): { contracts: string[]; underlyings: string[] } {
    const contracts = new Set<string>();
    const underlyings = new Set<string>();
    for (const security of securities) {
        const read = isOption(security) ? plaidOptionContract(security) : null;
        if (!read) continue;
        contracts.add(read.contract);
        underlyings.add(read.details.underlying);
    }
    return { contracts: [...contracts].sort(), underlyings: [...underlyings].sort() };
}

/** The contract an option's symbol names, for one whose details can't be read. */
function symbolContract(security: PlaidSecurity): string | null {
    const symbol = security.ticker_symbol ? parseOptionContract(security.ticker_symbol) : null;
    return symbol ? optionContractTicker(symbol) : null;
}

/** A whole number of contracts, not none. */
function whole(x: number): boolean {
    return Math.abs(x - Math.round(x)) < 1e-6 && Math.round(x) !== 0;
}

/** Within rounding: 5 cents, or 2% of what it's checked against. */
function near(a: number, b: number): boolean {
    return Math.abs(a - b) <= Math.max(0.05, 0.02 * Math.abs(b));
}

/**
 * How an option holding's quantity and price read. Plaid's quantity is
 * typically the contracts × 100 at a price per share ("shares"), but
 * institutions differ: some give the contracts at a price per share
 * ("contracts"), some the contracts at a price per contract
 * ("per-contract").
 */
export type OptionReading = "shares" | "contracts" | "per-contract";

const OPTION_READINGS: readonly OptionReading[] = ["shares", "contracts", "per-contract"];

/** A lot's contracts, and its price per share, read as `reading`. */
function readOptionLot(quantity: number, price: number | null, reading: OptionReading): { contracts: number; perShare: number | null } {
    const contracts = reading === "shares" ? quantity / OPTION_POSITION_MULTIPLIER : quantity;
    const perShare = price == null ? null : reading === "per-contract" ? price / OPTION_POSITION_MULTIPLIER : price;
    return { contracts, perShare };
}

/** A price to read and check against: a positive one. */
function positivePrice(price: number | null | undefined): number | null {
    return price != null && Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * The readings of an option holding in whole contracts whose worth comes to
 * the value the institution reports. Shares at a price per share and as
 * many contracts at a price per contract are worth the same, so a whole
 * number of hundreds reads both ways, which accountHoldings settles for the
 * contract as a whole. Without a price and a value to check against, only
 * whole hundreds of shares read. `value` is Plaid's institution_value as
 * reported, never one worked out from the quantity and price, which every
 * reading would agree with.
 */
export function optionLotReadings(
    quantity: number,
    price: number | null | undefined,
    value: number | null | undefined,
): OptionReading[] {
    if (!Number.isFinite(quantity)) return [];
    const perShare = positivePrice(price);
    const worth = value != null && Number.isFinite(value) ? Math.abs(value) : null;
    if (perShare == null || worth == null) return whole(quantity / OPTION_POSITION_MULTIPLIER) ? ["shares"] : [];
    return OPTION_READINGS.filter((reading) => {
        const lot = readOptionLot(quantity, perShare, reading);
        return whole(lot.contracts) && near(Math.abs(lot.contracts) * OPTION_POSITION_MULTIPLIER * (lot.perShare ?? 0), worth);
    });
}

/** A contract's stored close per share, and the session it's from (option_marks). */
export interface StoredOptionClose {
    close: number;
    /** YYYY-MM-DD; null when the database doesn't say. */
    date: string | null;
}

/**
 * What else says how an institution prices its options, for a contract
 * whose lots read two ways: the database's prices, looked up for the
 * contracts a holdings response has (optionContractsIn), and how the last
 * sync read them.
 */
export interface OptionPriceEvidence {
    /** Each contract's stored close (option_marks), by contract (O:ACME270115C00150000). */
    contractCloses?: ReadonlyMap<string, StoredOptionClose>;
    /** Each underlying's latest stored close, by ticker. */
    underlyingPrices?: ReadonlyMap<string, number>;
    /**
     * The day of an institution's price Plaid doesn't date: the last session
     * that ended by the sync, as the sync stores it. A stored close is
     * checked against an undated price only with it.
     */
    undatedPriceDay?: string;
    /**
     * The contracts of the option positions an earlier sync wrote (source
     * "plaid"), by Plaid's account_id, then by contract: the reading that
     * sync read the lots in. A close too far from the price's session to
     * settle the reading keeps that one, and no other (contractReading).
     */
    syncedContracts?: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

/** One lot of an option contract, as Plaid reports it. */
interface OptionLot {
    name: string;
    quantity: number;
    /** The institution's price as reported, per share or per contract. */
    price: number | null;
    readings: OptionReading[];
    /** |cost basis|, when Plaid reports one. */
    cost: number | null;
    priceDate: string | null;
}

/** One contract's lots in the account. */
interface ContractLots {
    details: OptionContract;
    lots: OptionLot[];
}

/**
 * The order a contract's lots are read in, whatever order Plaid lists them
 * in: those with a price first, the newest price first, then the lowest. A
 * price Plaid doesn't date is as of `undatedPriceDay`, as the sync dates
 * it, or the newest without that day. The first lot's price is the one the
 * readings are checked against (contractReading), and the one the row
 * keeps, with its day.
 */
function lotOrder(undatedPriceDay: string | undefined): (a: OptionLot, b: OptionLot) => number {
    const day = (lot: OptionLot) => lot.priceDate ?? undatedPriceDay ?? null;
    return (a, b) => {
        if ((a.price == null) !== (b.price == null)) return a.price == null ? 1 : -1;
        const [dayA, dayB] = [day(a), day(b)];
        if (dayA !== dayB) return dayA == null ? -1 : dayB == null ? 1 : dayB.localeCompare(dayA);
        return (a.price ?? 0) - (b.price ?? 0);
    };
}

/** The readings every lot of a contract reads in. */
function sharedReadings(lots: readonly Pick<OptionLot, "readings">[]): OptionReading[] {
    return OPTION_READINGS.filter((reading) => lots.every((lot) => lot.readings.includes(reading)));
}

/**
 * Whether an option could be priced at `perShare` a share: a put never above
 * its strike; given its underlying's price, a call never above it, and
 * neither well under what it's worth exercised. The underlying's price may
 * be another day's than the option's, so those allow for it.
 */
function couldBePriced(perShare: number, { contractType, strike }: OptionContract, underlying: number | null): boolean {
    if (contractType === "put" && perShare > strike * 1.02 + 0.05) return false;
    if (underlying == null) return true;
    if (contractType === "call" && perShare > underlying * 1.25 + 0.05) return false;
    const exercised = contractType === "call" ? underlying - strike : strike - underlying;
    return !(exercised > 0 && perShare < exercised * 0.75 - 0.05);
}

/**
 * Within three times of a stored close. The readings are a hundred times
 * apart, so at most one is. An option that moved between three and about 33
 * times since its close is near neither, but one that moved between about
 * 33 and 300 times is near the other reading, the wrong one: so only a close
 * from about the price's session is asked (closeForPriceDay).
 */
function nearClose(perShare: number, close: number): boolean {
    return Math.abs(Math.log10(perShare / close)) < Math.log10(3);
}

/** The session a day's price is from: the day itself when the market traded, else the last day it did. */
function sessionOf(day: string): string {
    return getMarketDay(day).isTradingDay ? day : previousTradingDay(day);
}

/**
 * A contract's stored close, when it's from about the session of the price
 * it's checked against (`priceDay`): from two sessions before it to one
 * after. The institution's price and the nightly close can be a session
 * apart either way, and the close the nightly sync has is two sessions
 * before its price: the sync runs before the prices job, and Massive's free
 * plan publishes a session's bars after midnight Eastern, so that job
 * stores the session before its own. Null otherwise, or when either has no
 * day. option_marks keeps a close until a newer one arrives, so an illiquid
 * contract's can be weeks old, and in that time an option can move far
 * enough for its close to fit the wrong reading (nearClose).
 */
function closeForPriceDay(stored: StoredOptionClose | undefined, priceDay: string | null): number | null {
    const close = positivePrice(stored?.close);
    if (close == null || !stored?.date || !isCalendarDate(stored.date) || priceDay == null) return null;
    try {
        const closed = sessionOf(stored.date);
        const priced = sessionOf(priceDay);
        const before = previousTradingDay(priced);
        return [priced, before, previousTradingDay(before)].includes(closed) || previousTradingDay(closed) === priced ? close : null;
    } catch {
        // A day before the market calendar starts, far too old to say anything.
        return null;
    }
}

/**
 * Whether the account's synced row for a contract, of `synced` contracts,
 * is in `reading`: within ten times of the contracts the lots read as in
 * it. A contract's two readings are a hundred times apart, so the row is in
 * one at most, and contracts bought or sold since the sync that wrote it
 * don't take it out of that one.
 */
function syncedIn(lots: readonly OptionLot[], reading: OptionReading, synced: number | null): boolean {
    if (synced == null || !Number.isFinite(synced) || synced === 0) return false;
    const contracts = lots.reduce((sum, lot) => sum + Math.round(readOptionLot(lot.quantity, lot.price, reading).contracts), 0);
    const ratio = contracts / synced;
    return ratio > 0.1 && ratio < 10;
}

/**
 * The one reading of a contract's lots: the one each of them reads in. Lots
 * in whole hundreds read both as shares at a price per share and as that
 * many contracts at a price per contract, a hundred times as many. Plaid's
 * shares stand unless something says otherwise: a price per share the
 * option can't have (a put's above its strike, a call's above its
 * underlying's price, either's well under what it's worth exercised), its
 * stored close from about the session of its price (closeForPriceDay), or
 * the institution pricing its other contracts per contract. A close from
 * further off (`distantClose`) changes nothing, but keeps the reading the
 * account's synced row is in when it's near that one (`synced`, its
 * contracts). Null when the lots don't agree, or what says how they read
 * disagrees, so a guess is never stored.
 */
function contractReading(
    { details, lots }: ContractLots,
    { close, distantClose, synced, underlying, pricesPerContract }: {
        close: number | null;
        distantClose: number | null;
        synced: number | null;
        underlying: number | null;
        pricesPerContract: boolean;
    },
): OptionReading | null {
    const fits = sharedReadings(lots);
    if (fits.length <= 1) return fits[0] ?? null;
    // Each lot reads more than one way, so each has a price.
    const price = lots[0].price ?? 0;
    const perShare = (reading: OptionReading) => readOptionLot(1, price, reading).perShare ?? 0;
    const readingNear = (storedClose: number | null) =>
        (storedClose == null ? null : fits.find((reading) => nearClose(perShare(reading), storedClose)) ?? null);
    const byClose = readingNear(close);
    let possible = fits.filter((reading) => couldBePriced(perShare(reading), details, underlying));
    // An underlying's price of another day can rule both out; a put's strike still bounds it.
    if (possible.length === 0) possible = fits.filter((reading) => couldBePriced(perShare(reading), details, null));
    if (byClose) return possible.includes(byClose) ? byClose : null;
    if (possible.length === 1) return possible[0];
    // A close too far off to settle the contract still keeps the reading the
    // account's synced row is in. The prices job checks a few contracts a run,
    // and one that doesn't trade keeps its close, so without this a row a
    // close read per contract would go back to Plaid's shares, a hundred times
    // fewer contracts, each night its close isn't refreshed. It never turns a
    // row into the other reading.
    const kept = readingNear(distantClose);
    if (kept && possible.includes(kept) && syncedIn(lots, kept, synced)) return kept;
    if (pricesPerContract && possible.includes("per-contract")) return "per-contract";
    return possible.includes("shares") ? "shares" : possible[0] ?? null;
}

/**
 * Whether the institution prices options per contract: a contract it holds
 * reads only as contracts at a price per contract, and none only as
 * contracts at a price per share. Only contracts a symbol confirms are
 * asked: one without may be an adjusted contract, delivering other than
 * 100 shares, which can read as priced per contract when it isn't.
 */
function institutionPricesPerContract(holdings: readonly PlaidHolding[], bySecurity: ReadonlyMap<string, PlaidSecurity>): boolean {
    const contracts = new Map<string, { readings: OptionReading[] }[]>();
    for (const holding of holdings) {
        const security = bySecurity.get(holding.security_id);
        if (!isOption(security) || holding.quantity === 0 || !inUsd(holding)) continue;
        const read = plaidOptionContract(security!);
        if (!read?.standard) continue;
        const lots = contracts.get(read.contract) ?? [];
        lots.push({ readings: optionLotReadings(holding.quantity, holding.institution_price, holding.institution_value) });
        contracts.set(read.contract, lots);
    }
    const only = [...contracts.values()].map(sharedReadings).filter((fits) => fits.length === 1).map((fits) => fits[0]);
    return only.includes("per-contract") && !only.includes("contracts");
}

/**
 * Each ticker's price the holdings response gives, for an option's
 * underlying the account holds: the institution's, as of the same day as
 * its options' prices.
 */
function institutionPrices(holdings: readonly PlaidHolding[], bySecurity: ReadonlyMap<string, PlaidSecurity>): Map<string, number> {
    const prices = new Map<string, number>();
    for (const holding of holdings) {
        const security = bySecurity.get(holding.security_id);
        const price = positivePrice(holding.institution_price);
        if (!security?.ticker_symbol || isOption(security) || isCash(security) || price == null || !inUsd(holding)) continue;
        const symbol = normalizeTicker(security.ticker_symbol);
        if (symbol && !prices.has(symbol)) prices.set(symbol, price);
    }
    return prices;
}

/** The day of the institution's price: a string that starts with a real date. */
function priceDay(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const day = raw.trim().slice(0, 10);
    return isCalendarDate(day) ? day : null;
}

/** How many holdings were left out for each reason. */
export function skippedByReason(skipped: readonly { reason: HoldingSkipReason }[]): Partial<Record<HoldingSkipReason, number>> {
    const counts: Partial<Record<HoldingSkipReason, number>> = {};
    for (const { reason } of skipped) counts[reason] = (counts[reason] ?? 0) + 1;
    return counts;
}

/**
 * One account's holdings as Atlas keeps them: a row per ticker (Plaid's
 * lots of one security combined), an option position per contract (its
 * lots combined), cash and cash equivalents as the account's cash, and the
 * rest counted as not brought in.
 *
 * An option's premium is its cost basis per share; without one, it is held
 * at the institution's price, as a stock is. A contract's lots are read
 * together, in the one reading each of them fits (contractReading), with
 * `evidence` from the database for lots that read two ways. An option
 * whose details or number of contracts can't be read is left out and its
 * contract kept (optionsKept), so a sync never changes or deletes a
 * position on a guess.
 */
export function accountHoldings(
    accountId: string,
    holdings: readonly PlaidHolding[],
    securities: readonly PlaidSecurity[],
    evidence: OptionPriceEvidence = {},
): AccountHoldings {
    const bySecurity = new Map(securities.map((s) => [s.security_id, s]));
    const positions = new Map<string, SyncedPosition & { cost: number; costKnown: boolean }>();
    const skipped: AccountHoldings["skipped"] = [];
    const valued = new Map<string, InstitutionValuedHolding>();
    const options = new Map<string, ContractLots>();
    // Contracts with a lot that couldn't be read: none of it is written,
    // and what an earlier sync wrote for them stays.
    const unread = new Set<string>();
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
        if (isOption(security)) {
            if (holding.quantity === 0) continue;
            const read = plaidOptionContract(security!);
            const readings = read ? optionLotReadings(holding.quantity, holding.institution_price, holding.institution_value) : [];
            if (!read || readings.length === 0) {
                skipped.push({ reason: "option", name });
                const key = read?.contract ?? symbolContract(security!);
                if (key) unread.add(key);
                continue;
            }
            // Read once all of the contract's lots are in, after this loop.
            const lot: OptionLot = {
                name,
                quantity: holding.quantity,
                price: positivePrice(holding.institution_price),
                readings,
                cost: holding.cost_basis != null && Number.isFinite(holding.cost_basis) && holding.cost_basis !== 0 ? Math.abs(holding.cost_basis) : null,
                priceDate: priceDay(holding.institution_price_as_of),
            };
            const contract = options.get(read.contract);
            if (contract) contract.lots.push(lot);
            else options.set(read.contract, { details: read.details, lots: [lot] });
            continue;
        }
        const symbol = security?.ticker_symbol ? normalizeTicker(security.ticker_symbol) : null;
        if (!symbol) {
            // Valued by the institution, it still counts; with no value, it can't.
            if (!(value > 0) || holding.quantity < 0) {
                skipped.push({ reason: "no-ticker", name });
                continue;
            }
            const existing = valued.get(holding.security_id);
            const cost = holding.cost_basis != null && holding.cost_basis > 0 ? holding.cost_basis : null;
            const priceDate = priceDay(holding.institution_price_as_of);
            if (existing) {
                existing.value += value;
                existing.quantity = existing.quantity != null && holding.quantity > 0 ? existing.quantity + holding.quantity : existing.quantity;
                existing.costBasis = existing.costBasis != null && cost != null ? existing.costBasis + cost : null;
                // Lots valued on different days add up to a value no newer
                // than the oldest of them.
                if (priceDate != null && (existing.priceDate == null || priceDate < existing.priceDate)) existing.priceDate = priceDate;
            } else {
                valued.set(holding.security_id, {
                    externalId: holding.security_id,
                    name: name.slice(0, 120),
                    identifier: security?.cusip?.trim().slice(0, 40) || null,
                    quantity: holding.quantity > 0 ? holding.quantity : null,
                    value,
                    costBasis: cost,
                    priceDate,
                });
            }
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

    // What settles a contract whose lots read two ways: how the institution
    // prices its other contracts, and the underlying's price it reports,
    // else the latest stored close.
    const pricesPerContract = institutionPricesPerContract(holdings, bySecurity);
    const underlyingPrices = institutionPrices(holdings, bySecurity);
    const syncedContracts = evidence.syncedContracts?.get(accountId);
    const synced: { option: SyncedOptionContract; costKnown: boolean; label: string }[] = [];
    for (const [contract, held] of options) {
        // The newest price first, so the lots read the same in any order Plaid lists them.
        held.lots.sort(lotOrder(evidence.undatedPriceDay));
        const leaveOut = () => {
            for (const lot of held.lots) skipped.push({ reason: "option", name: lot.name });
            unread.add(contract);
        };
        if (unread.has(contract)) {
            leaveOut();
            continue;
        }
        const { underlying } = held.details;
        const stored = evidence.contractCloses?.get(contract);
        // The readings are checked against the newest price, the first lot's: a close counts only from about its day.
        const close = closeForPriceDay(stored, held.lots[0].priceDate ?? evidence.undatedPriceDay ?? null);
        const reading = contractReading(held, {
            close,
            distantClose: close == null ? positivePrice(stored?.close) : null,
            synced: syncedContracts?.get(contract) ?? null,
            underlying: underlyingPrices.get(underlying) ?? positivePrice(evidence.underlyingPrices?.get(underlying)),
            pricesPerContract,
        });
        // Lots that don't read the same way, or evidence that disagrees.
        if (reading == null) {
            leaveOut();
            continue;
        }
        let contracts = 0;
        let cost = 0;
        let costKnown = true;
        let long = false;
        let short = false;
        let perShare: number | null = null;
        let priceDate: string | null = null;
        for (const lot of held.lots) {
            const read = readOptionLot(lot.quantity, lot.price, reading);
            const lotContracts = Math.round(read.contracts);
            contracts += lotContracts;
            cost += lot.cost ?? 0;
            costKnown &&= lot.cost != null;
            long ||= lotContracts > 0;
            short ||= lotContracts < 0;
            // The price and its day come from the same lot: the newest price (lotOrder).
            if (perShare == null && read.perShare != null) {
                perShare = read.perShare;
                priceDate = lot.priceDate;
            }
        }
        // Long and short lots that cancel out: the account holds none.
        if (contracts === 0) continue;
        // Costs read only while every lot is on the same side.
        costKnown &&= !(long && short);
        const premium = costKnown ? cost / (Math.abs(contracts) * OPTION_POSITION_MULTIPLIER) : perShare;
        // The option-position form's bounds, which the row is edited against
        // once the account no longer syncs.
        if (premium == null || Math.abs(contracts) > 1e6 || premium > 1e6) {
            leaveOut();
            continue;
        }
        const price = perShare == null ? null : round(perShare, 6);
        synced.push({
            option: {
                contract,
                ...held.details,
                quantity: contracts,
                premium: round(premium, 6),
                price,
                priceDate: price == null ? null : priceDate,
            },
            costKnown,
            label: describeOptionContract(held.details),
        });
    }
    synced.sort((a, b) => a.option.contract.localeCompare(b.option.contract));

    const rows = [...positions.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
    return {
        positions: rows.map(({ symbol, name, quantity, cost, price }) => ({
            symbol,
            name,
            quantity: round(quantity, 6),
            avgCost: round(cost / quantity, 6),
            price,
        })),
        institutionValued: [...valued.values()]
            .map((v) => ({
                ...v,
                value: round(v.value, 2),
                quantity: v.quantity == null ? null : round(v.quantity, 6),
                costBasis: v.costBasis == null ? null : round(v.costBasis, 2),
            }))
            .sort((a, b) => a.name.localeCompare(b.name) || a.externalId.localeCompare(b.externalId)),
        cashUsd: round(cashUsd, 2),
        options: synced.map((o) => o.option),
        optionsKept: [...unread].sort(),
        skipped,
        costUnknown: [
            ...rows.filter((p) => !p.costKnown).map((p) => p.symbol),
            ...synced.filter((o) => !o.costKnown).map((o) => o.label),
        ],
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

/** Why a transaction wasn't recorded; "option" is a trade, move or dividend of an option or warrant. */
export type TransactionSkipReason = "not-recorded" | "no-symbol" | "option" | "other-currency" | "cash-sweep" | "invalid";

export type MappedTransaction =
    | { row: TransactionRow & { externalId: string } }
    | { skipped: TransactionSkipReason };

/**
 * Plaid's transfer subtypes that move shares into or out of the account
 * without a trade: an RSU vest arrives as one, shares moved from another
 * broker as another. Corporate actions (a split, a merger, a spin-off) and
 * option exercises change what a position is, not whether shares arrived,
 * and aren't recorded.
 */
const SHARE_TRANSFER_SUBTYPES: ReadonlySet<string> = new Set(["transfer", "send", "request", "stock distribution"]);

/** A transfer's description that says it is equity compensation vesting. */
const VEST_NOTE = /\b(vest(ed|ing)?|rsu|restricted stock|(shares?|stock) released?|released shares)\b/i;

/**
 * Atlas's type for a Plaid type and subtype; null for what it doesn't
 * record. A share transfer's direction comes from its quantity (positive
 * is shares in) and whether it is a vest from its description.
 */
export function transactionTypeForPlaid(
    type: string,
    subtype: string | null | undefined,
    { quantity = null, name = null }: { quantity?: number | null; name?: string | null } = {},
): TransactionRow["type"] | null {
    const t = type.trim().toLowerCase();
    const sub = (subtype ?? "").trim().toLowerCase();
    if (t === "buy") return "BUY";
    if (t === "sell") return "SELL";
    if (t === "fee") return "FEE";
    if (t === "cash") return CASH_SUBTYPES[sub] ?? null;
    if (t === "transfer" && SHARE_TRANSFER_SUBTYPES.has(sub) && quantity != null && quantity !== 0) {
        if (quantity < 0) return "TRANSFER_OUT";
        return VEST_NOTE.test(name ?? "") ? "VEST" : "TRANSFER_IN";
    }
    // A cancel, a corporate action, and a transfer with no shares aren't recorded.
    return null;
}

/** A note from Plaid's description, without what the API refuses in text. */
function noteOf(raw: string | null | undefined): string | null {
    const note = (raw ?? "").replace(/[<>]/g, "").replace(/^[=+\-@\s]+/, "").trim().slice(0, TRANSACTION_LIMITS.notes);
    return note || null;
}

export function mapPlaidTransaction(transaction: PlaidInvestmentTransaction, security: PlaidSecurity | undefined): MappedTransaction {
    const type = transactionTypeForPlaid(transaction.type, transaction.subtype, { quantity: transaction.quantity, name: transaction.name });
    if (!type) return { skipped: "not-recorded" };
    // Kept in its currency (CAD, EUR); an unofficial one (a coin) isn't a currency.
    if (transaction.unofficial_currency_code) return { skipped: "other-currency" };

    const trade = type === "BUY" || type === "SELL";
    const moved = type === "VEST" || type === "TRANSFER_IN" || type === "TRANSFER_OUT";
    // A cash equivalent with a ticker (a money market sweep, SPAXX) is cash
    // in the holdings: buying or selling it moves cash within the account,
    // not into a position, but its dividends are income from that fund.
    const sweep = security?.is_cash_equivalent === true && security.type !== "cash";
    if (sweep && (trade || moved)) return { skipped: "cash-sweep" };
    // Option trades aren't recorded (the positions come from the holdings):
    // never as a trade of a ticker Plaid gives the contract. A fee charged
    // on one still is.
    if ((trade || moved || type === "DIVIDEND") && security && isOption(security)) return { skipped: "option" };
    // Currency itself ("CUR:USD") has no ticker to keep.
    const symbol = security?.ticker_symbol && security.type !== "cash" ? normalizeTicker(security.ticker_symbol) : null;
    if ((trade || moved || type === "DIVIDEND") && !symbol) return { skipped: "no-symbol" };

    const quantity = transaction.quantity != null ? Math.abs(transaction.quantity) : null;
    const amount = transaction.amount != null ? Math.abs(transaction.amount) : null;
    const fees = transaction.fees != null && transaction.fees > 0 ? round(transaction.fees, 2) : null;
    // A share move's price, when Plaid has one, is what each share was
    // worth that day; its amount is usually 0 (no cash moved), so its value
    // comes from quantity × price instead.
    const movedPrice = transaction.price != null && transaction.price > 0 ? round(transaction.price, 6) : null;
    const candidate = {
        type,
        date: transaction.date,
        symbol: trade || moved || type === "DIVIDEND" ? symbol : null,
        quantity: trade || moved ? (quantity ? round(quantity, 6) : null) : null,
        price: trade ? (transaction.price != null ? round(Math.abs(transaction.price), 6) : null) : moved ? movedPrice : null,
        amount: moved ? null : amount ? round(amount, 2) : null,
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
