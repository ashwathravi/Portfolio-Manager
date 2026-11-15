/**
 * Option positions (launch item i63): the contracts the user holds, entered
 * by hand or imported from a broker's positions CSV, as the LEAPS ledger
 * and the risk policy read them. Browser-safe: naming a contract the way
 * Massive does, reading one the ways brokers write it, and choosing the
 * price a position is marked at.
 */

import type { OptionContractType, OptionRiskPosition } from "@/lib/risk-policy/options";

export const OPTION_POSITION_MULTIPLIER = 100;

export interface OptionContract {
    underlying: string;
    contractType: OptionContractType;
    strike: number;
    /** YYYY-MM-DD. */
    expiry: string;
}

/** Massive's ticker for a contract: O:AAPL270115C00250000 (strike × 1000, eight digits). */
export function optionContractTicker({ underlying, contractType, strike, expiry }: OptionContract): string {
    const root = underlying.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const date = expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10);
    const strikeCode = String(Math.round(strike * 1000)).padStart(8, "0");
    return `O:${root}${date}${contractType === "call" ? "C" : "P"}${strikeCode}`;
}

/** The contract as people read it: AAPL Jan 15 2027 250 call. */
export function describeOptionContract({ underlying, contractType, strike, expiry }: OptionContract): string {
    const [year, month, day] = expiry.split("-").map(Number);
    return `${underlying} ${MONTHS[month - 1] ?? "?"} ${day} ${year} ${formatStrike(strike)} ${contractType}`;
}

export function formatStrike(strike: number): string {
    return Number.isInteger(strike) ? String(strike) : String(Number(strike.toFixed(3)));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const ROOT = "([A-Z][A-Z0-9.]{0,5})";
const STRIKE = "(\\d+(?:\\.\\d+)?)";

/** The ways brokers write a contract, as [pattern, reader]. */
const CONTRACT_FORMATS: ReadonlyArray<[RegExp, (m: RegExpMatchArray) => OptionContract | null]> = [
    // OCC, with or without the root padded to six and Massive's prefix:
    // "AAPL  270115C00250000", "O:AAPL270115C00250000".
    [new RegExp(`^(?:O:)?${ROOT}\\s*(\\d{2})(\\d{2})(\\d{2})([CP])(\\d{8})$`), (m) =>
        contract(m[1], m[5], Number(m[6]) / 1000, `20${m[2]}`, m[3], m[4])],
    // Fidelity: "-AAPL270115C250", "-SPY270115P550.5".
    [new RegExp(`^-?${ROOT}(\\d{2})(\\d{2})(\\d{2})([CP])${STRIKE}$`), (m) =>
        contract(m[1], m[5], Number(m[6]), `20${m[2]}`, m[3], m[4])],
    // Schwab: "AAPL 01/15/2027 250.00 C".
    [new RegExp(`^${ROOT}\\s+(\\d{1,2})/(\\d{1,2})/(\\d{4})\\s+${STRIKE}\\s+([CP])$`), (m) =>
        contract(m[1], m[6], Number(m[5]), m[4], m[2], m[3])],
    // Interactive Brokers: "AAPL 15JAN27 250 C".
    [new RegExp(`^${ROOT}\\s+(\\d{1,2})([A-Z]{3})(\\d{2})\\s+${STRIKE}\\s+([CP])$`), (m) =>
        contract(m[1], m[6], Number(m[5]), `20${m[4]}`, monthNumber(m[3]), m[2])],
    // E*TRADE: "AAPL Jan 15 '27 $250 Call".
    [new RegExp(`^${ROOT}\\s+([A-Z]{3})\\s+(\\d{1,2})\\s+'(\\d{2})\\s+\\$${STRIKE}\\s+(CALL|PUT)$`), (m) =>
        contract(m[1], m[6], Number(m[5]), `20${m[4]}`, monthNumber(m[2]), m[3])],
];

/**
 * Reads a contract from a broker's symbol for it, in the formats above;
 * null when `raw` isn't one (a stock ticker, or a date that doesn't exist).
 */
export function parseOptionContract(raw: string): OptionContract | null {
    const text = raw.trim().toUpperCase().replace(/\s+/g, " ");
    for (const [pattern, read] of CONTRACT_FORMATS) {
        const match = text.match(pattern);
        if (match) return read(match);
    }
    return null;
}

function monthNumber(name: string): string | undefined {
    const index = MONTHS.findIndex((m) => m.toUpperCase() === name);
    return index < 0 ? undefined : String(index + 1);
}

function contract(root: string, type: string, strike: number, year: string, month: string | undefined, day: string): OptionContract | null {
    if (!month) return null;
    const expiry = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (!isCalendarDate(expiry) || !isOptionStrike(strike)) return null;
    return {
        underlying: root.replace(/\.$/, ""),
        contractType: type.startsWith("C") ? "call" : "put",
        strike,
        expiry,
    };
}

/** A real YYYY-MM-DD date. */
export function isCalendarDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Above 0, under 100,000, and at most three decimals (OCC's precision). */
export function isOptionStrike(strike: number): boolean {
    return Number.isFinite(strike) && strike > 0 && strike < 100_000 && Math.abs(strike * 1000 - Math.round(strike * 1000)) < 1e-6;
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

/**
 * What a position is marked at: the newest of the stored close and the
 * user's own price (the close on a tie), else the premium paid, as a
 * position without a price counts at cost.
 */
export type OptionMark =
    | { source: "close"; price: number; date: string }
    | { source: "user"; price: number; date: string }
    | { source: "cost"; price: number };

export function chooseOptionMark({
    premium,
    close,
    closeDate,
    userMark,
    userMarkDate,
}: {
    premium: number;
    close?: number | null;
    closeDate?: string | null;
    userMark?: number | null;
    userMarkDate?: string | null;
}): OptionMark {
    const hasClose = close != null && Number.isFinite(close) && close >= 0 && Boolean(closeDate);
    const hasUser = userMark != null && Number.isFinite(userMark) && userMark >= 0 && Boolean(userMarkDate);
    if (hasClose && (!hasUser || closeDate! >= userMarkDate!)) return { source: "close", price: close!, date: closeDate! };
    if (hasUser) return { source: "user", price: userMark!, date: userMarkDate! };
    return { source: "cost", price: premium };
}

// ---------------------------------------------------------------------------
// The ledger's view
// ---------------------------------------------------------------------------

/** A position as the server loads it: the stored row with its account, mark and thesis. */
export interface LoadedOptionPosition extends OptionContract {
    id: string;
    portfolioId: string;
    account: string;
    contract: string;
    quantity: number;
    premium: number;
    multiplier: number;
    openedAt: string | null;
    userMark: number | null;
    userMarkDate: string | null;
    thesisId: string | null;
    /** The linked thesis's title; null when there is none, or it was deleted. */
    thesisTitle: string | null;
    expiryTest: string;
    exitRule: string;
    mark: OptionMark;
    /** The underlying's last price, when one is stored. */
    underlyingPrice: number | null;
}

/** The ledger and risk-policy view of a loaded position. */
export function toOptionRiskPosition(position: LoadedOptionPosition): OptionRiskPosition {
    return {
        id: position.id,
        underlying: position.underlying,
        contractType: position.contractType,
        strike: position.strike,
        expiry: position.expiry,
        quantity: position.quantity,
        premiumPaid: position.premium,
        currentPremium: position.mark.price,
        ...(position.underlyingPrice != null ? { underlyingPrice: position.underlyingPrice } : {}),
        contractMultiplier: position.multiplier,
        ...(position.thesisTitle ? { linkedThesisId: position.thesisId!, thesisTitle: position.thesisTitle } : {}),
        ...(position.expiryTest ? { whatMustBeTrueByExpiry: position.expiryTest } : {}),
        ...(position.exitRule ? { plannedExitRule: position.exitRule } : {}),
        account: position.account,
        ...(position.openedAt ? { openedAt: position.openedAt } : {}),
    };
}
