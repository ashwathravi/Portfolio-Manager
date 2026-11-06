"use client";

import { type ChangeEvent } from "react";
import type { Sector } from "@/lib/holdings/sector";
import type { HoldingsRowView } from "@/lib/holdings/combine";
import {
    POLICY_BUCKETS,
    THEME_IDS,
    policyBucketLabel,
    themeLabel,
    type PolicyBucketId,
    type ThemeId,
} from "@/lib/risk-policy";

/**
 * Phase 4 (AR-74) Holdings filter row.
 *
 * Left: sector chip buttons: All, then the sectors the holdings are in
 * (the page passes them, largest first).
 * Right: one row per account position or per symbol (only when some symbol
 * is in more than one account), then the bucket, theme and sort selects.
 *
 * Stateless — the parent holds `sectorFilter` and `sortKey`.
 */

export type HoldingsSortKey =
    | "marketValue"
    | "totalReturnPct"
    | "todayPct"
    | "allocationPct";

export interface HoldingsFilterRowProps {
    /** Which sector chip is currently active. "All" means no filter. */
    sectorFilter: Sector | "All";
    onSectorChange: (next: Sector | "All") => void;
    bucketFilter?: PolicyBucketId | "All";
    onBucketChange?: (next: PolicyBucketId | "All") => void;
    themeFilter?: ThemeId | "All";
    onThemeChange?: (next: ThemeId | "All") => void;
    sortKey: HoldingsSortKey;
    onSortChange: (next: HoldingsSortKey) => void;
    rowView?: HoldingsRowView;
    /** Without it there is no choice of rows to offer. */
    onRowViewChange?: (next: HoldingsRowView) => void;
    /** Sectors to show as chips. Caller controls order; defaults to the handoff spec. */
    sectors?: readonly (Sector | "All")[];
    className?: string;
}

const DEFAULT_SECTORS: readonly (Sector | "All")[] = [
    "All",
    "Tech",
    "Consumer",
    "Auto",
    "Finance",
];

const SORT_OPTIONS: ReadonlyArray<{ value: HoldingsSortKey; label: string }> = [
    { value: "marketValue", label: "Market value" },
    { value: "totalReturnPct", label: "Total return" },
    { value: "todayPct", label: "Today" },
    { value: "allocationPct", label: "Allocation" },
];

const ROW_VIEW_OPTIONS: ReadonlyArray<{ value: HoldingsRowView; label: string }> = [
    { value: "account", label: "By account" },
    { value: "symbol", label: "By symbol" },
];

const BUCKET_OPTIONS: readonly (PolicyBucketId | "All")[] = ["All", ...POLICY_BUCKETS];
const THEME_OPTIONS: readonly (ThemeId | "All")[] = ["All", ...THEME_IDS];

export function HoldingsFilterRow({
    sectorFilter,
    onSectorChange,
    bucketFilter = "All",
    onBucketChange,
    themeFilter = "All",
    onThemeChange,
    sortKey,
    onSortChange,
    rowView = "account",
    onRowViewChange,
    sectors = DEFAULT_SECTORS,
    className,
}: HoldingsFilterRowProps) {
    return (
        <div className={`pm-filter-row${className ? ` ${className}` : ""}`}>
            <div className="pm-chip-group" role="radiogroup" aria-label="Filter by sector">
                {sectors.map((s) => {
                    const active = s === sectorFilter;
                    return (
                        <button
                            key={s}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            className={`pm-chip-btn${active ? " is-active" : ""}`}
                            onClick={() => onSectorChange(s)}
                        >
                            {s}
                        </button>
                    );
                })}
            </div>

            <div className="pm-filter-select-group">
                {onRowViewChange && (
                    <div className="pm-chip-group" role="radiogroup" aria-label="Show holdings">
                        {ROW_VIEW_OPTIONS.map((o) => {
                            const active = o.value === rowView;
                            return (
                                <button
                                    key={o.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    className={`pm-chip-btn${active ? " is-active" : ""}`}
                                    onClick={() => onRowViewChange(o.value)}
                                >
                                    {o.label}
                                </button>
                            );
                        })}
                    </div>
                )}
                {onBucketChange && (
                    <label className="pm-sort-select">
                        <span className="pm-sort-label">Bucket</span>
                        <select
                            className="pm-select"
                            value={bucketFilter}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                                onBucketChange(e.target.value as PolicyBucketId | "All")
                            }
                            aria-label="Filter holdings by policy bucket"
                        >
                            {BUCKET_OPTIONS.map((bucket) => (
                                <option key={bucket} value={bucket}>
                                    {bucket === "All" ? "All buckets" : policyBucketLabel(bucket)}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                {onThemeChange && (
                    <label className="pm-sort-select">
                        <span className="pm-sort-label">Theme</span>
                        <select
                            className="pm-select"
                            value={themeFilter}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                                onThemeChange(e.target.value as ThemeId | "All")
                            }
                            aria-label="Filter holdings by theme"
                        >
                            {THEME_OPTIONS.map((theme) => (
                                <option key={theme} value={theme}>
                                    {theme === "All" ? "All themes" : themeLabel(theme)}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                <label className="pm-sort-select">
                    <span className="pm-sort-label">Sort</span>
                    <select
                        className="pm-select"
                        value={sortKey}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                            onSortChange(e.target.value as HoldingsSortKey)
                        }
                        aria-label="Sort holdings by"
                    >
                        {SORT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
        </div>
    );
}
