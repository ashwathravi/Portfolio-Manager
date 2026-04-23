"use client";

import { type ChangeEvent } from "react";
import type { Sector } from "@/lib/holdings/sector";

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

export function HoldingsFilterRow({
    sectorFilter,
    onSectorChange,
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
    );
}
