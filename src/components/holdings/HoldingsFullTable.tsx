"use client";

import { useMemo, useState } from "react";
import { Sparkline } from "@/components/charts";
import type { Sector } from "@/lib/holdings/sector";
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
 *  11. Account
 *  12. 30-day sparkline (flipped to red when today's change is negative)
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
    last: number;
    marketValue: number;
    todayPct: number;
    totalReturnPct: number;
    allocationPct: number; // 0..100
    account: string;
    spark30d?: number[];
}

export interface HoldingsFullTableProps {
    rows: HoldingsTableRow[];
    className?: string;
}

const VIRTUALIZE_AFTER_ROWS = 80;
const VIRTUAL_ROW_HEIGHT = 58;
const VIRTUAL_VIEWPORT_HEIGHT = 640;
const VIRTUAL_OVERSCAN = 8;
const COLUMN_COUNT = 12;

export function HoldingsFullTable({ rows, className }: HoldingsFullTableProps) {
    const [scrollTop, setScrollTop] = useState(0);
    const shouldVirtualize = rows.length > VIRTUALIZE_AFTER_ROWS;
    const virtualState = useMemo(() => {
        if (!shouldVirtualize) {
            return {
                start: 0,
                end: rows.length,
                topSpacer: 0,
                bottomSpacer: 0,
                visibleRows: rows,
            };
        }

        const visibleCount = Math.ceil(VIRTUAL_VIEWPORT_HEIGHT / VIRTUAL_ROW_HEIGHT) + (VIRTUAL_OVERSCAN * 2);
        const maxStart = Math.max(0, rows.length - visibleCount);
        const start = Math.min(
            Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN),
            maxStart,
        );
        const end = Math.min(rows.length, start + visibleCount);
        return {
            start,
            end,
            topSpacer: start * VIRTUAL_ROW_HEIGHT,
            bottomSpacer: Math.max(0, (rows.length - end) * VIRTUAL_ROW_HEIGHT),
            visibleRows: rows.slice(start, end),
        };
    }, [rows, scrollTop, shouldVirtualize]);

    return (
        <div
            className={`pm-card pm-card-stack${className ? ` ${className}` : ""}`}
            data-virtualized={shouldVirtualize ? "true" : "false"}
            onScroll={shouldVirtualize ? (event) => setScrollTop(event.currentTarget.scrollTop) : undefined}
            style={{
                overflowX: "auto",
                ...(shouldVirtualize
                    ? { maxHeight: VIRTUAL_VIEWPORT_HEIGHT, overflowY: "auto" }
                    : null),
            }}
        >
            <table className="pm-table-full" aria-rowcount={rows.length}>
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
                    {rows.length === 0 ? (
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
                            {virtualState.topSpacer > 0 && (
                                <tr aria-hidden="true">
                                    <td colSpan={COLUMN_COUNT} style={{ height: virtualState.topSpacer, padding: 0, borderBottom: 0 }} />
                                </tr>
                            )}
                            {virtualState.visibleRows.map((row, index) => (
                                <HoldingRow
                                    key={row.id}
                                    row={row}
                                    ariaRowIndex={shouldVirtualize ? virtualState.start + index + 2 : undefined}
                                />
                            ))}
                            {virtualState.bottomSpacer > 0 && (
                                <tr aria-hidden="true">
                                    <td colSpan={COLUMN_COUNT} style={{ height: virtualState.bottomSpacer, padding: 0, borderBottom: 0 }} />
                                </tr>
                            )}
                        </>
                    )}
                </tbody>
            </table>
        </div>
    );
}

function HoldingRow({
    row,
    ariaRowIndex,
}: {
    row: HoldingsTableRow;
    ariaRowIndex?: number;
}) {
    const todayNeg = row.todayPct < 0;
    const spark = row.spark30d ?? synthesizeSpark(row.last, row.symbol);

    return (
        <tr aria-rowindex={ariaRowIndex}>
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
            <td className="num">{fmtCurrency2(row.last)}</td>
            <td className="num">{fmtCurrency0(row.marketValue)}</td>
            <td className={`num ${todayNeg ? "pm-num-neg" : "pm-num-pos"}`}>
                {fmtSignedPct(row.todayPct)}
            </td>
            <td className={`num ${row.totalReturnPct < 0 ? "pm-num-neg" : "pm-num-pos"}`}>
                {fmtSignedPct(row.totalReturnPct)}
            </td>
            <td className="pm-alloc-bar-cell">
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div className="pm-alloc-bar">
                        <div
                            className="pm-alloc-bar-fill"
                            style={{
                                width: `${Math.min(100, Math.max(0, row.allocationPct)).toFixed(1)}%`,
                            }}
                        />
                    </div>
                    <span className="num" style={{ minWidth: 40, textAlign: "right" }}>
                        {row.allocationPct.toFixed(1)}%
                    </span>
                </div>
            </td>
            <td>
                <span className="pm-account-pill">{row.account}</span>
            </td>
            <td>
                <Sparkline
                    data={spark}
                    width={72}
                    height={22}
                    color={todayNeg ? "var(--pm-danger)" : "var(--pm-success)"}
                    strokeWidth={1.25}
                    ariaLabel={`${row.symbol} 30-day trend`}
                />
            </td>
        </tr>
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
// Formatters + placeholder sparkline generator (mirrors TopHoldingsCard).
// ---------------------------------------------------------------------------

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

function synthesizeSpark(price: number, seedKey: string): number[] {
    let seed = 0;
    for (let i = 0; i < seedKey.length; i++) {
        seed = (seed * 31 + seedKey.charCodeAt(i)) | 0;
    }
    const rand = mulberry32(seed || 1);
    const base = Math.abs(price) || 1;
    const out: number[] = new Array(30);
    let x = base;
    for (let i = 0; i < 30; i++) {
        x += (rand() - 0.5) * 0.04 * base;
        out[i] = x;
    }
    out[29] = price;
    return out;
}

function mulberry32(a: number): () => number {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
