"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { PriceSparkline } from "@/components/charts";
import type { Sector } from "@/lib/holdings/sector";
import { formatAllocationPct, formatSmallPositionValue } from "@/lib/holdings/small-positions";
import { rowWindow, scrollTopKeepingRow, VIRTUAL_VIEWPORT_HEIGHT } from "@/lib/holdings/virtual-rows";
import {
    policyBucketLabel,
    themeLabel,
    type PolicyBucketId,
    type PolicyBucketStatus,
    type ThemeWeight,
} from "@/lib/risk-policy";

/**
 * Phase 4 (AR-74) full sortable Holdings table.
 *
 * Twelve columns left→right:
 *   1. Ticker + name stack
 *   2. Policy bucket
 *   3. Theme chips
 *   4. Qty  (mono, right-aligned)
 *   5. Avg cost (mono, right-aligned)
 *   6. Last (mono, right-aligned)
 *   7. Market value (mono, right-aligned)
 *   8. Today % (green/red)
 *   9. Total return % (green/red)
 *  10. Allocation bar + %
 *  11. Account (by symbol: how many accounts, linking to the breakdown)
 *  12. 30-day sparkline of real daily closes (a dash when unavailable)
 *
 * Positions worth very little come last, in one row that opens in place
 * (src/lib/holdings/small-positions.ts). The table keeps only how it's
 * drawn: its scroll position and whether the small positions are open.
 */

export interface HoldingsTableRow {
    id: string;
    symbol: string;
    name: string;
    sector: Sector;
    policyBucket: PolicyBucketId;
    policyBucketStatus: PolicyBucketStatus;
    themeWeights: readonly ThemeWeight[];
    quantity: number;
    avgCost: number;
    /** Null when there is no price yet: the row is valued at cost. */
    last: number | null;
    marketValue: number;
    /** Today's move; null when there is none from today's session. */
    todayPct: number | null;
    /** Null without a price. */
    totalReturnPct: number | null;
    allocationPct: number; // 0..100
    account: string;
    /** By symbol: every account holding it. */
    accounts?: readonly string[];
    /** By symbol: some of the shares, not all, have no price and are valued at cost. */
    partlyAtCost?: boolean;
}

/** The small positions' row, as the page works it out (src/lib/holdings/small-positions.ts). */
export interface SmallPositionsTableGroup {
    /** In the table's order. */
    rows: HoldingsTableRow[];
    marketValue: number;
    /** None of them has a price: all valued at cost. */
    atCost: boolean;
    /** Some of them, not all, are valued at cost. */
    partlyAtCost: boolean;
    /** Today's move weighted by value; null when none of them moved today. */
    todayPct: number | null;
    /** Over the positions that show a return; null when none does. */
    totalReturnPct: number | null;
    allocationPct: number;
    /** The names of the accounts holding them, in name order. */
    accounts: readonly string[];
    /** The limit that makes them small, e.g. "Each under $500". */
    limitLabel: string;
}

export interface HoldingsFullTableProps {
    rows: HoldingsTableRow[];
    /** Positions worth very little, shown as one row after the others; null when none are grouped. */
    smallPositions?: SmallPositionsTableGroup | null;
    className?: string;
}

/** What the table draws, in order: the rows, then the small positions' row and, when it's open, its positions. */
type TableItem =
    | { kind: "row"; row: HoldingsTableRow }
    | { kind: "small"; group: SmallPositionsTableGroup }
    | { kind: "small-row"; row: HoldingsTableRow };

const COLUMN_COUNT = 12;

export function HoldingsFullTable({ rows, smallPositions = null, className }: HoldingsFullTableProps) {
    const [scrollTop, setScrollTop] = useState(0);
    // Closed on every visit; nothing is stored. The table stays mounted
    // across filters, sorts, the By account / By symbol switch and the
    // refresh after an import or an edit, so it stays as the user leaves it.
    const [smallOpen, setSmallOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const toggleRef = useRef<HTMLButtonElement>(null);
    const keepToggleInView = useRef(false);
    const scrollRequested = useRef(false);
    const wasVirtualized = useRef(false);

    const items = useMemo<TableItem[]>(() => [
        ...rows.map((row) => ({ kind: "row" as const, row })),
        ...(smallPositions ? [{ kind: "small" as const, group: smallPositions }] : []),
        ...(smallPositions && smallOpen ? smallPositions.rows.map((row) => ({ kind: "small-row" as const, row })) : []),
    ], [rows, smallPositions, smallOpen]);
    const drawn = rowWindow(items.length, scrollTop);

    const toggleSmallPositions = () => {
        if (!smallPositions) return;
        const open = !smallOpen;
        const count = rows.length + 1 + (open ? smallPositions.rows.length : 0);
        // A table long enough to draw only part of itself keeps the group's
        // row among the rows drawn, in the same render as the toggle, so its
        // button stays mounted and keeps focus. The card stays where it is
        // when the row is drawn there, keeping the column headings and the
        // positions above in view, and moves to the row only when it isn't.
        // While the table draws every row its card doesn't scroll: it is at
        // the top, whatever position was last remembered.
        const next = scrollTopKeepingRow(rows.length, count, drawn.virtualized ? scrollTop : 0);
        if (next !== null) {
            setScrollTop(next);
            scrollRequested.current = true;
        }
        keepToggleInView.current = true;
        setSmallOpen(open);
    };

    useLayoutEffect(() => {
        // The card scrolls only while virtualized. Its scroll follows the
        // rows drawn when the toggle moved them, and when the table becomes
        // virtualized again (after a filter, the view switch or a toggle):
        // the remembered position and the card's had disagreed, leaving
        // blank rows until the user scrolled. A position that came from the
        // user's own scrolling is never written back.
        const container = containerRef.current;
        const becameVirtualized = drawn.virtualized && !wasVirtualized.current;
        wasVirtualized.current = drawn.virtualized;
        if (container && drawn.virtualized && (becameVirtualized || scrollRequested.current) && container.scrollTop !== scrollTop) {
            container.scrollTop = scrollTop;
        }
        scrollRequested.current = false;
        // The button stays on screen as the card grows or shrinks.
        if (keepToggleInView.current) {
            keepToggleInView.current = false;
            toggleRef.current?.scrollIntoView({ block: "nearest" });
        }
    }, [drawn.virtualized, scrollTop, smallOpen]);

    return (
        <div
            ref={containerRef}
            className={`pm-card pm-card-stack${className ? ` ${className}` : ""}`}
            data-virtualized={drawn.virtualized ? "true" : "false"}
            onScroll={drawn.virtualized ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
            style={{
                overflowX: "auto",
                ...(drawn.virtualized
                    ? { maxHeight: VIRTUAL_VIEWPORT_HEIGHT, overflowY: "auto" }
                    : null),
            }}
        >
            {/* The count includes the header row, which aria-rowindex numbers 1. */}
            <table className="pm-table-full" aria-rowcount={items.length + 1} data-testid="holdings-table">
                <thead>
                    <tr>
                        <th>Ticker</th>
                        <th>Policy</th>
                        <th>Themes</th>
                        <th className="num">Qty</th>
                        <th className="num">Avg cost</th>
                        <th className="num">Last</th>
                        <th className="num">Market value</th>
                        <th className="num">Today</th>
                        <th className="num">Total return</th>
                        <th>Allocation</th>
                        <th>Account</th>
                        <th>30d</th>
                    </tr>
                </thead>
                <tbody>
                    {/* A group never holds every row, so this is a filter that left none. */}
                    {items.length === 0 ? (
                        <tr>
                            <td
                                colSpan={COLUMN_COUNT}
                                style={{ textAlign: "center", color: "var(--pm-fg-subtle)", padding: "28px 12px" }}
                            >
                                No positions match the current filter.
                            </td>
                        </tr>
                    ) : (
                        <>
                            {drawn.topSpacer > 0 && (
                                <tr aria-hidden="true">
                                    <td colSpan={COLUMN_COUNT} style={{ height: drawn.topSpacer, padding: 0, borderBottom: 0 }} />
                                </tr>
                            )}
                            {items.slice(drawn.start, drawn.end).map((item, index) => {
                                const ariaRowIndex = drawn.virtualized ? drawn.start + index + 2 : undefined;
                                // A row's ID keys it in or out of the group (never both).
                                return item.kind === "small" ? (
                                    <SmallPositionsRow
                                        key="small-positions"
                                        group={item.group}
                                        open={smallOpen}
                                        onToggle={toggleSmallPositions}
                                        toggleRef={toggleRef}
                                        ariaRowIndex={ariaRowIndex}
                                    />
                                ) : (
                                    <HoldingRow
                                        key={item.row.id}
                                        row={item.row}
                                        small={item.kind === "small-row"}
                                        ariaRowIndex={ariaRowIndex}
                                    />
                                );
                            })}
                            {drawn.bottomSpacer > 0 && (
                                <tr aria-hidden="true">
                                    <td colSpan={COLUMN_COUNT} style={{ height: drawn.bottomSpacer, padding: 0, borderBottom: 0 }} />
                                </tr>
                            )}
                        </>
                    )}
                </tbody>
            </table>
        </div>
    );
}

interface SmallPositionsRowProps {
    group: SmallPositionsTableGroup;
    open: boolean;
    onToggle: () => void;
    toggleRef: Ref<HTMLButtonElement>;
    ariaRowIndex?: number;
}

/**
 * The small positions' row: a button that opens them in place, spanning
 * Ticker to Last, then what they come to together. No sparkline is made up
 * for it, and a dash would say there's no history, so 30d stays empty.
 */
function SmallPositionsRow({ group, open, onToggle, toggleRef, ariaRowIndex }: SmallPositionsRowProps) {
    return (
        <tr className="pm-small-positions-group" data-testid="small-positions-group" aria-rowindex={ariaRowIndex}>
            <td colSpan={6}>
                <div className="pm-small-positions-label">
                    <button
                        type="button"
                        className="pm-small-positions-toggle"
                        aria-expanded={open}
                        ref={toggleRef}
                        onClick={onToggle}
                    >
                        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                        {group.rows.length} small positions
                    </button>
                    <span className="pm-small-positions-note">{group.limitLabel}</span>
                </div>
            </td>
            <td className="num" data-testid="holding-value">
                {fmtCurrency0(group.marketValue)}
                {group.atCost && <span className="pm-card-subtitle" title="None of these has a price yet, so they are valued at what you paid"> at cost</span>}
                {group.partlyAtCost && <span className="pm-card-subtitle" title="Some of these have no price yet, so they are valued at what you paid"> partly at cost</span>}
            </td>
            <td className={`num ${todayClass(group.todayPct)}`} data-testid="holding-today">
                {group.todayPct === null ? "—" : fmtSignedPct(group.todayPct)}
            </td>
            <td className={`num ${returnClass(group.totalReturnPct)}`}>
                {group.totalReturnPct === null ? "—" : fmtSignedPct(group.totalReturnPct)}
            </td>
            <AllocationCell allocationPct={group.allocationPct} />
            <td>
                {/* Not a link: a group has no page of its own. The names are in
                    the tooltip, and in hidden text a screen reader reads out
                    as it does By symbol's link (a title often isn't read).
                    Opened, each position names its account on screen. */}
                {group.accounts.length === 1 ? (
                    <span className="pm-account-pill">{group.accounts[0]}</span>
                ) : (
                    <span className="pm-account-pill" title={group.accounts.join(", ")}>
                        {group.accounts.length} accounts
                        <span className="sr-only">: {group.accounts.join(", ")}</span>
                    </span>
                )}
            </td>
            <td />
        </tr>
    );
}

interface HoldingRowProps {
    row: HoldingsTableRow;
    /** One of the small positions, drawn under their row while it's open, its value to the cent. */
    small?: boolean;
    ariaRowIndex?: number;
}

function HoldingRow({ row, small = false, ariaRowIndex }: HoldingRowProps) {
    return (
        <tr
            aria-rowindex={ariaRowIndex}
            className={small ? "pm-small-position-row" : undefined}
            data-testid={small ? "small-position-row" : undefined}
        >
            <td>
                <div className="pm-holdings-ticker">
                    <span className="pm-holdings-sym">{row.symbol}</span>
                    <span className="pm-holdings-name" title={row.name}>
                        {row.name}
                    </span>
                </div>
            </td>
            <td>
                <span className={`pm-policy-chip is-${row.policyBucketStatus}`}>
                    {policyBucketLabel(row.policyBucket)}
                </span>
            </td>
            <td>
                <ThemeChips weights={row.themeWeights} />
            </td>
            <td className="num">{fmtQty(row.quantity)}</td>
            <td className="num">{fmtCurrency2(row.avgCost)}</td>
            <td className="num">{row.last === null ? "—" : fmtCurrency2(row.last)}</td>
            <td className="num" data-testid="holding-value">
                {small ? formatSmallPositionValue(row.marketValue) : fmtCurrency0(row.marketValue)}
                {row.last === null && <span className="pm-card-subtitle" title="No price yet, so it is valued at what you paid"> at cost</span>}
                {row.partlyAtCost && <span className="pm-card-subtitle" title="Some of these shares have no price yet, so they are valued at what you paid"> partly at cost</span>}
            </td>
            <td className={`num ${todayClass(row.todayPct)}`} data-testid="holding-today">
                {row.todayPct === null ? "—" : fmtSignedPct(row.todayPct)}
            </td>
            <td className={`num ${returnClass(row.totalReturnPct)}`}>
                {row.totalReturnPct === null ? "—" : fmtSignedPct(row.totalReturnPct)}
            </td>
            <AllocationCell allocationPct={row.allocationPct} />
            <td>
                {row.accounts && row.accounts.length > 1 ? (
                    <Link
                        href={`/portfolios/detail/${encodeURIComponent(row.symbol)}`}
                        className="pm-account-pill"
                        title={row.accounts.join(", ")}
                        aria-label={`${row.accounts.length} accounts: ${row.accounts.join(", ")}`}
                    >
                        {row.accounts.length} accounts
                    </Link>
                ) : (
                    <span className="pm-account-pill">{row.account}</span>
                )}
            </td>
            <td>
                <PriceSparkline symbol={row.symbol} />
            </td>
        </tr>
    );
}

interface AllocationCellProps {
    /** 0..100 */
    allocationPct: number;
}

function AllocationCell({ allocationPct }: AllocationCellProps) {
    return (
        <td className="pm-alloc-bar-cell">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div className="pm-alloc-bar">
                    <div
                        className="pm-alloc-bar-fill"
                        style={{
                            width: `${Math.min(100, Math.max(0, allocationPct)).toFixed(1)}%`,
                        }}
                    />
                </div>
                <span className="num" style={{ minWidth: 40, textAlign: "right" }}>
                    {formatAllocationPct(allocationPct)}
                </span>
            </div>
        </td>
    );
}

function ThemeChips({ weights }: { weights: readonly ThemeWeight[] }) {
    const shown = weights.slice(0, 2);
    const remaining = weights.length - shown.length;

    return (
        <div className="pm-theme-chip-list">
            {shown.map((weight) => (
                <span
                    key={weight.theme}
                    className={`pm-theme-chip${weight.theme === "unknown" ? " is-missing" : ""}`}
                    title={`${themeLabel(weight.theme)} · ${(weight.weight * 100).toFixed(0)}%`}
                >
                    {themeLabel(weight.theme)}
                </span>
            ))}
            {remaining > 0 && (
                <span className="pm-theme-chip is-muted">+{remaining}</span>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/** No move from today's session is a neutral dash, never "+0.00%". */
function todayClass(todayPct: number | null): string {
    return todayPct === null ? "pm-num-muted" : todayPct < 0 ? "pm-num-neg" : "pm-num-pos";
}

function returnClass(totalReturnPct: number | null): string {
    return totalReturnPct === null ? "" : totalReturnPct < 0 ? "pm-num-neg" : "pm-num-pos";
}

function fmtQty(q: number): string {
    if (q >= 1000) return q.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (Number.isInteger(q)) return String(q);
    return q.toFixed(2);
}

function fmtCurrency2(n: number): string {
    return `$${n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

function fmtCurrency0(n: number): string {
    return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtSignedPct(n: number): string {
    if (!Number.isFinite(n)) return "0.00%";
    const sign = n >= 0 ? "+" : "−";
    return `${sign}${Math.abs(n).toFixed(2)}%`;
}

