import { formatShortDate } from '@/lib/format';
import { normalizeTicker } from '@/lib/research/watchlist';
import { MANUAL_HOLDING_LIMITS } from '@/lib/validators/manual-holding';
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
 *
 * A row with no ticker Atlas can price (a blank symbol, a CUSIP, a plan's
 * fund number, a fund's name) is a holding valued by hand: it comes in at
 * the file's market value when the file has a value column, and is listed
 * as an issue, with how to bring it in, when it doesn't. Whether a row has
 * a ticker is read from its symbol cell alone (readSymbolCell), never from
 * the price store, so a ticker Atlas has no price for yet stays a position.
 */

export const MAX_IMPORT_ROWS = 1000;

export interface ImportRow {
    /** The account the file puts it in, when the file has an account column. */
    account?: string;
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
    /** The account the file puts it in, when the file has an account column. */
    account?: string;
    /** Contracts; negative for a written position. */
    quantity: number;
    premium: number;
}

/**
 * A holding valued by hand read from the file: a row with no ticker Atlas
 * can price. Its value is the whole holding's, as the file gives it; units
 * and cost are null when the file doesn't give them.
 */
export interface ManualImportRow {
    /** The account the file puts it in, when the file has an account column. */
    account?: string;
    name: string;
    /** A CUSIP, ISIN or the plan's own code, upper case, when the file has one. */
    identifier: string | null;
    quantity: number | null;
    value: number;
    /** The total cost, from a cost-basis column only; null when the file has none. */
    costBasis: number | null;
}

export interface ParseResult {
    rows: ImportRow[];
    /** The file's option positions, for the LEAPS ledger. */
    options: OptionImportRow[];
    /** The file's rows with no ticker Atlas can price, brought in valued by hand. */
    manual: ManualImportRow[];
    issues: ParseIssue[];
    /** Cash, total, and blank rows ignored on purpose. */
    skipped: number;
    /**
     * The file's accounts in the order they first appear, when it has an
     * account column (a positions export covering several accounts, as
     * Fidelity's and Monarch's are); empty for a one-account file.
     */
    accounts: string[];
}

type Column = 'symbol' | 'quantity' | 'avgCost' | 'costBasis' | 'value' | 'name' | 'identifier' | 'assetType' | 'accountName' | 'accountNumber';

const HEADER_ALIASES: Record<Column, readonly string[]> = {
    accountName: ['account', 'account name', 'account nickname', 'account name/number', 'account display name'],
    accountNumber: ['account number', 'account #', 'account no', 'account no.', 'account id'],
    symbol: ['symbol', 'ticker', 'sym', 'security symbol', 'symbol/cusip', 'symbol / cusip'],
    quantity: ['quantity', 'qty', 'shares', 'units', 'position'],
    avgCost: ['avg cost', 'average cost', 'avg price', 'average price', 'cost/share', 'cost per share', 'unit cost', 'price paid', 'avg cost basis', 'average cost basis'],
    costBasis: ['cost basis', 'cost basis total', 'total cost', 'cost basis ($)', 'book value'],
    // The whole holding's worth, read only for rows with no ticker: a
    // position's value comes from its price.
    value: [
        'market value', 'current value', 'value', 'total value', 'market value ($)', 'current value ($)', 'value ($)', 'value $',
        'mkt value', 'mkt val', 'position value', 'ending value', 'ending balance', 'balance',
    ],
    identifier: ['cusip', 'cusip number', 'cusip #', 'isin', 'cusip/isin', 'security id', 'security identifier', 'identifier'],
    assetType: ['asset type', 'asset class', 'security type', 'position type'],
    name: [
        'description', 'name', 'security', 'security name', 'security description',
        'investment', 'investment name', 'fund', 'fund name', 'holding', 'holding name',
    ],
};

type Columns = Record<Column, number>;

// The ** suffix is an explicit broker core-position marker, not a ticker.
const CORE_POSITION = /^(spaxx|fdrxx|core)\*\*$/i;
const OPTION_ASSET_TYPE = /^(option|options|equity option|equity options|call|put|listed option)s?$/i;
const SUMMARY_SYMBOL = /^(pending|pending activity|account total|total|--)$/i;
/** A name or identifier cell that says it's empty. */
const PLACEHOLDER = /^(|-+|—|–|n\/?a|none|null|unknown|not available)$/i;
/**
 * A symbol cell that says there is no symbol. Bare NA isn't one: it's a
 * ticker (Nano Labs), and exports write a missing symbol as "n/a".
 */
const PLACEHOLDER_SYMBOL = /^(|-+|—|–|n\/a|none|null|unknown|not available)$/i;
/**
 * Labels of rows that add up or head other rows, or hold cash, in a file's
 * rows with no ticker. Exact phrases only: a fund called "Total Stock Market
 * Trust" is a holding.
 */
const SUMMARY_LABEL = new RegExp(`^(?:${[
    'total', 'totals', 'grand total', 'subtotal', 'sub-total', 'account total', 'accounts total',
    'total value', 'total account value', 'total portfolio value', 'total market value', 'total holdings', 'total investments',
    'net account value', 'pending', 'pending activity',
    'cash', 'cash balance', 'cash (?:&|and) (?:cash )?(?:investments|equivalents|money market|sweep)',
    'sweep', 'bank sweep', 'money market sweep', 'core position', 'held in money market',
    'margin balance', 'margin debit', 'buying power',
    'equities', 'stocks', 'etfs', 'mutual funds', 'fixed income', 'bonds', 'options',
].join('|')})$`);

export function normalizeHeader(h: string): string {
    return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Excel's text guard (="012345678") and a leading = taken off a cell. */
function unwrapCell(raw: string): string {
    const s = raw.trim();
    const guarded = /^="(.*)"$/.exec(s);
    return (guarded ? guarded[1] : s).replace(/^=+/, '').trim();
}

/**
 * A CUSIP: nine characters whose last is the modulus-10 "double add double"
 * check digit of the first eight ('*', '@' and '#' count 36, 37 and 38).
 */
export function isCusip(code: string): boolean {
    const s = code.toUpperCase();
    if (!/^[0-9A-Z*@#]{8}[0-9]$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 8; i++) {
        const c = s[i];
        let v = /\d/.test(c) ? Number(c) : c === '*' ? 36 : c === '@' ? 37 : c === '#' ? 38 : c.charCodeAt(0) - 55;
        if (i % 2 === 1) v *= 2;
        sum += Math.floor(v / 10) + (v % 10);
    }
    return (10 - (sum % 10)) % 10 === Number(s[8]);
}

/** A CUSIP or a plan's all-digit fund number: shaped like a ticker, but never one Atlas can price. */
export function looksLikeSecurityCode(symbol: string): boolean {
    return /^\d+$/.test(symbol) || isCusip(symbol);
}

/**
 * What a row's symbol cell holds: a ticker, or, for a holding Atlas can't
 * price, a code (a CUSIP, an ISIN, a plan's number) to keep as its
 * identifier, words (a fund's name), or a placeholder ('--', 'n/a').
 */
export type SymbolCell =
    | { ticker: string }
    | { ticker: null; identifier: string | null; text: string | null; placeholder: boolean };

/**
 * A symbol cell's text as a ticker, or null when it can't be one. A class
 * share some brokers write as BRK/B (Schwab) or BRK B (Interactive
 * Brokers) is read as the price store keeps it, BRK.B, as ticker search
 * reads it (searchTextAsTicker). The space form is narrower than search's,
 * since a file's fund names sit in the same column: capitals and a single
 * class letter only, so "Fund A" and "BOND FD" stay words.
 */
function symbolAsTicker(text: string): string | null {
    if (PLACEHOLDER_SYMBOL.test(text)) return null;
    const classShare = /^([A-Z]{1,5})\/([A-Z]{1,2})$/i.exec(text) ?? /^([A-Z]{1,5}) ([A-Z])$/.exec(text);
    return normalizeTicker(classShare ? `${classShare[1]}.${classShare[2]}` : text);
}

export function readSymbolCell(raw: string): SymbolCell {
    const value = unwrapCell(raw).replace(/\*+$/, '').trim();
    if (PLACEHOLDER_SYMBOL.test(value)) return { ticker: null, identifier: null, text: null, placeholder: true };
    const ticker = symbolAsTicker(value);
    if (ticker && !looksLikeSecurityCode(ticker)) return { ticker };
    // A code has no spaces and fits an identifier; anything longer is words.
    const code = !/[\s<>]/.test(value) && value.length <= MANUAL_HOLDING_LIMITS.identifier;
    return code
        ? { ticker: null, identifier: value.toUpperCase(), text: null, placeholder: false }
        : { ticker: null, identifier: null, text: value, placeholder: false };
}

/** An identifier column's cell: unwrapped, upper case, at most 40 characters; null when blank or a placeholder. */
function identifierCell(raw: string | undefined): string | null {
    const value = unwrapCell(raw ?? '');
    if (PLACEHOLDER.test(value) || /[<>]/.test(value) || value.length > MANUAL_HOLDING_LIMITS.identifier) return null;
    return value.toUpperCase();
}

/** A holding's name as imports compare it: case, punctuation and spacing ignored. */
export function normalizeHoldingName(name: string): string {
    return name.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const compactIdentifier = (identifier: string | null | undefined) => (identifier ?? '').replace(/\s+/g, '').toUpperCase();

/**
 * The key a holding valued by hand is found by when its file is imported
 * again, unique within its account: "csv:id:" and its identifier (spaces
 * and case ignored), or else "csv:name:" and its normalized name; null
 * when it has neither.
 */
export function manualImportKey(row: { name: string; identifier?: string | null }): string | null {
    const identifier = compactIdentifier(row.identifier);
    if (identifier) return `csv:id:${identifier}`;
    const name = normalizeHoldingName(row.name);
    return name ? `csv:name:${name}` : null;
}

/** A total, subtotal, cash or category row's label, for rows with no ticker. */
export function isSummaryLabel(label: string): boolean {
    const s = normalizeHeader(label).replace(/[:*]+$/, '').trim();
    return SUMMARY_LABEL.test(s) || /\b(?:sub-?)?totals?$/.test(s) || /\bcash$/.test(s);
}

/** Cut to `max` UTF-16 units without splitting a character. */
function cutText(text: string, max: number): string {
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    return (/[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut).trimEnd();
}

export interface CsvRecord {
    cells: string[];
    /** First physical line of the complete record. */
    line: number;
    error?: string;
}

/** How much of a file without a byte-order mark is checked for UTF-16. */
const UTF16_SAMPLE_BYTES = 4096;

/**
 * The byte order of a UTF-16 file without a byte-order mark, or null when it
 * isn't one. A CSV is mostly ASCII (its commas, digits and headings), and in
 * UTF-16 an ASCII character's high byte is 0: the second byte of each pair
 * in little-endian order, the first in big-endian. So in a UTF-16 file at
 * least half of one of those bytes are 0 and almost none of the other,
 * which a stray NUL in UTF-8 text never comes near.
 */
function utf16ByteOrder(data: Uint8Array): 'utf-16le' | 'utf-16be' | null {
    const pairs = Math.floor(Math.min(data.length, UTF16_SAMPLE_BYTES) / 2);
    if (pairs === 0) return null;
    let firstZero = 0;
    let secondZero = 0;
    for (let i = 0; i < pairs; i++) {
        if (data[2 * i] === 0) firstZero++;
        if (data[2 * i + 1] === 0) secondZero++;
    }
    if (secondZero >= pairs / 2 && firstZero <= pairs / 10) return 'utf-16le';
    if (firstZero >= pairs / 2 && secondZero <= pairs / 10) return 'utf-16be';
    return null;
}

/**
 * A chosen file's bytes as text, for the parsers. A file saved as UTF-16
 * (Excel's Unicode formats, some exports) is read as UTF-16, by its
 * byte-order mark or, without one, by its zero bytes (utf16ByteOrder): read
 * as UTF-8, as File.text() reads every file, each character would come with
 * a NUL, and every letter past ASCII garbled. Anything else is read as
 * UTF-8, a byte that isn't valid in it becoming U+FFFD as before.
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const encoding = data[0] === 0xff && data[1] === 0xfe ? 'utf-16le'
        : data[0] === 0xfe && data[1] === 0xff ? 'utf-16be'
        : utf16ByteOrder(data) ?? 'utf-8';
    // The decoder drops the byte-order mark of its own encoding.
    return new TextDecoder(encoding).decode(data);
}

/**
 * A file's text as the parsers read it: without the byte-order mark some
 * exports start with, and without NUL characters, which some leave in a cell
 * and Postgres can't store, so an import of them would fail. A UTF-16 file
 * is decoded as UTF-16 first (decodeCsvBytes), so the NULs dropped here are
 * stray ones.
 */
export function csvFileText(text: string): string {
    return text.replace(/^\uFEFF/, '').replace(/\u0000/g, '');
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
            if (field.trim() === '=') {
                // Excel's text guard written bare, ="0123": the quoted text
                // is read, after the = that unwrapCell takes off.
                field = '=';
                state = 'quoted';
            } else if (field.trim()) {
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
    return !symbolAsTicker(cells[symbolColumn].replace(/\*+$/, ''));
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
    const records = readCsvRecords(csvFileText(text));
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
            manual: [],
            issues: [{ line: 1, message: 'No header row with a Symbol and a Quantity column was found.' }],
            skipped: 0,
            accounts: [],
        };
    }

    const col: Columns = {
        symbol: findColumn(headers, 'symbol'),
        quantity: findColumn(headers, 'quantity'),
        avgCost: findColumn(headers, 'avgCost'),
        costBasis: findColumn(headers, 'costBasis'),
        value: findColumn(headers, 'value'),
        name: findColumn(headers, 'name'),
        identifier: findColumn(headers, 'identifier'),
        assetType: findColumn(headers, 'assetType'),
        accountName: findColumn(headers, 'accountName'),
        accountNumber: findColumn(headers, 'accountNumber'),
    };
    const byAccount = col.accountName >= 0 || col.accountNumber >= 0;
    // Each account by its number when the file has one (two accounts can
    // share a name, "Individual"), else by its name; labelled at the end.
    const accountNames = new Map<string, string>();
    const accountOrder: string[] = [];
    const headerLine = records[headerIndex].line;
    const costMessage = 'Add an Average cost or a Cost basis column so gains can be calculated.';
    // Positions and options need a cost; holdings valued by hand need only
    // their value, so a file with a value column is still read without one.
    const costless = col.avgCost < 0 && col.costBasis < 0;
    if (costless && col.value < 0) {
        return { rows: [], options: [], manual: [], issues: [{ line: headerLine, message: costMessage }], skipped: 0, accounts: [] };
    }
    let costIssueListed = false;

    const merged = new Map<string, ImportRow>();
    const options = new Map<string, OptionImportRow>();
    const manual = new Map<string, ManualImportRow>();
    for (const record of records.slice(headerIndex + 1)) {
        const lineNo = record.line;
        if (record.error) {
            issues.push({ line: lineNo, message: record.error });
            continue;
        }
        const rawSymbol = (record.cells[col.symbol] ?? '').trim();
        // '--' alone ends a table, unless the file can value a row with no
        // ticker: then its label and value say what the row is.
        const summarySymbol = SUMMARY_SYMBOL.test(rawSymbol) && !(col.value >= 0 && PLACEHOLDER_SYMBOL.test(rawSymbol));
        if (record.cells.every((cell) => !cell) || summarySymbol || isNoteRow(record.cells, col.symbol)) {
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
        const optionRow = contract !== null || OPTION_ASSET_TYPE.test(normalizeHeader(cells[col.assetType] ?? ''));
        const cell = readSymbolCell(rawSymbol);
        // A row with no ticker is known by its name, else its symbol cell's
        // words or code. Totals, cash and category rows (and rows with
        // nothing to go by) are skipped before the account is checked, so
        // a footer without one isn't listed.
        const nameCell = col.name >= 0 ? (cells[col.name] ?? '').trim() : '';
        let label = '';
        if (!optionRow && cell.ticker === null) {
            label = (PLACEHOLDER.test(nameCell) ? '' : nameCell) || cell.text || cell.identifier || '';
            if (!label || isSummaryLabel(label)) {
                skipped++;
                continue;
            }
        }
        let accountKey = '';
        if (byAccount) {
            // Account numbers are what a file guards as text (="0123").
            const accountName = col.accountName >= 0 ? unwrapCell(cells[col.accountName] ?? '') : '';
            const accountNumber = col.accountNumber >= 0 ? unwrapCell(cells[col.accountNumber] ?? '') : '';
            accountKey = accountNumber || accountName;
            if (!accountKey) {
                issues.push({ line: lineNo, message: `${label || rawSymbol || 'This row'}: no account. Fill in the account column.` });
                continue;
            }
            if (!accountNames.has(accountKey)) {
                accountNames.set(accountKey, accountName);
                accountOrder.push(accountKey);
            } else if (!accountNames.get(accountKey) && accountName) {
                accountNames.set(accountKey, accountName);
            }
        }
        if (cell.ticker === null && !optionRow) {
            const read = readManualRow(rawSymbol, cell, label, cells, col, lineNo, issues);
            if (read === 'skip') skipped++;
            if (!read || read === 'skip') continue;
            const row: ManualImportRow = byAccount ? { account: accountKey, ...read } : read;
            const key = `${accountKey}\u0000${manualImportKey(row)}`;
            const prev = manual.get(key);
            if (prev) {
                // One holding on two lines of one account (two lots, or one
                // fund in two sources): the values add, and the units and
                // cost when both lines give them.
                manual.set(key, {
                    ...prev,
                    value: prev.value + row.value,
                    quantity: prev.quantity !== null && row.quantity !== null ? prev.quantity + row.quantity : null,
                    costBasis: prev.costBasis !== null && row.costBasis !== null ? prev.costBasis + row.costBasis : null,
                });
            } else {
                if (merged.size + manual.size >= MAX_IMPORT_ROWS) {
                    issues.push({ line: lineNo, message: `Only the first ${MAX_IMPORT_ROWS} positions can be imported at once.` });
                    break;
                }
                manual.set(key, row);
            }
            continue;
        }
        if (costless) {
            // Listed once, on the header, rather than on every row.
            if (!costIssueListed) issues.push({ line: headerLine, message: costMessage });
            costIssueListed = true;
            continue;
        }
        if (contract) {
            const read = readOptionRow(contract, cells, col, lineNo, issues);
            if (!read) continue;
            const option: OptionImportRow = byAccount ? { ...read, account: accountKey } : read;
            const key = `${accountKey}\u0000${optionContractTicker(option)}`;
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
        if (optionRow) {
            issues.push({ line: lineNo, message: `“${rawSymbol}” is an option Atlas can't read the contract of. Add it on Holdings instead.` });
            continue;
        }
        const symbol = cell.ticker!;
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
        const key = `${accountKey}\u0000${symbol}`;
        const prev = merged.get(key);
        if (prev) {
            // The same symbol on two lines of one account (e.g. two lots):
            // combine at the quantity-weighted average cost.
            const qty = prev.quantity + quantity;
            merged.set(key, {
                ...prev,
                name: prev.name || nameCell,
                quantity: qty,
                avgCost: (prev.avgCost * prev.quantity + avgCost * quantity) / qty,
            });
        } else {
            if (merged.size + manual.size >= MAX_IMPORT_ROWS) {
                issues.push({ line: lineNo, message: `Only the first ${MAX_IMPORT_ROWS} positions can be imported at once.` });
                break;
            }
            merged.set(key, byAccount ? { account: accountKey, symbol, name: nameCell, quantity, avgCost } : { symbol, name: nameCell, quantity, avgCost });
        }
    }

    const labels = accountLabels(accountOrder, accountNames);
    const withLabel = <T extends { account?: string }>(r: T): T => (r.account === undefined ? r : { ...r, account: labels.get(r.account)! });
    const rows = [...merged.values()].map((r) => withLabel({
        ...r,
        quantity: round(r.quantity, 6),
        avgCost: round(r.avgCost, 4),
    }));
    const optionRows = [...options.values()].map((o) => withLabel({ ...o, quantity: round(o.quantity, 6), premium: round(o.premium, 4) }));
    // As Plaid's are: values and costs to the cent, units to six places.
    const manualRows = [...manual.values()].map((m) => withLabel({
        ...m,
        value: round(m.value, 2),
        quantity: m.quantity !== null && round(m.quantity, 6) > 0 ? round(m.quantity, 6) : null,
        costBasis: m.costBasis !== null ? round(m.costBasis, 2) : null,
    }));
    return { rows, options: optionRows, manual: manualRows, issues, skipped, accounts: accountOrder.map((k) => labels.get(k)!) };
}

/**
 * A row with no ticker as a holding valued by hand: its value from the
 * value column, its units, and its cost from a cost-basis column only (an
 * average cost times units is wrong by 100 for a bond quoted per 100 of
 * face value). Anything the API would refuse is listed instead; 'skip' is
 * a row with no symbol, value or units, which sums up the rows above it.
 */
function readManualRow(
    rawSymbol: string,
    cell: Extract<SymbolCell, { ticker: null }>,
    label: string,
    cells: string[],
    col: Columns,
    line: number,
    issues: ParseIssue[],
): Omit<ManualImportRow, 'account'> | 'skip' | null {
    const list = (message: string) => {
        issues.push({ line, message });
        return null;
    };
    if (col.value < 0) {
        return list(cell.placeholder
            ? `${label}: no ticker. Add a market value column to bring it in valued by hand, or add it on Holdings.`
            : `“${rawSymbol}” isn't a ticker Atlas can price. Add a market value column to bring it in valued by hand, or add it on Holdings.`);
    }
    const value = parseNumber(cells[col.value]);
    const units = parseNumber(cells[col.quantity]);
    if (value === null) {
        if (cell.placeholder && !units) return 'skip';
        return list(`${label}: no ticker and no value. Fill in its market value, or add it on Holdings.`);
    }
    if (value < 0) return list(`${label}: value can't be negative.`);
    if (value > MANUAL_HOLDING_LIMITS.value) return list(`${label}: value is out of range.`);
    if (units !== null && units < 0) return list(`${label}: units can't be negative.`);
    if (units !== null && units > MANUAL_HOLDING_LIMITS.value) return list(`${label}: units are out of range.`);
    const cost = col.costBasis >= 0 ? parseNumber(cells[col.costBasis]) : null;
    if (cost !== null && cost < 0) return list(`${label}: cost can't be negative.`);
    if (cost !== null && cost > MANUAL_HOLDING_LIMITS.value) return list(`${label}: cost is out of range.`);
    const name = cutText(label, MANUAL_HOLDING_LIMITS.name);
    if (/[<>]/.test(name) || name.startsWith('=')) return list(`${label}: the name can't contain < or > or start with =.`);
    const identifier = cell.identifier ?? (col.identifier >= 0 ? identifierCell(cells[col.identifier]) : null);
    if (manualImportKey({ name, identifier }) === null) return list(`${label}: the name needs a letter or a digit.`);
    return { name, identifier, quantity: units || null, value, costBasis: cost };
}

/**
 * What each account is called in the preview and, when it's new, in Atlas:
 * its name; its name and the number's last four when two share a name; its
 * number when the file gives no name. At most 80 characters, as account
 * names are.
 */
const ACCOUNT_LABEL_MAX = 80;

function accountLabels(order: readonly string[], names: ReadonlyMap<string, string>): Map<string, string> {
    const count = new Map<string, number>();
    for (const key of order) {
        const name = names.get(key) || key;
        count.set(name.toLowerCase(), (count.get(name.toLowerCase()) ?? 0) + 1);
    }
    const labels = new Map<string, string>();
    const taken = new Set<string>();
    // Shortened from the name, never the suffix, and numbered when still
    // alike: each label is an account's identity in the import.
    const fit = (name: string, suffix: string) => `${name.slice(0, ACCOUNT_LABEL_MAX - suffix.length).trimEnd()}${suffix}`;
    for (const key of order) {
        const name = names.get(key) || key;
        const shared = (count.get(name.toLowerCase()) ?? 0) > 1 && names.get(key);
        const suffix = shared ? ` ••${key.replace(/\s+/g, '').slice(-4)}` : '';
        let label = fit(name, suffix);
        for (let n = 2; taken.has(label.toLowerCase()); n++) label = fit(name, `${suffix} (${n})`);
        taken.add(label.toLowerCase());
        labels.set(key, label);
    }
    return labels;
}

export interface AccountImportGroup {
    account: string;
    rows: ImportRow[];
    options: OptionImportRow[];
    manual: ManualImportRow[];
}

function withoutAccount<T extends { account?: string }>(row: T): Omit<T, 'account'> {
    const copy = { ...row };
    delete copy.account;
    return copy;
}

/**
 * A multi-account file's positions and holdings valued by hand, one group
 * per account in the file's order; [] for a one-account file.
 */
export function groupImportByAccount(
    result: Pick<ParseResult, 'rows' | 'options' | 'accounts'> & Partial<Pick<ParseResult, 'manual'>>,
): AccountImportGroup[] {
    const manual = result.manual ?? [];
    return result.accounts.map((account) => ({
        account,
        rows: result.rows.filter((r) => r.account === account).map(withoutAccount),
        options: result.options.filter((o) => o.account === account).map(withoutAccount),
        manual: manual.filter((m) => m.account === account).map(withoutAccount),
    })).filter((g) => g.rows.length + g.options.length + g.manual.length > 0);
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

// ---------------------------------------------------------------------------
// Holdings valued by hand: what importing a file's rows will change
// ---------------------------------------------------------------------------

/** A holding valued by hand that an import may update: one added by hand, or one an earlier file brought in. */
export interface ExistingManualHolding {
    id: string;
    name: string;
    identifier: string | null;
    /** Its key from an earlier file (manualImportKey), or null for one added by hand. */
    importKey: string | null;
    quantity: number | null;
    value: number;
    costBasis: number | null;
    valueAsOf: string;
}

export type PlannedManualChange =
    | { kind: 'insert'; key: string; row: ManualImportRow; replacesPosition: string | null }
    | {
        kind: 'update' | 'unchanged';
        id: string;
        key: string;
        row: ManualImportRow;
        savedName: string;
        savedValueAsOf: string;
        /** The file's day is before the saved value's: only that day's value is recorded. */
        olderThanSaved: boolean;
        /** Its units or cost change, which is a change to the account, not just a new price. */
        changesHolding: boolean;
        /** The position, held under this code, that the holding takes the place of. */
        replacesPosition: string | null;
    };

const sameUnits = (a: number | null, b: number | null) => (a === null || b === null ? a === b : round(a, 6) === round(b, 6));
const sameMoney = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.round(a * 100) === Math.round(b * 100));

/**
 * What importing a file's holdings valued by hand into an account will do,
 * given the account's holdings an import may update (`existing`: those
 * added by hand or by an earlier file, never a linked account's) and the
 * symbols of its positions.
 *
 * Each row is matched in three tiers, each over all rows in the file's
 * order before the next starts, and a holding is claimed once: the same
 * key; then the same identifier (spaces and case ignored), so a renamed
 * fund is still found; then the same name, unless both have identifiers
 * that differ. A match is updated in place and keeps its id. A file older
 * than the saved value changes nothing but that day's history, and one
 * whose value, units and cost are the same is unchanged. A row whose code
 * is held as a position (a fund imported by its CUSIP before it could be
 * valued by hand) replaces that position.
 */
export function planManualImport(
    existing: readonly ExistingManualHolding[],
    rows: readonly ManualImportRow[],
    { asOf, positions = [] }: { asOf: string; positions?: readonly string[] },
): PlannedManualChange[] {
    const keyed = rows.flatMap((row) => {
        const key = manualImportKey(row);
        // The validator refuses a row with no key, so there is none to plan.
        return key ? [{ row, key, name: normalizeHoldingName(row.name), identifier: compactIdentifier(row.identifier) }] : [];
    });
    const tiers: ((r: (typeof keyed)[number], h: ExistingManualHolding) => boolean)[] = [
        (r, h) => h.importKey === r.key,
        (r, h) => r.identifier !== '' && r.identifier === compactIdentifier(h.identifier),
        (r, h) => {
            const identifier = compactIdentifier(h.identifier);
            return r.name !== '' && r.name === normalizeHoldingName(h.name) && !(r.identifier && identifier && r.identifier !== identifier);
        },
    ];
    const matched = new Map<number, ExistingManualHolding>();
    const claimed = new Set<string>();
    for (const same of tiers) {
        keyed.forEach((r, i) => {
            if (matched.has(i)) return;
            const holding = existing.find((h) => !claimed.has(h.id) && same(r, h));
            if (!holding) return;
            matched.set(i, holding);
            claimed.add(holding.id);
        });
    }
    const held = new Set(positions.map((s) => s.toUpperCase()));
    const replaced = new Set<string>();
    return keyed.map(({ row, key, identifier }, i) => {
        let replacesPosition: string | null = null;
        if (identifier && looksLikeSecurityCode(identifier) && held.has(identifier) && !replaced.has(identifier)) {
            replacesPosition = identifier;
            replaced.add(identifier);
        }
        const holding = matched.get(i);
        if (!holding) return { kind: 'insert', key, row, replacesPosition };
        const olderThanSaved = asOf < holding.valueAsOf;
        const changesHolding = !olderThanSaved
            && (!sameUnits(row.quantity, holding.quantity) || !sameMoney(row.costBasis ?? holding.costBasis, holding.costBasis));
        const unchanged = olderThanSaved || (!changesHolding && sameMoney(row.value, holding.value));
        return {
            kind: unchanged ? 'unchanged' : 'update',
            id: holding.id,
            key,
            row,
            savedName: holding.name,
            savedValueAsOf: holding.valueAsOf,
            olderThanSaved,
            changesHolding,
            replacesPosition,
        };
    });
}

export interface ManualPlanSummary {
    insert: number;
    update: number;
    unchanged: number;
    replacedPositions: number;
}

export function summarizeManualPlan(plan: readonly PlannedManualChange[]): ManualPlanSummary {
    return {
        insert: plan.filter((p) => p.kind === 'insert').length,
        update: plan.filter((p) => p.kind === 'update').length,
        unchanged: plan.filter((p) => p.kind === 'unchanged').length,
        replacedPositions: plan.filter((p) => p.replacesPosition !== null).length,
    };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The preview's count of what a file holds: "2 positions in 2 accounts,
 * 1 valued by hand and 1 option position". A file with nothing valued by
 * hand reads as it always has ("1 position and 1 option position").
 */
export function describeImportCounts({ positions, handValued, options, accounts }: { positions: number; handValued: number; options: number; accounts: number }): string {
    const across = accounts > 1 ? ` in ${accounts} accounts` : '';
    if (handValued === 0) {
        return `${plural(positions, 'position')}${across}${options > 0 ? ` and ${plural(options, 'option position')}` : ''}`;
    }
    const parts = [
        ...(positions > 0 ? [plural(positions, 'position'), `${handValued} valued by hand`] : [plural(handValued, 'holding') + ' valued by hand']),
        ...(options > 0 ? [plural(options, 'option position')] : []),
    ];
    parts[0] += across;
    return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * What importing a row valued by hand does to what Atlas holds, as the
 * preview's In Atlas column says it: "New"; "Updates", naming the holding
 * when the file calls it something else, since it keeps its own name; "No
 * change"; or, for a file older than the saved value, that the newer one
 * stays. A row that takes a position's place says which.
 */
export function describeManualChange(change: PlannedManualChange): string {
    let text: string;
    if (change.kind === 'insert') text = 'New';
    else if (change.olderThanSaved) text = `Keeps the newer value from ${formatShortDate(`${change.savedValueAsOf}T12:00:00Z`)}`;
    else if (change.kind === 'unchanged') text = 'No change';
    else text = change.savedName.trim() === change.row.name.trim() ? 'Updates' : `Updates “${change.savedName}”`;
    return change.replacesPosition ? `${text}, replaces position ${change.replacesPosition}` : text;
}

/**
 * How many of an account's holdings an earlier file brought in (those with
 * an import key) the plan for this file leaves out. They stay as they are,
 * and the preview says so: a fund the broker renamed, or one sold, is the
 * user's to delete. Holdings added by hand aren't counted, since no file
 * is expected to list them.
 */
export function countNotInFile(
    existing: readonly (Pick<ExistingManualHolding, 'id' | 'importKey'> & { portfolioId: string })[],
    plan: readonly PlannedManualChange[],
    accountId: string,
): number {
    const claimed = new Set(plan.flatMap((change) => (change.kind === 'insert' ? [] : [change.id])));
    return existing.filter((h) => h.portfolioId === accountId && h.importKey !== null && !claimed.has(h.id)).length;
}

/** The preview's note on the holdings an earlier file brought into an account that this one leaves out (countNotInFile). */
export function describeNotInFile(account: string, left: number): string {
    return left === 1
        ? `1 holding valued by hand that an earlier file brought into ${account} isn't in this one. It stays as it is; delete it on Holdings if it's gone.`
        : `${left} holdings valued by hand that an earlier file brought into ${account} aren't in this one. They stay as they are; delete them on Holdings if they're gone.`;
}

/**
 * Why a file's holdings without a ticker can't go into a linked account that
 * still syncs: each sync brings that account's own, so the file's would be
 * counted twice. The import refuses with it (LinkedAccountImportError), and
 * the dialog says it before the file is sent, in the same words.
 */
export function describeLinkedAccountRefusal(account: string): string {
    return `${account} is a linked account, so its holdings without a ticker come in with each sync. Import this file into another account.`;
}

/**
 * What an import brings in, as its button and each account's label count
 * it: positions (option positions among them), or holdings once some are
 * valued by hand, which aren't positions.
 */
export function describeImportTotal({ positions, handValued }: { positions: number; handValued: number }): string {
    return handValued > 0 ? plural(positions + handValued, 'holding') : plural(positions, 'position');
}

export interface ImportedCounts {
    insert: number;
    update: number;
    unchanged: number;
}

/**
 * What an import did, as its toast says it from the server's counts: the
 * file's positions (option positions among them, as they have always been
 * counted) with how many are new and updated, then the option positions
 * and the holdings valued by hand on their own. A file of holdings valued
 * by hand alone names only those: "Imported 1 holding valued by hand: 1
 * new, 0 updated."
 */
export function describeImportResult(
    file: { positions: number; options: number; handValued: number; accounts: number },
    done: { positions: ImportedCounts; options: ImportedCounts; handValued: ImportedCounts & { replacedPositions: number } },
): string {
    const counts = ({ insert, update, unchanged }: ImportedCounts) => `${insert} new, ${update} updated${unchanged ? `, ${unchanged} unchanged` : ''}`;
    const across = file.accounts > 1 ? ` across ${file.accounts} accounts` : '';
    const replaced = done.handValued.replacedPositions;
    const handValued = `${counts(done.handValued)}${replaced ? `; ${replaced} ${replaced === 1 ? 'replaces a position' : 'replace positions'} Atlas couldn't price` : ''}.`;
    const positions = file.positions + file.options;
    if (positions === 0) return `Imported ${plural(file.handValued, 'holding')} valued by hand${across}: ${handValued}`;
    return `Imported ${plural(positions, 'position')}${across}: ${counts(done.positions)}.`
        + (file.options > 0 ? ` Option positions: ${counts(done.options)}.` : '')
        + (file.handValued > 0 ? ` Valued by hand: ${handValued}` : '');
}
