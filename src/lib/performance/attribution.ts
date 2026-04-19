/**
 * Performance attribution using a simplified Brinson–Hood–Beebower (BHB)
 * decomposition of portfolio excess return vs a benchmark.
 *
 * For each segment (e.g. sector or asset class):
 *   allocation_i = (wP_i - wB_i) * (rB_i - rB_total)
 *   selection_i  =  wB_i        * (rP_i - rB_i)
 *   interaction_i= (wP_i - wB_i) * (rP_i - rB_i)
 *
 * The sum across segments equals total portfolio return minus total benchmark
 * return (alpha), which makes the decomposition internally consistent.
 */

export interface AttributionSegment {
    /** Stable id used as React key and for CSV export. */
    key: string;
    /** Display label (e.g. "Technology"). */
    label: string;
    /** Portfolio weight, expressed as a fraction of 1. */
    portfolioWeight: number;
    /** Benchmark weight, expressed as a fraction of 1. */
    benchmarkWeight: number;
    /** Segment return over the period, expressed as a fraction (0.05 = +5%). */
    portfolioReturn: number;
    /** Benchmark return for the same segment over the period. */
    benchmarkReturn: number;
}

export interface AttributionResult extends AttributionSegment {
    /** Portfolio contribution to total return: wP * rP. */
    contribution: number;
    /** Allocation effect: (wP - wB) * (rB - rB_total). */
    allocationEffect: number;
    /** Selection effect: wB * (rP - rB). */
    selectionEffect: number;
    /** Interaction effect: (wP - wB) * (rP - rB). */
    interactionEffect: number;
    /** Sum of allocation + selection + interaction. */
    totalEffect: number;
}

export interface AttributionTotals {
    portfolioReturn: number;
    benchmarkReturn: number;
    alpha: number;
    allocationEffect: number;
    selectionEffect: number;
    interactionEffect: number;
    totalEffect: number;
}

export interface AttributionSummary {
    segments: AttributionResult[];
    total: AttributionTotals;
}

function sum(values: readonly number[]): number {
    return values.reduce((acc, v) => acc + v, 0);
}

/**
 * Compute per-segment attribution plus the roll-up totals. Zero-weight
 * segments are allowed (they contribute nothing). Weights are *not*
 * re-normalized — callers that pass weights summing to != 1 will see that
 * mismatch reflected in the totals.
 */
export function computeAttribution(segments: readonly AttributionSegment[]): AttributionSummary {
    const portfolioReturn = sum(segments.map((s) => s.portfolioWeight * s.portfolioReturn));
    const benchmarkReturn = sum(segments.map((s) => s.benchmarkWeight * s.benchmarkReturn));

    const results: AttributionResult[] = segments.map((s) => {
        const allocationEffect = (s.portfolioWeight - s.benchmarkWeight) * (s.benchmarkReturn - benchmarkReturn);
        const selectionEffect = s.benchmarkWeight * (s.portfolioReturn - s.benchmarkReturn);
        const interactionEffect = (s.portfolioWeight - s.benchmarkWeight) * (s.portfolioReturn - s.benchmarkReturn);
        return {
            ...s,
            contribution: s.portfolioWeight * s.portfolioReturn,
            allocationEffect,
            selectionEffect,
            interactionEffect,
            totalEffect: allocationEffect + selectionEffect + interactionEffect,
        };
    });

    const total: AttributionTotals = {
        portfolioReturn,
        benchmarkReturn,
        alpha: portfolioReturn - benchmarkReturn,
        allocationEffect: sum(results.map((r) => r.allocationEffect)),
        selectionEffect: sum(results.map((r) => r.selectionEffect)),
        interactionEffect: sum(results.map((r) => r.interactionEffect)),
        totalEffect: sum(results.map((r) => r.totalEffect)),
    };

    return { segments: results, total };
}

// ---------------------------------------------------------------------------
// Default static breakdowns used by the Performance page until holdings are
// wired up to a real data source (AR-12). Weights are the analyst's best
// estimate of a typical balanced growth portfolio; returns are 1Y numbers
// sourced from the synthetic monthly series used elsewhere on the page.
// ---------------------------------------------------------------------------

export const defaultSectorBreakdown: AttributionSegment[] = [
    {
        key: 'technology',
        label: 'Technology',
        portfolioWeight: 0.32,
        benchmarkWeight: 0.27,
        portfolioReturn: 0.2184,
        benchmarkReturn: 0.1830,
    },
    {
        key: 'healthcare',
        label: 'Healthcare',
        portfolioWeight: 0.14,
        benchmarkWeight: 0.13,
        portfolioReturn: 0.0920,
        benchmarkReturn: 0.0810,
    },
    {
        key: 'financials',
        label: 'Financials',
        portfolioWeight: 0.12,
        benchmarkWeight: 0.14,
        portfolioReturn: 0.0540,
        benchmarkReturn: 0.0710,
    },
    {
        key: 'consumer-discretionary',
        label: 'Consumer Discretionary',
        portfolioWeight: 0.10,
        benchmarkWeight: 0.11,
        portfolioReturn: 0.1412,
        benchmarkReturn: 0.1150,
    },
    {
        key: 'industrials',
        label: 'Industrials',
        portfolioWeight: 0.08,
        benchmarkWeight: 0.09,
        portfolioReturn: 0.0781,
        benchmarkReturn: 0.0660,
    },
    {
        key: 'energy',
        label: 'Energy',
        portfolioWeight: 0.06,
        benchmarkWeight: 0.05,
        portfolioReturn: -0.0342,
        benchmarkReturn: -0.0190,
    },
    {
        key: 'communication-services',
        label: 'Communication Services',
        portfolioWeight: 0.08,
        benchmarkWeight: 0.08,
        portfolioReturn: 0.1605,
        benchmarkReturn: 0.1420,
    },
    {
        key: 'other',
        label: 'Other',
        portfolioWeight: 0.10,
        benchmarkWeight: 0.13,
        portfolioReturn: 0.0610,
        benchmarkReturn: 0.0540,
    },
];

export const defaultAssetClassBreakdown: AttributionSegment[] = [
    {
        key: 'equities-us',
        label: 'US Equities',
        portfolioWeight: 0.58,
        benchmarkWeight: 0.55,
        portfolioReturn: 0.1504,
        benchmarkReturn: 0.1310,
    },
    {
        key: 'equities-intl',
        label: 'International Equities',
        portfolioWeight: 0.14,
        benchmarkWeight: 0.18,
        portfolioReturn: 0.0720,
        benchmarkReturn: 0.0810,
    },
    {
        key: 'fixed-income',
        label: 'Fixed Income',
        portfolioWeight: 0.14,
        benchmarkWeight: 0.18,
        portfolioReturn: 0.0380,
        benchmarkReturn: 0.0420,
    },
    {
        key: 'alternatives',
        label: 'Alternatives',
        portfolioWeight: 0.08,
        benchmarkWeight: 0.05,
        portfolioReturn: 0.1120,
        benchmarkReturn: 0.0650,
    },
    {
        key: 'cash',
        label: 'Cash & Equivalents',
        portfolioWeight: 0.06,
        benchmarkWeight: 0.04,
        portfolioReturn: 0.0510,
        benchmarkReturn: 0.0510,
    },
];
