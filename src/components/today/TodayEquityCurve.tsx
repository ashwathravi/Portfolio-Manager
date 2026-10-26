import { EquityCurveCard, type Benchmark } from "@/components/performance/EquityCurveCard";
import { isDatabaseConfigured } from "@/db/connection-options";
import { loggableError } from "@/lib/observability/loggable-error";
import { loadReturnHistory, type ReturnHistory } from "@/lib/performance/return-history";
import { DAILY } from "@/lib/performance/periodSummary";

/**
 * Today's equity curve (launch item i52): the user's time-weighted return
 * from their nightly valuations, all accounts together, beside the
 * benchmark ETFs: the series Performance › Returns shows. Nothing until
 * there are two valuations; streamed in, so it never holds up the money
 * above it.
 */
export async function TodayEquityCurve({ userId }: { userId: string }) {
    // Without a database there is no history to read.
    if (!isDatabaseConfigured()) return null;
    let history: ReturnHistory;
    try {
        history = await loadReturnHistory(userId);
    } catch (e) {
        // Logged during a render, so an AggregateError can't go to the console as is.
        console.warn("Today: return history unavailable — no equity curve.", loggableError(e));
        return null;
    }
    if (history.points.length < 2) return null;

    // A step across missed sessions spans several: risk measures scale it back to one.
    const portfolio = history.points.map((p) => ({ date: p.date, value: p.index, periods: Math.max(1, p.sessions) }));
    const benchmarks: Benchmark[] = history.benchmarks.map((b) => ({ key: b.key, label: b.label, series: b.values }));
    return (
        <div data-testid="today-equity-curve">
            <EquityCurveCard portfolio={portfolio} benchmarks={benchmarks} periodsPerYear={DAILY} />
        </div>
    );
}
