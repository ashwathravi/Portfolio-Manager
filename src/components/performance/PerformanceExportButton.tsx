"use client";

import { Download } from "lucide-react";
import { exportToCsv } from "@/lib/exportCsv";
import type { DailyExportRow, MonthlyExportRow } from "@/lib/performance/export";

/**
 * Downloads the rows the page rendered its charts from: the user's daily
 * history, or the example months. The server builds them with the charts,
 * so the export holds the same dates even if the page stays open past a
 * month end.
 */
export function PerformanceExportButton({
    filename,
    rows,
}: {
    filename: string;
    rows: ReadonlyArray<DailyExportRow | MonthlyExportRow>;
}) {
    return (
        <button
            type="button"
            className="pm-btn pm-btn-ghost"
            onClick={() => exportToCsv(filename, rows as unknown as Record<string, unknown>[])}
        >
            <Download size={14} aria-hidden="true" />
            <span>Export CSV</span>
        </button>
    );
}
