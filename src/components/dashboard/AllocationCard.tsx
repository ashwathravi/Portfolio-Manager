"use client";

import { useMemo, useState } from "react";
import { Donut, type DonutSegment } from "@/components/charts";
import {
    computeBucketAllocation,
    computeThemeExposure,
    policyBucketLabel,
    type PolicyBucketId,
    type ThemeWeight,
} from "@/lib/risk-policy";

/**
 * Phase 3 (AR-71) Allocation donut card.
 *
 * Two groupings toggle-able at the top:
 *   - "Theme"   — sector / theme breakdown (hand-mapped from ticker for now)
 *   - "Account" — per-portfolio breakdown
 *
 * The center of the donut reports total holdings value and the count of
 * groups currently displayed.
 *
 * Color palette:
 *   - Uses a fixed 6-swatch palette rooted in `--pm-accent` so themes and
 *     the accent customizer propagate automatically. When there are more
 *     groups than palette entries, colors cycle.
 */

const PALETTE = [
    "var(--pm-accent)",
    "var(--pm-info)",
    "var(--pm-warn)",
    "var(--pm-success)",
    "var(--pm-danger)",
    "var(--pm-fg-muted)",
] as const;

export interface AllocationHolding {
    symbol: string;
    /** Portfolio name (used for the "Account" grouping). */
    portfolio: string;
    policyBucket?: PolicyBucketId;
    themeWeights?: readonly ThemeWeight[];
    marketValue: number;
}

export interface AllocationCardProps {
    holdings: AllocationHolding[];
    /** Extra cash to include in the "Account" grouping buckets. */
    cashByPortfolio?: Record<string, number>;
    className?: string;
}

type GroupBy = "theme" | "policy" | "account";

export function AllocationCard({
    holdings,
    cashByPortfolio,
    className,
}: AllocationCardProps) {
    const [groupBy, setGroupBy] = useState<GroupBy>("theme");

    const segments: DonutSegment[] = useMemo(
        () => buildSegments(holdings, groupBy, cashByPortfolio),
        [holdings, groupBy, cashByPortfolio],
    );

    const total = segments.reduce((sum, s) => sum + s.value, 0);

    return (
        <section
            className={`pm-card pm-card-stack${className ? ` ${className}` : ""}`}
            aria-label="Allocation"
        >
            <header className="pm-card-header">
                <div>
                    <h3 className="pm-card-title">Allocation</h3>
                    <p className="pm-card-subtitle">
                        {segments.length} {segments.length === 1 ? "group" : "groups"}
                    </p>
                </div>
                <div className="pm-seg-pill" role="radiogroup" aria-label="Group allocation by">
                    <button
                        type="button"
                        role="radio"
                        aria-checked={groupBy === "theme"}
                        className="pm-seg-pill-btn"
                        onClick={() => setGroupBy("theme")}
                    >
                        Theme
                    </button>
                    <button
                        type="button"
                        role="radio"
                        aria-checked={groupBy === "policy"}
                        className="pm-seg-pill-btn"
                        onClick={() => setGroupBy("policy")}
                    >
                        Policy
                    </button>
                    <button
                        type="button"
                        role="radio"
                        aria-checked={groupBy === "account"}
                        className="pm-seg-pill-btn"
                        onClick={() => setGroupBy("account")}
                    >
                        Account
                    </button>
                </div>
            </header>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 200px) 1fr",
                    gap: 16,
                    alignItems: "center",
                }}
            >
                <Donut
                    segments={segments}
                    size={180}
                    thickness={22}
                    ariaLabel={`Allocation by ${groupBy}`}
                    centerLabel={
                        <div>
                            <div className="pm-alloc-center-total">
                                ${formatCompact(total)}
                            </div>
                            <div className="pm-alloc-center-sub">
                                {segments.length} {segments.length === 1 ? "group" : "groups"}
                            </div>
                        </div>
                    }
                />

                <div className="pm-alloc-legend">
                    {segments.length === 0 ? (
                        <p className="pm-card-subtitle">No holdings yet.</p>
                    ) : (
                        segments.map((seg) => {
                            const pct = total > 0 ? (seg.value / total) * 100 : 0;
                            return (
                                <div key={seg.name} className="pm-alloc-row">
                                    <span
                                        className="pm-alloc-swatch"
                                        style={{ background: seg.color }}
                                        aria-hidden="true"
                                    />
                                    <span className="pm-alloc-name" title={seg.name}>
                                        {seg.name}
                                    </span>
                                    <span className="pm-alloc-pct">{pct.toFixed(1)}%</span>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </section>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSegments(
    holdings: AllocationHolding[],
    groupBy: GroupBy,
    cashByPortfolio?: Record<string, number>,
): DonutSegment[] {
    const buckets = new Map<string, number>();

    if (groupBy === "theme") {
        const exposure = computeThemeExposure([
            ...holdings.map((h) => ({
                symbol: h.symbol,
                marketValue: h.marketValue,
                policyBucket: h.policyBucket,
                themeWeights: h.themeWeights,
            })),
            ...cashInputs(cashByPortfolio),
        ]);
        for (const row of exposure.rows) {
            if (row.marketValue > 0) buckets.set(row.label, row.marketValue);
        }
    } else if (groupBy === "policy") {
        const allocation = computeBucketAllocation([
            ...holdings.map((h) => ({
                symbol: h.symbol,
                marketValue: h.marketValue,
                policyBucket: h.policyBucket,
            })),
            ...cashInputs(cashByPortfolio),
        ]);
        for (const row of allocation.rows) {
            if (row.marketValue > 0) {
                buckets.set(policyBucketLabel(row.bucket), row.marketValue);
            }
        }
    } else {
        for (const h of holdings) {
            const key = h.portfolio || "Unassigned";
            buckets.set(key, (buckets.get(key) ?? 0) + h.marketValue);
        }
        if (cashByPortfolio) {
            for (const [portfolio, cash] of Object.entries(cashByPortfolio)) {
                if (cash > 0) {
                    buckets.set(portfolio, (buckets.get(portfolio) ?? 0) + cash);
                }
            }
        }
    }

    const sorted = [...buckets.entries()]
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1]);

    return sorted.map(([name, value], i) => ({
        name,
        value,
        color: PALETTE[i % PALETTE.length] as string,
    }));
}

function cashInputs(cashByPortfolio?: Record<string, number>) {
    if (!cashByPortfolio) return [];
    return Object.entries(cashByPortfolio)
        .filter(([, cash]) => cash > 0)
        .map(([portfolio, cash]) => ({
            id: `cash-${portfolio}`,
            symbol: "USD",
            name: `${portfolio} cash`,
            marketValue: cash,
            policyBucket: "cash_reserve" as const,
            themeWeights: [{
                theme: "bonds_treasuries_cash_equivalent" as const,
                weight: 1,
                source: "explicit" as const,
            }],
        }));
}

function formatCompact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
