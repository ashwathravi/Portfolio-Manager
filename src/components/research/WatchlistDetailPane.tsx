"use client";

import Link from "next/link";
import { useState } from "react";
import { SampleTag } from "@/components/data-display/SampleTag";
import { distanceToEntryPct, type WatchItem } from "@/lib/research/watchlist";
import type { Thesis } from "@/lib/research/thesis";

/**
 * Research › Watchlist detail. Shows why a ticker is on the list, the live
 * price against the entry the user wants, and the next steps (thesis, draft
 * order, position). Reason, target entry, and notes edit in place and save
 * when the field loses focus.
 */
export function WatchlistDetailPane({
    item,
    livePrice,
    thesis,
    onUpdate,
    onRemove,
}: {
    item: WatchItem;
    livePrice: number | null;
    thesis: Thesis | undefined;
    onUpdate: (patch: { reason?: string; notes?: string; targetEntry?: number | null }) => void;
    onRemove: () => void;
}) {
    const distance = distanceToEntryPct(livePrice, item.targetEntry);

    return (
        <>
            <header className="pm-thesis-detail-head">
                <div className="pm-thesis-detail-head-main">
                    <div className="pm-thesis-detail-titlerow">
                        <span className="pm-thesis-detail-sym">{item.ticker}</span>
                        {item.sample && <SampleTag />}
                    </div>
                    <h2 className="pm-card-title pm-thesis-detail-title">
                        {item.companyName || item.ticker}
                    </h2>
                    <p className="pm-card-subtitle">On your watchlist since {formatDay(item.addedAt)}</p>
                </div>
                <div className="pm-research-pane-actions">
                    <Link href={`/execution?symbol=${encodeURIComponent(item.ticker)}`} className="pm-btn pm-btn-ghost">
                        Draft order
                    </Link>
                    <button type="button" className="pm-btn pm-btn-ghost" onClick={onRemove}>
                        Remove
                    </button>
                </div>
            </header>

            <section className="pm-thesis-detail-section" aria-label="Price and entry">
                <div className="pm-thesis-detail-readouts">
                    <Readout label="Price" value={livePrice != null ? `$${livePrice.toFixed(2)}` : "—"} />
                    <Readout label="Entry" value={item.targetEntry != null ? `$${item.targetEntry.toFixed(2)}` : "—"} />
                    <Readout
                        label="To entry"
                        value={distance != null ? `${distance > 0 ? "+" : distance < 0 ? "−" : ""}${Math.abs(distance).toFixed(1)}%` : "—"}
                    />
                </div>
                {livePrice == null && (
                    <p className="pm-watch-detail-note">No live quote right now, so there is no distance to your entry.</p>
                )}
            </section>

            <section className="pm-thesis-detail-section pm-watch-detail-form" aria-label="Your notes">
                <EditableField
                    key={`reason-${item.id}`}
                    label="Why it is on the list"
                    initial={item.reason}
                    placeholder="What would make you buy?"
                    onSave={(reason) => onUpdate({ reason })}
                />
                <EditableField
                    key={`target-${item.id}`}
                    label="Target entry ($)"
                    initial={item.targetEntry != null ? String(item.targetEntry) : ""}
                    placeholder="e.g. 145"
                    inputMode="decimal"
                    onSave={(v) => onUpdate({ targetEntry: v.trim() === "" ? null : Number(v) })}
                />
                <EditableField
                    key={`notes-${item.id}`}
                    label="Notes"
                    initial={item.notes}
                    placeholder="Levels, catalysts, what to check first"
                    multiline
                    onSave={(notes) => onUpdate({ notes })}
                />
            </section>

            <section className="pm-thesis-detail-section" aria-label="Thesis">
                {thesis ? (
                    <p className="pm-watch-detail-thesis">
                        Thesis: <Link href={`/research/thesis/${thesis.ticker}`}>{thesis.title}</Link>
                    </p>
                ) : (
                    <p className="pm-watch-detail-thesis">
                        No thesis yet. <Link href={`/research/thesis/${item.ticker}`}>Write one</Link> before you buy.
                    </p>
                )}
                <p className="pm-watch-detail-thesis">
                    <Link href={`/portfolios/detail/${item.ticker}`}>View {item.ticker} position and quote</Link>
                </p>
            </section>
        </>
    );
}

function EditableField({
    label,
    initial,
    placeholder,
    multiline,
    inputMode,
    onSave,
}: {
    label: string;
    initial: string;
    placeholder: string;
    multiline?: boolean;
    inputMode?: "decimal";
    onSave: (value: string) => void;
}) {
    const [value, setValue] = useState(initial);
    const commit = () => {
        if (value !== initial) onSave(value);
    };
    return (
        <label className="pm-exec-field">
            <span className="pm-exec-field-label">{label}</span>
            {multiline ? (
                <textarea
                    className="pm-exec-input"
                    rows={3}
                    value={value}
                    placeholder={placeholder}
                    onChange={(e) => setValue(e.target.value)}
                    onBlur={commit}
                />
            ) : (
                <input
                    className="pm-exec-input"
                    value={value}
                    placeholder={placeholder}
                    inputMode={inputMode}
                    onChange={(e) => setValue(e.target.value)}
                    onBlur={commit}
                />
            )}
        </label>
    );
}

function Readout({ label, value }: { label: string; value: string }) {
    return (
        <div className="pm-readout">
            <span className="pm-readout-label">{label}</span>
            <span className="pm-readout-value num">{value}</span>
        </div>
    );
}

function formatDay(iso: string): string {
    const t = Date.parse(`${iso}T00:00:00Z`);
    if (!Number.isFinite(t)) return "—";
    return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
