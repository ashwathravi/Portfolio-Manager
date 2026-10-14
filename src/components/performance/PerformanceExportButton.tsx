"use client";

import { Download } from "lucide-react";
import { exportToCsv } from "@/lib/exportCsv";
import { getExampleMonthlySeries } from "@/lib/performance/series";
import { monthlyExportRows } from "@/lib/performance/export";

/** Downloads monthly portfolio vs. S&P 500 values and returns as CSV. */
export function PerformanceExportButton() {
    return (
        <button
            type="button"
            className="pm-btn pm-btn-ghost"
            onClick={() => {
                const { portfolio, benchmark } = getExampleMonthlySeries();
                exportToCsv(
                    "atlas-monthly-returns.csv",
                    monthlyExportRows(portfolio, benchmark) as unknown as Record<string, unknown>[],
                );
            }}
        >
            <Download size={14} aria-hidden="true" />
            <span>Export CSV</span>
        </button>
    );
}
