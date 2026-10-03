"use client";

import { useMemo, useState } from "react";
import {
    computeAttribution,
    formatPp,
    type AttributionSegment,
} from "@/lib/performance/attribution";

/**
 * Performance › Attribution — the full Brinson (BHB) table: weights and
 * returns for each segment beside the three effects, with totals. The bar
 * card above shows one effect at a time; this is where the numbers add up.
 */
export function AttributionTableCard({
    sectors,
    assetClasses,
}: {
    sectors: AttributionSegment[];
    assetClasses: AttributionSegment[];
}) {
    const [basis, setBasis] = useState<"sector" | "assetClass">("sector");
    const summary = useMemo(
        () => computeAttribution(basis === "sector" ? sectors : assetClasses),
        [basis, sectors, assetClasses],
    );
    const pct = (f: number) => `${(f * 100).toFixed(1)}%`;
    const tone = (f: number) => (Math.round(f * 1000) === 0 ? "" : f > 0 ? "pm-num-pos" : "pm-num-neg");

    return (
        <section className="pm-card pm-card-stack" aria-labelledby="pm-attr-table-title" data-testid="attribution-table">
            <header className="pm-card-header">
                <div>
                    <h2 id="pm-attr-table-title" className="pm-card-title">Where the difference came from</h2>
                    <p className="pm-card-subtitle">Weights, returns, and each effect in percentage points of excess return</p>
                </div>
                <div className="pm-seg-pill" role="radiogroup" aria-label="Table basis">
                    {(["sector", "assetClass"] as const).map((b) => (
                        <button
                            key={b}
                            type="button"
                            role="radio"
                            aria-checked={basis === b}
                            className="pm-seg-pill-btn"
                            onClick={() => setBasis(b)}
                        >
                            {b === "sector" ? "Sector" : "Asset class"}
                        </button>
                    ))}
                </div>
            </header>
            <div className="pm-table-scroll">
                <table className="pm-table-full pm-attr-table">
                    <thead>
                        <tr>
                            <th scope="col">{basis === "sector" ? "Sector" : "Asset class"}</th>
                            <th scope="col" className="num">Your weight</th>
                            <th scope="col" className="num">Bench weight</th>
                            <th scope="col" className="num">Your return</th>
                            <th scope="col" className="num">Bench return</th>
                            <th scope="col" className="num">Allocation</th>
                            <th scope="col" className="num">Selection</th>
                            <th scope="col" className="num">Interaction</th>
                            <th scope="col" className="num">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {summary.segments.map((s) => (
                            <tr key={s.key}>
                                <th scope="row">{s.label}</th>
                                <td className="num">{pct(s.portfolioWeight)}</td>
                                <td className="num">{pct(s.benchmarkWeight)}</td>
                                <td className="num">{pct(s.portfolioReturn)}</td>
                                <td className="num">{pct(s.benchmarkReturn)}</td>
                                <td className={`num ${tone(s.allocationEffect)}`}>{formatPp(s.allocationEffect)}</td>
                                <td className={`num ${tone(s.selectionEffect)}`}>{formatPp(s.selectionEffect)}</td>
                                <td className={`num ${tone(s.interactionEffect)}`}>{formatPp(s.interactionEffect)}</td>
                                <td className={`num ${tone(s.totalEffect)}`}>{formatPp(s.totalEffect)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        <tr>
                            <th scope="row">Total</th>
                            <td className="num" colSpan={2} />
                            <td className="num">{pct(summary.total.portfolioReturn)}</td>
                            <td className="num">{pct(summary.total.benchmarkReturn)}</td>
                            <td className={`num ${tone(summary.total.allocationEffect)}`}>{formatPp(summary.total.allocationEffect)}</td>
                            <td className={`num ${tone(summary.total.selectionEffect)}`}>{formatPp(summary.total.selectionEffect)}</td>
                            <td className={`num ${tone(summary.total.interactionEffect)}`}>{formatPp(summary.total.interactionEffect)}</td>
                            <td className={`num ${tone(summary.total.totalEffect)}`}>{formatPp(summary.total.totalEffect)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </section>
    );
}
