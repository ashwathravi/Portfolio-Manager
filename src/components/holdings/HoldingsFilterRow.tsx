"use client";

import { type ChangeEvent } from "react";
import type { Sector } from "@/lib/holdings/sector";
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
 * Left: sector chip buttons (All + 4 sectors from the handoff spec).
 * Right: a single-select for the sort key.
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
