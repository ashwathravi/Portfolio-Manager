"use client";

import { Sparkline } from "@/components/charts";
import type { Sector } from "@/lib/holdings/sector";

/**
 * Phase 4 (AR-74) full sortable Holdings table.
 *
 * Ten columns left→right:
 *   1. Ticker + name stack
 *   2. Qty  (mono, right-aligned)
 *   3. Avg cost (mono, right-aligned)
 *   4. Last (mono, right-aligned)
 *   5. Market value (mono, right-aligned)
 *   6. Today % (green/red)
 *   7. Total return % (green/red)
 *   8. Allocation bar + %
 *   9. Account
 *  10. 30-day sparkline (flipped to red when today's change is negative)
 */

export interface HoldingsTableRow {
    id: string;
    symbol: string;
    name: string;
    sector: Sector;
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

export function HoldingsFullTable({ rows, className }: HoldingsFullTableProps) {
    return (
        <div
            className={`pm-card pm-card-stack${className ? ` ${className}` : ""}`}
            style={{ overflowX: "auto" }}
        >
            <table className="pm-table-full">
                <thead>
                    <tr>
                        <th>Ticker</th>
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
                                colSpan={10}
                                style={{ textAlign: "center", color: "var(--pm-fg-subtle)", padding: "28px 12px" }}
                            >
                                No positions match the current filter.
                            </td>
                        </tr>
                    ) : (
                        rows.map((r) => {
                            const todayNeg = r.todayPct < 0;
                            const spark = r.spark30d ?? synthesizeSpark(r.last, r.symbol);
                            return (
                                <tr key={r.id}>
                                    <td>
                                        <div className="pm-holdings-ticker">
                                            <span className="pm-holdings-sym">{r.symbol}</span>
                                            <span className="pm-holdings-name" title={r.name}>
                                                {r.name}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="num">{fmtQty(r.quantity)}</td>
                                    <td className="num">{fmtCurrency2(r.avgCost)}</td>
                                    <td className="num">{fmtCurrency2(r.last)}</td>
                                    <td className="num">{fmtCurrency0(r.marketValue)}</td>
                                    <td className={`num ${todayNeg ? "pm-num-neg" : "pm-num-pos"}`}>
                                        {fmtSignedPct(r.todayPct)}
                                    </td>
                                    <td className={`num ${r.totalReturnPct < 0 ? "pm-num-neg" : "pm-num-pos"}`}>
                                        {fmtSignedPct(r.totalReturnPct)}
                                    </td>
                                    <td className="pm-alloc-bar-cell">
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <div className="pm-alloc-bar">
                                                <div
                                                    className="pm-alloc-bar-fill"
                                                    style={{
                                                        width: `${Math.min(100, Math.max(0, r.allocationPct)).toFixed(1)}%`,
                                                    }}
                                                />
                                            </div>
                                            <span className="num" style={{ minWidth: 40, textAlign: "right" }}>
                                                {r.allocationPct.toFixed(1)}%
                                            </span>
                                        </div>
                                    </td>
                                    <td>
                                        <span className="pm-account-pill">{r.account}</span>
                                    </td>
                                    <td>
                                        <Sparkline
                                            data={spark}
                                            width={72}
                                            height={22}
                                            color={todayNeg ? "var(--pm-danger)" : "var(--pm-success)"}
                                            strokeWidth={1.25}
                                            ariaLabel={`${r.symbol} 30-day trend`}
                                        />
                                    </td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
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
