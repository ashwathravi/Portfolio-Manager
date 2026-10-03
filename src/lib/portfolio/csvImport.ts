import { normalizeTicker } from '@/lib/research/watchlist';

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

export interface ParseResult {
    rows: ImportRow[];
    issues: ParseIssue[];
    /** Cash, total, and blank rows ignored on purpose. */
    skipped: number;
}

const HEADER_ALIASES: Record<'symbol' | 'quantity' | 'avgCost' | 'costBasis' | 'name', readonly string[]> = {
    symbol: ['symbol', 'ticker', 'sym', 'security symbol'],
    quantity: ['quantity', 'qty', 'shares', 'units', 'position'],
    avgCost: ['avg cost', 'average cost', 'avg price', 'average price', 'cost/share', 'cost per share', 'unit cost', 'price paid', 'avg cost basis', 'average cost basis'],
    costBasis: ['cost basis', 'cost basis total', 'total cost', 'cost basis ($)', 'book value'],
    name: ['description', 'name', 'security', 'security name', 'security description'],
};

const SKIP_SYMBOL = /^(cash|spaxx\*\*|fdrxx\*\*|core\*\*|pending|account total|total|--)/i;

function normalizeHeader(h: string): string {
    return h.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^"|"$/g, '');
}

/** Splits one CSV line, honouring double-quoted fields and escaped quotes. */
export function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quoted) {
            if (c === '"' && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else if (c === '"') {
                quoted = false;
            } else {
                cur += c;
            }
        } else if (c === '"') {
            quoted = true;
        } else if (c === ',') {
            out.push(cur);
            cur = '';
        } else {
            cur += c;
        }
    }
    out.push(cur);
    return out.map((v) => v.trim());
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
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const issues: ParseIssue[] = [];
    let skipped = 0;

    // Some exports put account info above the table: use the first line that
    // names both a symbol and a quantity column as the header.
    let headerIndex = -1;
    let headers: string[] = [];
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
        const candidate = splitCsvLine(lines[i]).map(normalizeHeader);
        if (findColumn(candidate, 'symbol') >= 0 && findColumn(candidate, 'quantity') >= 0) {
            headerIndex = i;
            headers = candidate;
            break;
        }
    }
    if (headerIndex < 0) {
        return {
            rows: [],
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
    };
    if (col.avgCost < 0 && col.costBasis < 0) {
        return {
            rows: [],
            issues: [{ line: headerIndex + 1, message: 'Add an Average cost or a Cost basis column so gains can be calculated.' }],
            skipped: 0,
        };
    }

    const merged = new Map<string, ImportRow>();
    for (let i = headerIndex + 1; i < lines.length; i++) {
        const lineNo = i + 1;
        const raw = lines[i];
        if (!raw.trim()) {
            skipped++;
            continue;
        }
        const cells = splitCsvLine(raw);
        const rawSymbol = (cells[col.symbol] ?? '').trim();
        if (!rawSymbol || SKIP_SYMBOL.test(rawSymbol)) {
            skipped++;
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
    return { rows, issues, skipped };
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
