/**
 * Barrel export for the Phase 2 (AR-69) SVG chart primitives.
 *
 * Import from this module so callers don't need to remember which file
 * each chart lives in:
 *
 *     import { AreaChart, Sparkline, Donut, BarChart } from "@/components/charts";
 */

export { AreaChart, type AreaChartProps, type AreaChartRange } from "./AreaChart";
export { Sparkline, type SparklineProps } from "./Sparkline";
export { Donut, type DonutProps, type DonutSegment } from "./Donut";
export { BarChart, type BarChartProps, type BarDatum } from "./BarChart";

// The existing recharts-based PerformanceChart stays where it is — it's
// used by the Performance page today and will be retired (and its import
// replaced with the new AreaChart) in Phase 4 (AR-75).
export { PerformanceChart } from "./PerformanceChart";
