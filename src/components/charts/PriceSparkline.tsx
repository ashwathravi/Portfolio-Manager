"use client";

import { useHistoricalQuery } from "@/lib/api/market-data/queries";
import { Sparkline } from "./Sparkline";

/**
 * A 30-day sparkline of real daily closes for one symbol. When the market
 * data provider can't answer, it renders a dash instead of an invented line
 * (both the holdings table and Today used to draw a seeded random walk).
 * react-query dedupes the request across every row showing the same symbol.
 */
export function PriceSparkline({
    symbol,
    width = 72,
    height = 22,
}: {
    symbol: string;
    width?: number;
    height?: number;
}) {
    const { data: bars } = useHistoricalQuery(symbol, "1M", { retry: false, staleTime: 15 * 60_000 });
    const closes = (bars ?? []).map((b) => b.close).filter((c) => Number.isFinite(c));

    if (closes.length < 2) {
        return (
            <span className="pm-spark-empty" data-testid="spark-empty" title="No price history available">
                —
            </span>
        );
    }

    const down = closes[closes.length - 1] < closes[0];
    return (
        <Sparkline
            data={closes}
            width={width}
            height={height}
            color={down ? "var(--pm-danger)" : "var(--pm-success)"}
            strokeWidth={1.25}
            ariaLabel={`${symbol} 30-day trend`}
        />
    );
}
