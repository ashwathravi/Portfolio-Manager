import type { HistoricalBar } from "@/lib/api/market-data";
import type { Thesis } from "./thesis";

/**
 * The 30-day price strip on a thesis. Live daily bars when the market data
 * provider answers; otherwise an illustrative shape anchored on the thesis's
 * last saved price. The illustrative path is invented, so it never reports a
 * starting price or a change — only `source` tells the UI to label it.
 */
export type PriceSeriesSource = "live" | "illustrative" | "none";

export interface ThesisPriceSeries {
    source: PriceSeriesSource;
    /** Daily closes over the window (or the illustrative shape). */
    data: number[];
    /** Flat line at the target so the chart shows the gap. */
    benchmark: number[];
    open: number | null;
    now: number | null;
    /** % change from the window's first open to now. Null unless live. */
    changePct: number | null;
    /** Signed % distance to target from the thesis's point of view. */
    toTargetPct: number | null;
}

type PriceInputs = Pick<Thesis, "ticker" | "type" | "targetPrice" | "currentPrice">;

export function buildThesisPriceSeries(
    bars: readonly HistoricalBar[] | undefined,
    thesis: PriceInputs,
): ThesisPriceSeries {
    const target = thesis.targetPrice;
    const saved =
        typeof thesis.currentPrice === "number" && Number.isFinite(thesis.currentPrice) && thesis.currentPrice > 0
            ? thesis.currentPrice
            : null;

    let source: PriceSeriesSource;
    let data: number[];
    let open: number | null = null;
    let now: number | null = null;

    if (bars && bars.length > 0) {
        source = "live";
        data = bars.map((b) => b.close);
        open = bars[0].open ?? bars[0].close;
        now = data[data.length - 1];
    } else if (saved != null) {
        source = "illustrative";
        data = synthesizeWalk(saved, thesis.ticker);
        now = saved;
    } else {
        source = "none";
        data = [];
    }

    const benchmark = data.length > 0 ? new Array<number>(data.length).fill(target) : [];
    const changePct =
        source === "live" && open != null && now != null && open > 0 ? ((now - open) / open) * 100 : null;
    const toTargetPct =
        now != null && now > 0 && target > 0
            ? thesis.type === "bull"
                ? ((target - now) / now) * 100
                : ((now - target) / now) * 100
            : null;

    return { source, data, benchmark, open, now, changePct, toTargetPct };
}

/**
 * Deterministic walk ending at `current`, one point per trading day over a
 * month. Seeded by ticker so the shape is stable between renders.
 */
export function synthesizeWalk(current: number, seedSource: string, points = 22): number[] {
    const drift = 0.02;
    const vol = 0.012;
    const end = Math.max(current, 0.01);
    const start = end / (1 + drift);

    const rand = mulberry32(hashString(seedSource));
    const out = new Array<number>(points);
    for (let i = 0; i < points; i++) {
        const t = i / (points - 1);
        const trend = start + (end - start) * t;
        const noise = (rand() - 0.5) * 2 * vol * end;
        out[i] = trend + noise;
    }
    out[points - 1] = end;
    return out;
}

function hashString(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return h || 1;
}

function mulberry32(a: number): () => number {
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
