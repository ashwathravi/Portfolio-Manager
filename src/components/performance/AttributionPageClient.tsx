"use client";

import {
    attributionHeadline,
    computeAttribution,
    defaultAssetClassBreakdown,
    defaultSectorBreakdown,
    formatPp,
} from "@/lib/performance/attribution";
import { AttributionBarsCard } from "./AttributionBarsCard";
import { AttributionTableCard } from "./AttributionTableCard";
import { SampleDataNotice } from "@/components/data-display/SampleDataNotice";
import { SampleEmptyState } from "@/components/data-display/SampleEmptyState";
import { SampleGate } from "@/components/data-display/SampleGate";

/**
 * Performance › Attribution. Was a card squeezed beside the period table on
 * Returns; the review board's IA gives it its own tab: a plain-language
 * answer first, then the bars, then the full table.
 */
export function AttributionPageClient() {
    const headline = attributionHeadline(computeAttribution(defaultSectorBreakdown));
    return (
        <div className="pm-perf-stack">
            <SampleGate
                fallback={
                    <SampleEmptyState
                        title="No attribution yet"
                        body="Attribution compares what you owned and how it did against a benchmark. It needs your account history. Connect an account to start."
                    />
                }
            >
                <SampleDataNotice>
                    Attribution uses example sector weights and returns until account history is connected.
                </SampleDataNotice>

                <section className="pm-card pm-attr-lede" aria-label="Attribution summary" data-testid="attribution-lede">
                    <p className="pm-attr-verdict">{headline.verdict}.</p>
                    <p className="pm-card-subtitle">
                        Mostly {headline.mainDriver.name} ({formatPp(headline.mainDriver.value)})
                        {headline.biggestMove && (
                            <>
                                ; the biggest single move was {headline.biggestMove.name} in {headline.biggestMove.label} (
                                {formatPp(headline.biggestMove.value)})
                            </>
                        )}
                        . Allocation is what you chose to own, selection is how your picks did within each group.
                    </p>
                </section>

                <AttributionBarsCard sectors={defaultSectorBreakdown} assetClasses={defaultAssetClassBreakdown} />
                <AttributionTableCard sectors={defaultSectorBreakdown} assetClasses={defaultAssetClassBreakdown} />
            </SampleGate>
        </div>
    );
}
