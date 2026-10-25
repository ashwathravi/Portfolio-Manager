/**
 * Attribution from the user's own history (launch item i50): Brinson (BHB)
 * effects for each step between valuation snapshots, linked over a period.
 *
 * Portfolio side. A step runs from one snapshot date to the next, like a
 * Returns step (holdings-returns.ts): positions held at the first close,
 * grouped into segments (sectors from the securities master, or asset
 * classes), each segment's weight its share of the accounts' value and its
 * return its positions' close-to-close change. Cash is a segment of its own
 * that earns nothing. So the portfolio's step return is the Returns page's.
 *
 * Benchmark side. The S&P 500 by sector: each sector's return is its SPDR
 * sector ETF's (consumer is discretionary and staples together), weighted
 * by the S&P 500's sector weights. Free data doesn't publish those weights,
 * so they are estimated from prices: the non-negative weights, summing to
 * 1, with which the sector ETFs' daily returns best match SPY's over the
 * past year (returns-based style analysis). The ETFs make up the index
 * between them, so the fit is close. The benchmark's return is then the
 * weighted sum of the sector returns, which BHB needs to add up.
 *
 * Linking. A step's effects add up to its excess return; over a period
 * they are linked with Carino's logarithmic factors, so the period's
 * effects add up to its excess return (portfolio TWR minus benchmark), and
 * segments' contributions, linked the same way, to the portfolio's return.
 */

import { closeOn } from "./holdings-returns";
import {
    ASSET_CLASS_SEGMENTS,
    SECTOR_ETFS,
    BENCHMARK_ETF,
    SECTOR_SEGMENTS,
    type AttributionBasis,
    type SegmentDefinition,
    type SegmentStep,
} from "./attribution-link";
import { isSector, type Sector } from "@/lib/holdings/sector";
import { assetClassFor, type AssetClass } from "@/lib/markets/security-profile";
import type { StoredClose } from "@/lib/portfolio/valuation-snapshots";

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

const SECTOR_SEGMENT_OF: Record<Sector, string> = {
    Tech: "technology",
    Communication: "communication",
    Consumer: "consumer",
    Auto: "consumer", // the S&P puts autos in consumer discretionary
    Finance: "financials",
    Healthcare: "healthcare",
    Industrials: "industrials",
    Energy: "energy",
    Materials: "materials",
    "Real estate": "real-estate",
    Utilities: "utilities",
    Funds: "other",
    Crypto: "other",
    Bonds: "other",
    Commodities: "other",
    Other: "other",
};

const ASSET_CLASS_SEGMENT_OF: Record<AssetClass, string> = {
    Stock: "stock",
    Fund: "fund",
    Preferred: "preferred",
    "Warrant or right": "warrant",
    Bond: "bond",
    Other: "other",
};

/** A held symbol's segment on each basis. */
export interface SymbolSegments {
    sector: string;
    assetClass: string;
}

/** Segments from a stored profile (sector, security type), or the fallback sector. */
export function symbolSegments(profile: { sector: string | null; type: string | null } | undefined, fallbackSector: Sector): SymbolSegments {
    const sector = profile?.sector && isSector(profile.sector) ? profile.sector : fallbackSector;
    return {
        sector: SECTOR_SEGMENT_OF[sector],
        assetClass: ASSET_CLASS_SEGMENT_OF[assetClassFor(profile?.type)],
    };
}

// ---------------------------------------------------------------------------
// Benchmark weights: returns-based style analysis
// ---------------------------------------------------------------------------

/** Fewest daily returns the benchmark weights are estimated from. */
export const MIN_STYLE_RETURNS = 60;
/** The past year of sessions. */
export const STYLE_WINDOW_RETURNS = 252;

/** Euclidean projection onto { w ≥ 0, Σw = 1 } (Duchi et al., 2008). */
export function projectToSimplex(v: readonly number[]): number[] {
    const sorted = [...v].sort((a, b) => b - a);
    let cumulative = 0;
    let theta = 0;
    for (let i = 0; i < sorted.length; i++) {
        cumulative += sorted[i];
        const t = (cumulative - 1) / (i + 1);
        if (sorted[i] - t > 0) theta = t;
    }
    return v.map((x) => Math.max(0, x - theta));
}

/**
 * The non-negative weights, summing to 1, with which `factors` (one row of
 * returns per day) best reproduce `target`, by least squares: projected
 * gradient descent, which converges for this small, well-conditioned
 * problem.
 */
export function styleWeights(target: readonly number[], factors: ReadonlyArray<readonly number[]>, iterations = 5_000): number[] {
    const n = factors[0]?.length ?? 0;
    if (n === 0) return [];
    // Normal equations: minimize ½wᵀAw − bᵀw, A = FᵀF, b = Fᵀy.
    const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const b = new Array<number>(n).fill(0);
    for (let t = 0; t < factors.length; t++) {
        const row = factors[t];
        for (let i = 0; i < n; i++) {
            b[i] += row[i] * target[t];
            for (let j = 0; j < n; j++) A[i][j] += row[i] * row[j];
        }
    }
    // Step 1/L, L ≥ the largest eigenvalue of A (its largest row sum).
    const L = Math.max(...A.map((row) => row.reduce((s, x) => s + Math.abs(x), 0)), 1e-12);
    let w = new Array<number>(n).fill(1 / n);
    for (let k = 0; k < iterations; k++) {
        const gradient = A.map((row, i) => row.reduce((s, x, j) => s + x * w[j], 0) - b[i]);
        w = projectToSimplex(w.map((x, i) => x - gradient[i] / L));
    }
    return w;
}

export interface BenchmarkWeights {
    /** By sector segment. */
    segments: Record<string, number>;
    /** By sector ETF (consumer's two ETFs are blended by these). */
    etfs: Record<string, number>;
    /** Daily returns the estimate came from. */
    returns: number;
}

/**
 * The S&P 500's sector weights, estimated from the last STYLE_WINDOW_RETURNS
 * daily returns on `dates` (session dates, oldest first) where SPY and every
 * sector ETF have a close on both days; null with fewer than
 * MIN_STYLE_RETURNS such returns.
 */
export function estimateBenchmarkWeights(
    dates: readonly string[],
    closes: ReadonlyMap<string, readonly StoredClose[]>,
): BenchmarkWeights | null {
    const exact = new Map<string, Map<string, number>>();
    for (const symbol of [BENCHMARK_ETF, ...SECTOR_ETFS]) {
        exact.set(symbol, new Map((closes.get(symbol) ?? []).map((c) => [c.date, c.close])));
    }
    const target: number[] = [];
    const rows: number[][] = [];
    for (let i = 1; i < dates.length; i++) {
        const prev = dates[i - 1];
        const day = dates[i];
        const ratio = (symbol: string) => {
            const a = exact.get(symbol)?.get(prev);
            const z = exact.get(symbol)?.get(day);
            return a && z && a > 0 ? z / a - 1 : null;
        };
        const spy = ratio(BENCHMARK_ETF);
        const sectors = SECTOR_ETFS.map(ratio);
        if (spy === null || sectors.some((r) => r === null)) continue;
        target.push(spy);
        rows.push(sectors as number[]);
    }
    if (target.length < MIN_STYLE_RETURNS) return null;
    const recent = target.length - Math.min(target.length, STYLE_WINDOW_RETURNS);
    const weights = styleWeights(target.slice(recent), rows.slice(recent));
    const etfs = Object.fromEntries(SECTOR_ETFS.map((etf, i) => [etf, weights[i]]));
    return {
        segments: Object.fromEntries(
            SECTOR_SEGMENTS.map((segment) => [segment.key, segment.etfs.reduce((s, etf) => s + (etfs[etf] ?? 0), 0)]),
        ),
        etfs,
        returns: target.length - recent,
    };
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export interface StepSnapshot {
    date: string;
    totalValue: number;
    positions: ReadonlyArray<{ symbol: string; marketValue: number | null }>;
}

/**
 * One step's portfolio segments: the snapshots at `from` (one account's, or
 * several), their positions priced from `from` to `to`. A position without
 * a close at either end is counted as unchanged; one the snapshot couldn't
 * value is in no segment (nor in the total). What the positions don't
 * account for of the total is cash. Null when nothing was invested.
 */
export function stepSegments(
    snapshots: readonly StepSnapshot[],
    to: string,
    closes: ReadonlyMap<string, readonly StoredClose[]>,
    segmentsOf: (symbol: string) => SymbolSegments,
): { sector: SegmentStep[]; assetClass: SegmentStep[] } | null {
    const base = snapshots.reduce((s, snapshot) => s + snapshot.totalValue, 0);
    if (!(base > 0)) return null;
    const value = { sector: new Map<string, number>(), assetClass: new Map<string, number>() };
    const gain = { sector: new Map<string, number>(), assetClass: new Map<string, number>() };
    let invested = 0;
    for (const snapshot of snapshots) {
        for (const { symbol, marketValue } of snapshot.positions) {
            if (marketValue === null || !Number.isFinite(marketValue) || marketValue === 0) continue;
            const from = closeOn(closes.get(symbol), snapshot.date);
            const at = closeOn(closes.get(symbol), to);
            const g = from !== null && at !== null ? marketValue * (at / from - 1) : 0;
            const segments = segmentsOf(symbol);
            for (const basis of ["sector", "assetClass"] as const) {
                const key = segments[basis];
                value[basis].set(key, (value[basis].get(key) ?? 0) + marketValue);
                gain[basis].set(key, (gain[basis].get(key) ?? 0) + g);
            }
            invested += marketValue;
        }
    }
    const build = (basis: AttributionBasis, definitions: readonly SegmentDefinition[]): SegmentStep[] =>
        definitions.map(({ key }) => {
            const v = key === "cash" ? base - invested : value[basis].get(key) ?? 0;
            return { key, weight: v / base, return: v !== 0 && key !== "cash" ? (gain[basis].get(key) ?? 0) / v : 0 };
        });
    return { sector: build("sector", SECTOR_SEGMENTS), assetClass: build("assetClass", ASSET_CLASS_SEGMENTS) };
}

/**
 * Each sector segment's benchmark return over a step, from its ETFs
 * (consumer's two blended by their estimated weights); null when an ETF has
 * no close at either end.
 */
export function benchmarkSectorReturns(
    from: string,
    to: string,
    closes: ReadonlyMap<string, readonly StoredClose[]>,
    etfWeights: Readonly<Record<string, number>> = {},
): Record<string, number> | null {
    const out: Record<string, number> = {};
    for (const segment of SECTOR_SEGMENTS) {
        if (segment.etfs.length === 0) continue;
        let weighted = 0;
        let total = 0;
        for (const etf of segment.etfs) {
            const a = closeOn(closes.get(etf), from);
            const z = closeOn(closes.get(etf), to);
            if (a === null || z === null) return null;
            const w = segment.etfs.length === 1 ? 1 : Math.max(etfWeights[etf] ?? 0, 1e-9);
            weighted += w * (z / a - 1);
            total += w;
        }
        out[segment.key] = total > 0 ? weighted / total : 0;
    }
    return out;
}

export {
    ASSET_CLASS_SEGMENTS,
    BENCHMARK_ETF,
    carinoFactor,
    linkAttribution,
    SECTOR_ETFS,
    SECTOR_SEGMENTS,
    type AttributionBasis,
    type AttributionStep,
    type SegmentDefinition,
    type SegmentStep,
} from "./attribution-link";
