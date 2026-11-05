import { normalizeTicker } from '@/lib/research/watchlist';
import { describeOptionContract, OPTION_POSITION_MULTIPLIER, optionContractTicker, parseOptionContract, type OptionContract } from './option-positions';

/**
 * Holdings CSV import — the "Import CSV" path from the design review's
 * empty Holdings state. Parses a brokerage "positions" export into rows the
 * import API accepts, and plans what an import will change so the user sees
 * it before anything is written.
 *
 * Tolerant by design: brokers name columns differently ("Symbol"/"Ticker",
 * "Quantity"/"Shares", "Average Cost"/"Cost Basis Total"), wrap numbers in
 * quotes with $ and thousands separators, and append cash and total rows.
 * Anything that is not a clean position becomes a listed error, never a
 * silently guessed number.
 *
 * Option rows (launch item i63) go to the LEAPS ledger: a symbol in one of
 * the ways brokers write a contract (parseOptionContract), or a row the
 * file marks as an option whose description names one. Quantity is in
 * contracts, negative for a written position; the premium is per share, as
 * brokers quote it: the total cost basis ÷ (100 × contracts), or else the
 * average cost, read as per share.
 */

export const MAX_IMPORT_ROWS = 1000;

export interface ImportRow {
    symbol: string;
    name: string;
    quantity: number;
    /** Average cost per share. */
    avgCost: number;
}

export interface ParseIssue {
    /** 1-based line number in the file. */
    line: number;
    message: string;
}

/** An option position read from the file: the contract, how many, and the premium per share. */
export interface OptionImportRow extends OptionContract {
    /** Contracts; negative for a written position. */
    quantity: number;
    premium: number;
}

export interface ParseResult {
    rows: ImportRow[];
    /** The file's option positions, for the LEAPS ledger. */
    options: OptionImportRow[];
    issues: ParseIssue[];
    /** Cash, total, and blank rows ignored on purpose. */
    skipped: number;
}

const HEADER_ALIASES: Record<'symbol' | 'quantity' | 'avgCost' | 'costBasis' | 'name' | 'assetType', readonly string[]> = {
    symbol: ['symbol', 'ticker', 'sym', 'security symbol'],
    quantity: ['quantity', 'qty', 'shares', 'units', 'position'],
    avgCost: ['avg cost', 'average cost', 'avg price', 'average price', 'cost/share', 'cost per share', 'unit cost', 'price paid', 'avg cost basis', 'average cost basis'],
    costBasis: ['cost basis', 'cost basis total', 'total cost', 'cost basis ($)', 'book value'],
    assetType: ['asset type', 'asset class', 'security type', 'position type'],
    name: ['description', 'name', 'security', 'security name', 'security description'],
};

// The ** suffix is an explicit broker core-position marker, not a ticker.
const CORE_POSITION = /^(spaxx|fdrxx|core)\*\*$/i;
const OPTION_ASSET_TYPE = /^(option|options|equity option|equity options|call|put|listed option)s?$/i;
const SUMMARY_SYMBOL = /^(pending|pending activity|account total|total|--)$/i;

export function normalizeHeader(h: string): string {
    return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface CsvRecord {
    cells: string[];
    /** First physical line of the complete record. */
    line: number;
    error?: string;
}

/** Read record boundaries only outside quoted fields, preserving embedded CR/LF. */
export function readCsvRecords(text: string): CsvRecord[] {
    const records: CsvRecord[] = [];
    let cells: string[] = [];
    let field = '';
    let state: 'unquoted' | 'quoted' | 'closed' = 'unquoted';
    let line = 1;
    let recordLine = 1;
    let error: string | undefined;
    const finishField = () => {
        cells.push(field.trim());
        field = '';
        state = 'unquoted';
    };
    const finishRecord = () => {
        finishField();
        records.push({ cells, line: recordLine, error });
        cells = [];
        error = undefined;
    };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const newline = c === '\r' || c === '\n';
        if (state === 'quoted') {
            if (c === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') {
                state = 'closed';
            } else {
                field += c;
                if (newline) {
                    if (c === '\r' && text[i + 1] === '\n') field += text[++i];
                    line++;
                }
            }
        } else if (newline) {
            finishRecord();
            if (c === '\r' && text[i + 1] === '\n') i++;
            recordLine = ++line;
        } else if (c === ',') {
            finishField();
        } else if (state === 'closed') {
            if (!/\s/.test(c)) error ??= 'Unexpected text after a closing quote.';
        } else if (c === '"') {
            if (field.trim()) {
                error ??= 'Unexpected quote in an unquoted field.';
            } else {
                field = '';
                state = 'quoted';
            }
        } else {
            field += c;
        }
    }
    if (state === 'quoted') error = 'Unterminated quoted field.';
    finishRecord();
    return records;
}

/** Splits one complete CSV record; malformed quoting is rejected. */
export function splitCsvLine(line: string): string[] {
    const records = readCsvRecords(line);
    if (records.length !== 1 || records[0].error) {
        throw new Error(records[0].error ?? 'Expected one CSV record.');
    }
    return records[0].cells;
}

function isCashRow(cells: string[], col: { symbol: number; name: number; quantity: number; assetType: number }): boolean {
    const symbol = cells[col.symbol] ?? '';
    const assetType = normalizeHeader(cells[col.assetType] ?? '');
    if (['cash', 'cash balance', 'currency'].includes(assetType)) return true;
    if (CORE_POSITION.test(symbol)) return true;
    // A cash label that can't be a ticker, e.g. Schwab's "Cash & Cash Investments".
    if (/^cash\b/i.test(symbol) && !normalizeTicker(symbol)) return true;
    if (assetType) return false;
    // A generic CASH symbol alone is ambiguous. A balance label and no share
    // quantity identify a balance row; priced securities named CASH still import.
    return /^cash$/i.test(symbol)
        && /^(cash balance|cash & cash equivalents|cash and cash equivalents)$/i.test(cells[col.name] ?? '')
        && /^(|--|n\/?a)$/i.test(cells[col.quantity] ?? '');
}

/**
 * A broker footer or note: a record with one non-empty cell, either outside
 * the symbol column ("Total" under Account Number) or in it but not a ticker
 * ("Date downloaded 10/13/2026"). A lone ticker is a broken row, not a note.
 */
function isNoteRow(cells: string[], symbolColumn: number): boolean {
    const filled = cells.flatMap((cell, index) => (cell ? [index] : []));
    if (filled.length !== 1) return false;
    if (filled[0] !== symbolColumn) return true;
    return !normalizeTicker(cells[symbolColumn].replace(/\*+$/, ''));
}

/**
 * Lines a record up with the header. Trailing empty cells (a comma at the end
 * of every line) are dropped and short records are padded, since writers may
 * omit empty trailing fields. Extra non-empty cells mean the columns have
 * shifted, so the record is rejected (null).
 */
export function fitToHeader(cells: string[], width: number): string[] | null {
    let end = cells.length;
    while (end > width && !cells[end - 1]) end--;
    if (end > width && width > 0) return null;
    const fitted = cells.slice(0, end);
    while (fitted.length < width) fitted.push('');
    return fitted;
}

/** "$1,234.50" → 1234.5, "(12)" → -12, "" / "--" / "n/a" → null. */
export function parseNumber(raw: string | undefined): number | null {
    if (raw == null) return null;
    let s = raw.trim();
    if (!s || s === '--' || /^n\/?a$/i.test(s)) return null;
    let negative = false;
    if (/^\(.*\)$/.test(s)) {
        negative = true;
        s = s.slice(1, -1);
    }
    s = s.replace(/[$,\s]/g, '');
    if (s.startsWith('-')) {
        negative = !negative;
        s = s.slice(1);
    }
    if (!/^\d*\.?\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? (negative ? -n : n) : null;
}

function findColumn(headers: string[], key: keyof typeof HEADER_ALIASES): number {
    const aliases = HEADER_ALIASES[key];
    return headers.findIndex((h) => aliases.includes(h));
}

export function parseHoldingsCsv(text: string): ParseResult {
    const records = readCsvRecords(text.replace(/^﻿/, ''));
    const issues: ParseIssue[] = [];
    let skipped = 0;

    // Some exports put account info above the table: use the first line that
    // names both a symbol and a quantity column as the header.
    let headerIndex = -1;
    let headers: string[] = [];
    for (let i = 0; i < Math.min(records.length, 20); i++) {
        if (records[i].error) continue;
        const candidate = records[i].cells.map(normalizeHeader);
        if (findColumn(candidate, 'symbol') >= 0 && findColumn(candidate, 'quantity') >= 0) {
            headerIndex = i;
            // Width 0 only trims: a comma at the end of the header line adds an empty column.
            headers = fitToHeader(candidate, 0) ?? candidate;
            break;
        }
    }
    if (headerIndex < 0) {
        return {
            rows: [],
            options: [],
            issues: [{ line: 1, message: 'No header row with a Symbol and a Quantity column was found.' }],
            skipped: 0,
        };
    }

    const col = {
        symbol: findColumn(headers, 'symbol'),
        quantity: findColumn(headers, 'quantity'),
        avgCost: findColumn(headers, 'avgCost'),
        costBasis: findColumn(headers, 'costBasis'),
        name: findColumn(headers, 'name'),
        assetType: findColumn(headers, 'assetType'),
    };
    if (col.avgCost < 0 && col.costBasis < 0) {
        return {
            rows: [],
            options: [],
            issues: [{ line: records[headerIndex].line, message: 'Add an Average cost or a Cost basis column so gains can be calculated.' }],
            skipped: 0,
        };
    }

    const merged = new Map<string, ImportRow>();
    const options = new Map<string, OptionImportRow>();
    for (const record of records.slice(headerIndex + 1)) {
        const lineNo = record.line;
        if (record.error) {
            issues.push({ line: lineNo, message: record.error });
            continue;
        }
        const rawSymbol = (record.cells[col.symbol] ?? '').trim();
        if (record.cells.every((cell) => !cell) || SUMMARY_SYMBOL.test(rawSymbol) || isNoteRow(record.cells, col.symbol)) {
            skipped++;
            continue;
        }
        const cells = fitToHeader(record.cells, headers.length);
        if (!cells) {
            issues.push({ line: lineNo, message: `Expected ${headers.length} columns, found ${record.cells.length}.` });
            continue;
        }
        if (isCashRow(cells, col)) {
            skipped++;
            continue;
        }
        const contract = optionContractOf(rawSymbol, cells, col);
        if (contract) {
            const option = readOptionRow(contract, cells, col, lineNo, issues);
            if (!option) continue;
            const key = optionContractTicker(option);
            const prev = options.get(key);
            if (prev && Math.sign(prev.quantity) !== Math.sign(option.quantity)) {
                // Bought and written lots of one contract have no single
                // premium that doesn't depend on which closed which.
                issues.push({ line: lineNo, message: `${describeOptionContract(option)}: bought and written lots of one contract. Enter it as one net position.` });
            } else if (prev) {
                // Two lots of one contract, the same way round: combined at the weighted premium.
                const quantity = prev.quantity + option.quantity;
                options.set(key, {
                    ...prev,
                    quantity,
                    premium: (prev.premium * Math.abs(prev.quantity) + option.premium * Math.abs(option.quantity))
                        / (Math.abs(prev.quantity) + Math.abs(option.quantity)),
                });
            } else if (options.size >= MAX_OPTION_IMPORT_ROWS) {
                issues.push({ line: lineNo, message: `Only the first ${MAX_OPTION_IMPORT_ROWS} option positions can be imported at once.` });
            } else {
                options.set(key, option);
            }
            continue;
        }
        if (OPTION_ASSET_TYPE.test(normalizeHeader(cells[col.assetType] ?? ''))) {
            issues.push({ line: lineNo, message: `“${rawSymbol}” is an option Atlas can't read the contract of. Add it on Holdings instead.` });
            continue;
        }
        const symbol = normalizeTicker(rawSymbol.replace(/\*+$/, ''));
        if (!symbol) {
            issues.push({ line: lineNo, message: `“${rawSymbol}” is not a ticker.` });
            continue;
        }
        const quantity = parseNumber(cells[col.quantity]);
        if (quantity == null || quantity <= 0) {
            issues.push({ line: lineNo, message: `${symbol}: quantity must be a positive number.` });
            continue;
        }
        let avgCost = col.avgCost >= 0 ? parseNumber(cells[col.avgCost]) : null;
        if (avgCost == null && col.costBasis >= 0) {
            const basis = parseNumber(cells[col.costBasis]);
            avgCost = basis != null ? basis / quantity : null;
        }
        if (avgCost == null || avgCost < 0) {
            issues.push({ line: lineNo, message: `${symbol}: missing or invalid cost.` });
            continue;
        }
        const name = col.name >= 0 ? (cells[col.name] ?? '').trim() : '';
        const prev = merged.get(symbol);
        if (prev) {
            // The same symbol on two lines (e.g. two lots): combine at the
            // quantity-weighted average cost.
            const qty = prev.quantity + quantity;
            merged.set(symbol, {
                symbol,
                name: prev.name || name,
                quantity: qty,
                avgCost: (prev.avgCost * prev.quantity + avgCost * quantity) / qty,
            });
        } else {
            if (merged.size >= MAX_IMPORT_ROWS) {
                issues.push({ line: lineNo, message: `Only the first ${MAX_IMPORT_ROWS} positions can be imported at once.` });
                break;
            }
            merged.set(symbol, { symbol, name, quantity, avgCost });
        }
    }

    const rows = [...merged.values()].map((r) => ({
        ...r,
        quantity: round(r.quantity, 6),
        avgCost: round(r.avgCost, 4),
    }));
    const optionRows = [...options.values()].map((o) => ({ ...o, quantity: round(o.quantity, 6), premium: round(o.premium, 4) }));
    return { rows, options: optionRows, issues, skipped };
}

/** What the import API takes in one go (OPTION_POSITION_LIMITS.importRows). */
export const MAX_OPTION_IMPORT_ROWS = 500;

/**
 * The contract a row holds: its symbol read as one, or, when the file says
 * the row is an option, its description.
 */
function optionContractOf(rawSymbol: string, cells: string[], col: { name: number; assetType: number }): OptionContract | null {
    const fromSymbol = parseOptionContract(rawSymbol);
    if (fromSymbol) return fromSymbol;
    if (!OPTION_ASSET_TYPE.test(normalizeHeader(cells[col.assetType] ?? ''))) return null;
    return col.name >= 0 ? parseOptionContract(cells[col.name] ?? '') : null;
}

function readOptionRow(
    contract: OptionContract,
    cells: string[],
    col: { quantity: number; avgCost: number; costBasis: number },
    line: number,
    issues: ParseIssue[],
): OptionImportRow | null {
    const label = `${contract.underlying} ${contract.expiry} ${contract.strike} ${contract.contractType}`;
    const quantity = parseNumber(cells[col.quantity]);
    if (quantity == null || quantity === 0 || !Number.isInteger(quantity)) {
        issues.push({ line, message: `${label}: contracts must be a whole number other than 0.` });
        return null;
    }
    // The total cost first: brokers differ on whether an option's average
    // cost is per share or per contract, but not on what the total is.
    const basis = col.costBasis >= 0 ? parseNumber(cells[col.costBasis]) : null;
    let premium = basis != null ? Math.abs(basis) / (Math.abs(quantity) * OPTION_POSITION_MULTIPLIER) : null;
    if (premium == null && col.avgCost >= 0) premium = parseNumber(cells[col.avgCost]);
    if (premium == null || premium < 0) {
        issues.push({ line, message: `${label}: missing or invalid cost.` });
        return null;
    }
    return { ...contract, quantity, premium };
}

function round(n: number, places: number): number {
    const f = 10 ** places;
    return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// Import plan
// ---------------------------------------------------------------------------

export interface ExistingHolding {
    id: string;
    symbol: string;
    quantity: number;
    avgCost: number;
}

export type PlannedChange =
    | { kind: 'insert'; row: ImportRow }
    | { kind: 'update'; id: string; row: ImportRow; before: { quantity: number; avgCost: number } }
    | { kind: 'unchanged'; id: string; row: ImportRow };

/**
 * What importing `rows` into an account holding `existing` will do. A row for
 * a symbol already held replaces that position (the file is a snapshot of
 * the account); positions not in the file are left alone.
 */
export function planHoldingsImport(existing: readonly ExistingHolding[], rows: readonly ImportRow[]): PlannedChange[] {
    const bySymbol = new Map(existing.map((h) => [h.symbol.toUpperCase(), h] as const));
    return rows.map((row) => {
        const current = bySymbol.get(row.symbol);
        if (!current) return { kind: 'insert', row };
        const same = Math.abs(current.quantity - row.quantity) < 1e-9 && Math.abs(current.avgCost - row.avgCost) < 1e-6;
        return same
            ? { kind: 'unchanged', id: current.id, row }
            : { kind: 'update', id: current.id, row, before: { quantity: current.quantity, avgCost: current.avgCost } };
    });
}

export function summarizePlan(plan: readonly PlannedChange[]): { insert: number; update: number; unchanged: number } {
    return {
        insert: plan.filter((p) => p.kind === 'insert').length,
        update: plan.filter((p) => p.kind === 'update').length,
        unchanged: plan.filter((p) => p.kind === 'unchanged').length,
    };
}
