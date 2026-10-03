"use client";

import Link from "next/link";
import type { JournalEntry } from "@/lib/research/journal";
import type { Thesis } from "@/lib/research/thesis";

/**
 * Research › Journal detail: one decision beside the thesis it was made
 * under, so the reasoning at the time can be checked against the plan.
 */
export function JournalDetailPane({
    entry,
    thesis,
    onEdit,
}: {
    entry: JournalEntry;
    thesis: Thesis | undefined;
    onEdit: () => void;
}) {
    const typeLabel = entry.type === "entry" ? "Entry" : entry.type === "exit" ? "Exit" : "Hold";
    return (
        <>
            <header className="pm-thesis-detail-head">
                <div className="pm-thesis-detail-head-main">
                    <div className="pm-thesis-detail-titlerow">
                        <span className="pm-thesis-detail-sym">{entry.ticker}</span>
                        <span className="pm-chip-conv">{typeLabel}</span>
                        {entry.outcome !== "pending" && (
                            <span className={`pm-journal-outcome pm-journal-outcome-${entry.outcome}`}>{entry.outcome}</span>
                        )}
                    </div>
                    <h2 className="pm-card-title pm-thesis-detail-title">{entry.decision}</h2>
                    <p className="pm-card-subtitle">
                        {new Date(entry.date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            timeZone: "UTC",
                        })}
                    </p>
                </div>
                <div className="pm-research-pane-actions">
                    <button type="button" className="pm-btn pm-btn-ghost" onClick={onEdit}>
                        Edit
                    </button>
                </div>
            </header>

            <section className="pm-thesis-detail-section" aria-label="Rationale at the time">
                <span className="pm-thesis-detail-eyebrow">RATIONALE AT THE TIME</span>
                <p className="pm-thesis-detail-lede">{entry.rationale || "No rationale recorded."}</p>
            </section>

            <section className="pm-thesis-detail-section" aria-label="Linked thesis">
                <span className="pm-thesis-detail-eyebrow">THESIS</span>
                {thesis ? (
                    <div className="pm-journal-detail-thesis">
                        <Link href={`/research/thesis/${thesis.ticker}`} className="pm-card-title">
                            {thesis.title}
                        </Link>
                        <p className="pm-card-subtitle">
                            {thesis.type === "bull" ? "Bull" : "Bear"} · target ${thesis.targetPrice.toFixed(2)} · {thesis.timeHorizon}
                        </p>
                        {thesis.hypothesis && <p className="pm-thesis-detail-lede">{thesis.hypothesis}</p>}
                    </div>
                ) : (
                    <p className="pm-watch-detail-thesis">
                        This decision is not linked to a thesis. Decisions without one are harder to review later.
                    </p>
                )}
            </section>
        </>
    );
}
