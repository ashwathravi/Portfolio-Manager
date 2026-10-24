import { normalizeTicker } from '@/lib/research/watchlist';

import { fitToHeader, normalizeHeader, parseNumber, readCsvRecords, type ParseIssue } from './csvImport';
import { TRADE_TYPES, type TransactionType } from './transactions';

/**
 * Transactions CSV import (launch item i40): reads a broker's activity or
 * history export into transactions the import API takes, for the user to
 * check before anything is written.
 *
 * Tolerant like the holdings import: brokers name columns differently
 * ("Run Date"/"Trade Date", "Action"/"Type"), describe the same thing in
 * words ("YOU BOUGHT", "Reinvest Dividend"), sign amounts both ways, and
 * add notes above and below the table. Anything that isn't clearly a
 * transaction becomes a listed issue, never a guessed number.
 */

export const MAX_TRANSACTION_ROWS = 2000;

export interface ParsedTransaction {
    type: TransactionType;
    date: string;
    symbol: string | null;
    quantity: number | null;
    price: number | null;
    amount: number | null;
    fees: number | null;
    currency: string;
    notes: string | null;
    /** The broker's own ID for it, when the file has one. */
    externalId?: string;
}

export interface TransactionParseResult {
    rows: ParsedTransaction[];
    issues: ParseIssue[];
    /** Blank, note and total rows ignored on purpose. */
    skipped: number;
}

const HEADER_ALIASES = {
    date: ['date', 'trade date', 'run date', 'transaction date', 'activity date', 'process date'],
    action: ['action', 'type', 'transaction type', 'activity', 'transaction', 'activity type'],
    symbol: ['symbol', 'ticker', 'sym', 'security symbol'],
    quantity: ['quantity', 'qty', 'shares', 'units'],
    price: ['price', 'price ($)', 'share price', 'price per share', 'unit price'],
    // The cash that moved: a buy's includes its fees, a sell's is after them.
    amount: ['amount', 'amount ($)', 'net amount', 'total amount', 'total'],
    // Quantity × price, before fees.
    gross: ['value', 'gross amount', 'principal amount', 'principal', 'trade value'],
    fees: ['fees', 'fee', 'fees ($)', 'commission', 'commissions', 'commission ($)', 'fees & comm', 'fees & commissions'],
    id: ['transaction id', 'reference', 'reference number', 'ref', 'confirmation', 'confirmation number', 'id'],
    currency: ['currency', 'ccy'],
    description: ['description', 'security description', 'name', 'security'],
} as const satisfies Record<string, readonly string[]>;

type Column = keyof typeof HEADER_ALIASES;

function findColumn(headers: string[], key: Column): number {
    const aliases: readonly string[] = HEADER_ALIASES[key];
    return headers.findIndex((h) => aliases.includes(h));
}

/**
 * What a broker's action text means. Order matters: a reinvested dividend
 * is the dividend coming in ("Reinvest Dividend"); the reinvestment itself
 * is a buy ("Reinvest Shares", "REINVESTMENT"), and "dividend" alone is
 * the cash.
 */
const ACTIONS: ReadonlyArray<[RegExp, TransactionType]> = [
    [/\breinvest(ed)?\s+(dividend|div)\b/i, 'DIVIDEND'],
    [/\breinvest/i, 'BUY'],
    [/\b(buy|bought|purchase)\b/i, 'BUY'],
    [/\b(sell|sold|sale)\b/i, 'SELL'],
    [/\b(dividend|div)\b/i, 'DIVIDEND'],
    [/\binterest\b/i, 'INTEREST'],
    [/\b(deposit|contribution|transfer in|funds received|ach in|electronic funds transfer received)\b/i, 'DEPOSIT'],
    [/\b(withdrawal|distribution|transfer out|funds paid|ach out|disbursement)\b/i, 'WITHDRAWAL'],
    [/\b(fee|commission)\b/i, 'FEE'],
];

export function transactionTypeFor(action: string): TransactionType | null {
    for (const [pattern, type] of ACTIONS) if (pattern.test(action)) return type;
    return null;
}

/** "2026-03-05", "03/05/2026", "3/5/26", "03/05/2026 as of 03/04/2026" → "2026-03-05"; null otherwise. */
export function parseTradeDate(raw: string): string | null {
    const s = raw.trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(s);
    let y: number, m: number, d: number;
    if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    else if (us) [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3].length === 2 ? `20${us[3]}` : us[3])];
    else return null;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return date.toISOString().slice(0, 10);
}

// "Total", "Account Total", "Transactions Total", balance lines.
const SUMMARY = /(\btotals?\b|^ending balance|^beginning balance)/i;

export function parseTransactionsCsv(text: string): TransactionParseResult {
    const records = readCsvRecords(text.replace(/^﻿/, ''));
    const issues: ParseIssue[] = [];
    let skipped = 0;

    // Exports often put account details above the table: the header is the
    // first line that names a date column and an action column.
    let headerIndex = -1;
    let headers: string[] = [];
    for (let i = 0; i < Math.min(records.length, 20); i++) {
        if (records[i].error) continue;
        const candidate = records[i].cells.map(normalizeHeader);
        if (findColumn(candidate, 'date') >= 0 && findColumn(candidate, 'action') >= 0) {
            headerIndex = i;
            headers = fitToHeader(candidate, 0) ?? candidate;
            break;
        }
    }
    if (headerIndex < 0) {
        return { rows: [], issues: [{ line: 1, message: 'No header row with a Date and an Action (or Type) column was found.' }], skipped: 0 };
    }

    const col = Object.fromEntries((Object.keys(HEADER_ALIASES) as Column[]).map((key) => [key, findColumn(headers, key)])) as Record<Column, number>;
    // Commission and fees can be columns of their own: they add up.
    const feeColumns = headers.flatMap((h, i) => ((HEADER_ALIASES.fees as readonly string[]).includes(h) ? [i] : []));
    if (col.amount < 0 && col.gross < 0 && (col.quantity < 0 || col.price < 0)) {
        return {
            rows: [],
            issues: [{ line: records[headerIndex].line, message: 'Add an Amount column, or Quantity and Price columns, so each transaction has a value.' }],
            skipped: 0,
        };
    }

    const rows: ParsedTransaction[] = [];
    for (const record of records.slice(headerIndex + 1)) {
        const lineNo = record.line;
        if (record.error) {
            issues.push({ line: lineNo, message: record.error });
            continue;
        }
        if (record.cells.every((cell) => !cell.trim())) {
            skipped++;
            continue;
        }
        const cells = fitToHeader(record.cells, headers.length);
        if (!cells) {
            // Notes after the table (a single long cell) aren't transactions.
            if (record.cells.filter((cell) => cell.trim()).length <= 1) {
                skipped++;
                continue;
            }
            issues.push({ line: lineNo, message: `Expected ${headers.length} columns, found ${record.cells.length}.` });
            continue;
        }
        const cell = (key: Column) => (col[key] >= 0 ? (cells[col[key]] ?? '').trim() : '');

        const date = parseTradeDate(cell('date'));
        if (!date) {
            // A totals line, or a note or disclaimer under the table: no date,
            // and "Total" where the date or action would be, or nothing a
            // transaction would have. (A security named "... Total ..." in
            // a dated row is a transaction.)
            const total = SUMMARY.test(cell('date')) || SUMMARY.test(cell('action')) || SUMMARY.test((record.cells[0] ?? '').trim());
            const hasData = [cell('symbol'), cell('quantity'), cell('price'), cell('amount'), cell('gross')].some(Boolean);
            if (total || !hasData) {
                skipped++;
                continue;
            }
            issues.push({ line: lineNo, message: `“${cell('date')}” is not a date.` });
            continue;
        }
        const actionText = [cell('action'), cell('description')].filter(Boolean).join(' ');
        const type = transactionTypeFor(cell('action')) ?? transactionTypeFor(actionText);
        if (!type) {
            issues.push({ line: lineNo, message: `Can't tell what “${cell('action') || actionText}” is. Leave it out or change it to Buy, Sell, Dividend, Interest, Deposit, Withdrawal or Fee.` });
            continue;
        }

        const rawSymbol = cell('symbol').replace(/\*+$/, '');
        const symbol = rawSymbol ? normalizeTicker(rawSymbol) : null;
        if (rawSymbol && !symbol) {
            issues.push({ line: lineNo, message: `“${rawSymbol}” is not a ticker.` });
            continue;
        }
        if ((type === 'BUY' || type === 'SELL' || type === 'DIVIDEND') && !symbol) {
            issues.push({ line: lineNo, message: `${type === 'DIVIDEND' ? 'Dividend' : type === 'BUY' ? 'Buy' : 'Sell'} on ${date} has no symbol.` });
            continue;
        }

        // Brokers sign quantities and amounts by direction; the type says
        // that. An empty cell (or "--", "n/a") is no value; anything else
        // that isn't a number is an issue, never a silently dropped value.
        const unreadable: string[] = [];
        const numberIn = (raw: string, label: string): number | null => {
            const n = parseNumber(raw);
            if (n == null && raw.trim() && !/^(--|n\/?a)$/i.test(raw.trim())) unreadable.push(`“${raw.trim()}” in ${label}`);
            return n == null ? null : Math.abs(n);
        };
        const quantity = numberIn(cell('quantity'), headers[col.quantity] ?? 'quantity');
        const price = numberIn(cell('price'), headers[col.price] ?? 'price');
        const amount = numberIn(cell('amount'), headers[col.amount] ?? 'amount');
        const grossValue = numberIn(cell('gross'), headers[col.gross] ?? 'value');
        const feeValues = feeColumns.map((i) => numberIn(cells[i] ?? '', headers[i])).filter((n): n is number => n != null);
        const fees = feeValues.length > 0 ? feeValues.reduce((sum, n) => sum + n, 0) : null;
        if (unreadable.length > 0) {
            issues.push({ line: lineNo, message: `${unreadable.join(', ')} ${unreadable.length === 1 ? 'is' : 'are'} not a number.` });
            continue;
        }
        // No currency given is USD; one given that isn't a code is an issue.
        const currency = currencyOf(cell('currency'));
        if (currency == null) {
            issues.push({ line: lineNo, message: `“${cell('currency')}” in ${headers[col.currency]} is not a currency code, such as USD or CAD.` });
            continue;
        }
        // Room for one more, checked before adding it.
        if (rows.length >= MAX_TRANSACTION_ROWS) {
            issues.push({ line: lineNo, message: `Only ${MAX_TRANSACTION_ROWS} transactions can be imported at once. Split the file.` });
            break;
        }

        if (TRADE_TYPES.has(type)) {
            if (!quantity) {
                issues.push({ line: lineNo, message: `${symbol}: a ${type === 'BUY' ? 'buy' : 'sell'} needs a quantity.` });
                continue;
            }
            // A price from the file, or the value before fees over the
            // quantity: a gross column as it is, or the net amount with the
            // fees taken back out (a buy's includes them, a sell's is after).
            const gross = grossValue ?? (amount == null ? null : type === 'BUY' ? amount - (fees ?? 0) : amount + (fees ?? 0));
            const unit = price ?? (gross != null && gross > 0 ? gross / quantity : null);
            if (unit == null) {
                issues.push({ line: lineNo, message: `${symbol}: a ${type === 'BUY' ? 'buy' : 'sell'} needs a price or an amount.` });
                continue;
            }
            rows.push({
                type, date, symbol, quantity: round(quantity, 6), price: round(unit, 6),
                amount: amount != null && amount > 0 ? round(amount, 2) : null,
                fees: fees ? round(fees, 2) : null,
                currency,
                notes: noteOf(cell('description')),
                ...(cell('id') ? { externalId: cell('id') } : {}),
            });
        } else {
            const cash = amount ?? grossValue;
            if (!cash) {
                issues.push({ line: lineNo, message: `${type.charAt(0)}${type.slice(1).toLowerCase()} on ${date} has no amount.` });
                continue;
            }
            rows.push({
                type, date, symbol: type === 'DIVIDEND' ? symbol : symbol ?? null,
                quantity: type === 'DIVIDEND' && quantity ? round(quantity, 6) : null,
                price: null,
                amount: round(cash, 2),
                fees: fees ? round(fees, 2) : null,
                currency,
                notes: noteOf(cell('description')),
                ...(cell('id') ? { externalId: cell('id') } : {}),
            });
        }
    }
    return { rows, issues, skipped };
}

/**
 * A description kept as the transaction's note: without the characters the
 * API refuses in text (< and >, or a leading = + - @ that a spreadsheet
 * would run), and no longer than a note may be.
 */
function noteOf(raw: string): string | null {
    const note = raw.replace(/[<>]/g, '').replace(/^[=+\-@\s]+/, '').trim().slice(0, 500);
    return note || null;
}

/** An ISO code, USD for an empty cell (or "--", "n/a"), or null for anything else. */
function currencyOf(raw: string): string | null {
    const code = raw.trim().toUpperCase();
    if (!code || /^(--|N\/?A)$/.test(code)) return 'USD';
    return /^[A-Z]{3}$/.test(code) ? code : null;
}

function round(n: number, places: number): number {
    const f = 10 ** places;
    return Math.round(n * f) / f;
}
