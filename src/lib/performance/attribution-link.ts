/**
 * Linking attribution over a period (launch item i50): the segments, the
 * steps the server sends, and Carino-linked BHB effects. No server imports,
 * so the Attribution page can link the period it shows in the browser; the
 * steps themselves are built by attribution-history.ts.
 */

import type { AttributionResult, AttributionSummary } from "./attribution";

export type AttributionBasis = "sector" | "assetClass";

export interface SegmentDefinition {
    key: string;
    label: string;
    /** Benchmark ETFs for a sector segment; none for a segment the benchmark doesn't hold. */
    etfs: readonly string[];
}

/** The benchmark's sectors, then what it doesn't hold. */
export const SECTOR_SEGMENTS: readonly SegmentDefinition[] = [
    { key: "technology", label: "Technology", etfs: ["XLK"] },
    { key: "communication", label: "Communication", etfs: ["XLC"] },
    { key: "consumer", label: "Consumer", etfs: ["XLY", "XLP"] },
    { key: "financials", label: "Financials", etfs: ["XLF"] },
    { key: "healthcare", label: "Healthcare", etfs: ["XLV"] },
    { key: "industrials", label: "Industrials", etfs: ["XLI"] },
    { key: "energy", label: "Energy", etfs: ["XLE"] },
    { key: "materials", label: "Materials", etfs: ["XLB"] },
    { key: "real-estate", label: "Real estate", etfs: ["XLRE"] },
    { key: "utilities", label: "Utilities", etfs: ["XLU"] },
    { key: "other", label: "Funds and other", etfs: [] },
    { key: "cash", label: "Cash", etfs: [] },
];

export const SECTOR_ETFS = SECTOR_SEGMENTS.flatMap((s) => s.etfs);
export const BENCHMARK_ETF = "SPY";

/** Against the S&P 500, all stock: other classes are what the benchmark doesn't hold. */
export const ASSET_CLASS_SEGMENTS: readonly SegmentDefinition[] = [
    { key: "stock", label: "Stocks", etfs: [] },
    { key: "fund", label: "Funds", etfs: [] },
    { key: "preferred", label: "Preferred", etfs: [] },
    { key: "warrant", label: "Warrants and rights", etfs: [] },
    { key: "bond", label: "Bonds", etfs: [] },
    { key: "other", label: "Other", etfs: [] },
    { key: "cash", label: "Cash", etfs: [] },
];

export interface SegmentStep {
    key: string;
    /** Share of the accounts' value at the step's first close. */
    weight: number;
    /** The segment's return over the step; 0 for one with no weight. */
    return: number;
}

export interface AttributionStep {
    from: string;
    to: string;
    /** Each basis' segments, every segment present (weight 0 when nothing's in it). */
    sector: SegmentStep[];
    assetClass: SegmentStep[];
    /** Sector benchmark returns over the step, by sector segment; null when an ETF has no close at either end. */
    benchmarkSectorReturns: Record<string, number> | null;
}

// ---------------------------------------------------------------------------
// Linking
// ---------------------------------------------------------------------------

/** Carino's factor ln(1+r)−ln(1+b) over r−b; its limit 1/(1+r) when they're equal. */
export function carinoFactor(r: number, b: number): number {
    if (Math.abs(r - b) < 1e-12) return 1 / (1 + r);
    return (Math.log1p(r) - Math.log1p(b)) / (r - b);
}

/** The same for a return alone (against 0): links contributions so they add up to the total return. */
function logFactor(r: number): number {
    return Math.abs(r) < 1e-12 ? 1 : Math.log1p(r) / r;
}

/** One step's segments on a basis, each with its benchmark weight and return, and both totals. */
function stepTotals(step: AttributionStep, basis: AttributionBasis, benchmarkWeights: Readonly<Record<string, number>>) {
    const sectorReturns = step.benchmarkSectorReturns!;
    const benchTotal = SECTOR_SEGMENTS.reduce((s, d) => s + (benchmarkWeights[d.key] ?? 0) * (sectorReturns[d.key] ?? 0), 0);
    const segments = (basis === "sector" ? step.sector : step.assetClass).map((seg) => {
        let wB: number;
        let rB: number;
        if (basis === "sector") {
            wB = benchmarkWeights[seg.key] ?? 0;
            rB = seg.key === "cash" ? 0 : seg.key in sectorReturns ? sectorReturns[seg.key] : benchTotal;
        } else {
            wB = seg.key === "stock" ? 1 : 0;
            rB = seg.key === "cash" ? 0 : benchTotal;
        }
        return { ...seg, wB, rB };
    });
    const portTotal = segments.reduce((s, x) => s + x.weight * x.return, 0);
    return { segments, portTotal, benchTotal };
}

export type LinkingProblem =
    /** No step in the period has the benchmark's sector prices at both ends. */
    | "no-steps"
    /** A step lost all the accounts' value or more (a margin account): log-linking has no answer. */
    | "total-loss";

/**
 * Why a period's steps can't be linked, or null when they can. Check it
 * before linkAttribution, whose figures mean nothing otherwise.
 */
export function linkingProblem(
    steps: readonly AttributionStep[],
    benchmarkWeights: Readonly<Record<string, number>>,
): LinkingProblem | null {
    const usable = steps.filter((s) => s.benchmarkSectorReturns !== null);
    if (usable.length === 0) return "no-steps";
    for (const step of usable) {
        const { portTotal, benchTotal } = stepTotals(step, "sector", benchmarkWeights);
        if (!(portTotal > -1) || !(benchTotal > -1)) return "total-loss";
    }
    return null;
}

/**
 * The period's attribution on one basis from its steps: each step's BHB
 * effects, linked so they add up to the period's excess return. Weights
 * shown are the average over the steps; returns are each segment's steps
 * chained. Callers check linkingProblem first: with no usable step, or a
 * step that lost everything, the figures here are meaningless.
 */
export function linkAttribution(
    steps: readonly AttributionStep[],
    basis: AttributionBasis,
    benchmarkWeights: Readonly<Record<string, number>>,
): AttributionSummary {
    const definitions = basis === "sector" ? SECTOR_SEGMENTS : ASSET_CLASS_SEGMENTS;
    type Acc = { weightSum: number; growth: number; benchGrowth: number; contribution: number; allocation: number; selection: number; interaction: number };
    const acc = new Map<string, Acc>(definitions.map((d) => [d.key, { weightSum: 0, growth: 1, benchGrowth: 1, contribution: 0, allocation: 0, selection: 0, interaction: 0 }]));

    // Per step: segment weights and returns on both sides, and the totals.
    const perStep = steps.filter((s) => s.benchmarkSectorReturns !== null).map((step) => stepTotals(step, basis, benchmarkWeights));

    const R = perStep.reduce((g, s) => g * (1 + s.portTotal), 1) - 1;
    const B = perStep.reduce((g, s) => g * (1 + s.benchTotal), 1) - 1;
    const k = carinoFactor(R, B);
    const kR = logFactor(R);
    for (const { segments, portTotal, benchTotal } of perStep) {
        const scale = carinoFactor(portTotal, benchTotal) / k;
        const contributionScale = logFactor(portTotal) / kR;
        for (const x of segments) {
            const a = acc.get(x.key)!;
            a.weightSum += x.weight;
            if (x.weight !== 0) a.growth *= 1 + x.return;
            a.benchGrowth *= 1 + x.rB;
            a.contribution += x.weight * x.return * contributionScale;
            a.allocation += (x.weight - x.wB) * (x.rB - benchTotal) * scale;
            a.selection += x.wB * (x.return - x.rB) * scale;
            a.interaction += (x.weight - x.wB) * (x.return - x.rB) * scale;
        }
    }

    const count = Math.max(1, perStep.length);
    const segments: AttributionResult[] = definitions.map((d) => {
        const a = acc.get(d.key)!;
        const benchmarkWeight = basis === "sector" ? benchmarkWeights[d.key] ?? 0 : d.key === "stock" ? 1 : 0;
        return {
            key: d.key,
            label: d.label,
            portfolioWeight: a.weightSum / count,
            benchmarkWeight,
            portfolioReturn: a.growth - 1,
            benchmarkReturn: a.benchGrowth - 1,
            contribution: a.contribution,
            allocationEffect: a.allocation,
            selectionEffect: a.selection,
            interactionEffect: a.interaction,
            totalEffect: a.allocation + a.selection + a.interaction,
        };
    });
    const sum = (f: (s: AttributionResult) => number) => segments.reduce((s, x) => s + f(x), 0);
    return {
        segments,
        total: {
            portfolioReturn: R,
            benchmarkReturn: B,
            alpha: R - B,
            allocationEffect: sum((s) => s.allocationEffect),
            selectionEffect: sum((s) => s.selectionEffect),
            interactionEffect: sum((s) => s.interactionEffect),
            totalEffect: sum((s) => s.totalEffect),
        },
    };
}
