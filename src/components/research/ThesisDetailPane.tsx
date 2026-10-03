"use client";

import { SampleTag } from "@/components/data-display/SampleTag";
import { isSeedThesis } from "@/lib/research/thesis";
import Link from "next/link";
import { useMemo } from "react";
import { Archive, ArchiveRestore, ExternalLink, MoreHorizontal, Trash2 } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AreaChart } from "@/components/charts";
import { useHistoricalQuery } from "@/lib/api/market-data/queries";
import { buildThesisPriceSeries } from "@/lib/research/priceSeries";
import type {
    Thesis,
    ThesisCatalyst,
    ThesisConviction,
    ThesisEvidence,
} from "@/lib/research/thesis";

/**
 * Phase 5 (AR-79) Research thesis detail pane.
 *
 * Renders the right column of the Research workspace when a thesis is
 * selected. Layout (top → bottom):
 *
 *   1. Header — ticker · title + bull/bear chip + conviction chip and
 *      the action row (Open full view / Edit / ⋯ menu with Archive|Restore
 *      and Delete).
 *   2. Lede — one-line description.
 *   3. Price · 30 days — mini AreaChart with 4-readout strip
 *      (30 days ago / Now / Target / % to target). Pulls daily bars via
 *      `useHistoricalQuery` and falls back to a synthesized walk anchored
 *      on `thesis.currentPrice` (tagged "Illustrative", no day change) when
 *      the provider fails or returns nothing.
 *   4. HYPOTHESIS + FALSIFY IF — 2-column grid. Left is the full
 *      `thesis.hypothesis` paragraph; right frames the opposing case
 *      ("This thesis is wrong if…") as a bulleted list.
 *   5. EVIDENCE FOR / AGAINST — 2-column grid. FOR = thesis.bullCase for
 *      bull theses / thesis.bearCase for bear (the case that supports the
 *      direction). AGAINST = the opposite array. Count chips on each side.
 *   6. Catalysts — compact rows with date · title · impact badge.
 *   7. Linked sources — rows with type badge · title · date · external link.
 *
 * Writes (edit, archive/restore, delete) are handled by the caller — this
 * component is presentation-only so `ResearchPageClient` can keep the
 * single source of selection truth.
 */

export interface ThesisDetailPaneProps {
    thesis: Thesis;
    isArchived: boolean;
    onEdit: () => void;
    onArchive: () => void;
    onRestore: () => void;
    onDelete: () => void;
}

const CONVICTION_CLASS: Record<ThesisConviction, string> = {
    HIGH: "pm-chip-conv-high",
    MEDIUM: "pm-chip-conv-med",
    LOW: "pm-chip-conv-low",
};

export function ThesisDetailPane({
    thesis,
    isArchived,
    onEdit,
    onArchive,
    onRestore,
    onDelete,
}: ThesisDetailPaneProps) {
    // --- Price series (live daily bars → labelled illustrative fallback) -----
    const { data: bars } = useHistoricalQuery(thesis.ticker, "1M", { retry: false, staleTime: 15 * 60_000 });
    const price = useMemo(
        () => buildThesisPriceSeries(bars, thesis),
        [bars, thesis],
    );

    // --- Opposing-case framing ----------------------------------------------
    // FOR = the case that supports this thesis's direction.
    // AGAINST = the opposing case. "Falsify if" reuses AGAINST for the framing
    // "this thesis is wrong if…".
    const forCase = thesis.type === "bull" ? thesis.bullCase : thesis.bearCase;
    const againstCase = thesis.type === "bull" ? thesis.bearCase : thesis.bullCase;
    const forLabel = thesis.type === "bull" ? "FOR (BULL)" : "FOR (BEAR)";
    const againstLabel = thesis.type === "bull" ? "AGAINST (BEAR)" : "AGAINST (BULL)";

    return (
        <>
            <header className="pm-thesis-detail-head">
                <div className="pm-thesis-detail-head-main">
                    <div className="pm-thesis-detail-titlerow">
                        <span className="pm-thesis-detail-sym">{thesis.ticker}</span>
                        {isSeedThesis(thesis) && <SampleTag />}
                        <span
                            className={`pm-thesis-list-dir ${
                                thesis.type === "bull"
                                    ? "pm-thesis-list-dir-bull"
                                    : "pm-thesis-list-dir-bear"
                            }`}
                        >
                            {thesis.type === "bull" ? "Bull" : "Bear"}
                        </span>
                        <span className={`pm-chip-conv ${CONVICTION_CLASS[thesis.conviction]}`}>
                            {thesis.conviction}
                        </span>
                        {isArchived && (
                            <span className="pm-chip-conv pm-thesis-detail-archived-chip">
                                ARCHIVED
                            </span>
                        )}
                    </div>
                    <h2 className="pm-card-title pm-thesis-detail-title">{thesis.title}</h2>
                    <p className="pm-card-subtitle">
                        {thesis.companyName} · {thesis.timeHorizon} · updated{" "}
                        {formatDate(thesis.dateUpdated)}
                    </p>
                </div>
                <div className="pm-research-pane-actions">
                    <Link
                        href={`/research/thesis/${thesis.ticker}`}
                        className="pm-btn pm-btn-ghost"
                    >
                        <ExternalLink size={14} aria-hidden="true" />
                        <span>Open full view</span>
                    </Link>
                    <button type="button" className="pm-btn pm-btn-ghost" onClick={onEdit}>
                        Edit
                    </button>
                    {/* Archive and the destructive Delete live in an overflow
                        menu so they never compete with Edit. */}
                    <DropdownMenu>
                        <DropdownMenuTrigger className="pm-icon-btn" aria-label="More thesis actions">
                            <MoreHorizontal size={16} aria-hidden="true" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {isArchived ? (
                                <DropdownMenuItem onSelect={onRestore}>
                                    <ArchiveRestore size={14} aria-hidden="true" />
                                    Restore
                                </DropdownMenuItem>
                            ) : (
                                <DropdownMenuItem onSelect={onArchive}>
                                    <Archive size={14} aria-hidden="true" />
                                    Archive
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={onDelete} className="pm-menu-danger">
                                <Trash2 size={14} aria-hidden="true" />
                                Delete thesis
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </header>

            <p className="pm-thesis-detail-lede">{thesis.description}</p>

            {/* ------------- Price since open (mini chart) ------------------- */}
            <section
                className="pm-thesis-detail-section pm-thesis-detail-chart-section"
                aria-label="Price over the last 30 days"
            >
                <div className="pm-thesis-detail-section-head">
                    <span className="pm-thesis-detail-eyebrow">PRICE · 30 DAYS</span>
                    <span className="pm-thesis-detail-section-hint">
                        {price.source === "illustrative"
                            ? "Live prices unavailable · shape is illustrative, ends at last saved price"
                            : price.source === "none"
                              ? "No price history available"
                              : "Daily closes · target as dashed line"}
                    </span>
                    {price.source === "illustrative" && (
                        <SampleTag
                            label="Illustrative"
                            title="Live price history could not be loaded. The line is an invented shape that ends at this thesis's last saved price."
                        />
                    )}
                </div>

                <div className="pm-thesis-detail-readouts">
                    <Readout
                        label="30 days ago"
                        value={price.open != null ? `$${fmtMoney(price.open)}` : "—"}
                    />
                    <Readout
                        label={price.source === "live" ? "Now" : "Last saved"}
                        value={price.now != null ? `$${fmtMoney(price.now)}` : "—"}
                        tone={
                            price.changePct == null
                                ? undefined
                                : price.changePct > 0
                                  ? "pos"
                                  : price.changePct < 0
                                    ? "neg"
                                    : undefined
                        }
                    />
                    <Readout label="Target" value={`$${fmtMoney(thesis.targetPrice)}`} />
                    <Readout
                        label="To target"
                        value={
                            price.toTargetPct != null
                                ? `${price.toTargetPct > 0 ? "+" : price.toTargetPct < 0 ? "−" : ""}${Math.abs(price.toTargetPct).toFixed(2)}%`
                                : "—"
                        }
                        tone={
                            price.toTargetPct == null
                                ? undefined
                                : (thesis.type === "bull" && price.toTargetPct > 0) ||
                                    (thesis.type === "bear" && price.toTargetPct < 0)
                                  ? "pos"
                                  : "neg"
                        }
                    />
                </div>

                <AreaChart
                    data={price.data}
                    benchmark={price.benchmark}
                    range="1M"
                    ariaLabel={`${thesis.ticker} price over 30 days with $${fmtMoney(thesis.targetPrice)} target`}
                    height={180}
                />
            </section>

            {/* ------------- Hypothesis + Falsify-if ------------------------- */}
            <section
                className="pm-thesis-detail-section pm-thesis-detail-hfgrid"
                aria-label="Hypothesis and falsification criteria"
            >
                <div className="pm-thesis-detail-hf-col">
                    <span className="pm-thesis-detail-eyebrow">HYPOTHESIS</span>
                    {thesis.hypothesis ? (
                        <p className="pm-thesis-detail-hf-body">{thesis.hypothesis}</p>
                    ) : (
                        <p className="pm-thesis-detail-hf-empty">
                            No hypothesis recorded. Open Edit to add the full argument.
                        </p>
                    )}
                </div>
                <div className="pm-thesis-detail-hf-col pm-thesis-detail-hf-col-falsify">
                    <span className="pm-thesis-detail-eyebrow">FALSIFY IF</span>
                    {againstCase.length > 0 ? (
                        <ul className="pm-thesis-detail-hf-list">
                            {againstCase.map((point, i) => (
                                <li key={i}>{point}</li>
                            ))}
                        </ul>
                    ) : (
                        <p className="pm-thesis-detail-hf-empty">
                            No falsification criteria yet. What would make you exit?
                        </p>
                    )}
                </div>
            </section>

            {/* ------------- Evidence FOR / AGAINST -------------------------- */}
            <section
                className="pm-thesis-detail-section pm-thesis-detail-evidence-grid"
                aria-label="Evidence for and against"
            >
                <EvidenceColumn
                    side="for"
                    label={forLabel}
                    items={forCase}
                    empty="No supporting evidence yet."
                />
                <EvidenceColumn
                    side="against"
                    label={againstLabel}
                    items={againstCase}
                    empty="No opposing evidence yet."
                />
            </section>

            {/* ------------- Catalysts --------------------------------------- */}
            <section className="pm-thesis-detail-section" aria-label="Catalysts">
                <div className="pm-thesis-detail-section-head">
                    <span className="pm-thesis-detail-eyebrow">CATALYSTS</span>
                    <span className="pm-thesis-detail-section-hint">
                        {thesis.catalysts.length} upcoming
                    </span>
                </div>
                {thesis.catalysts.length === 0 ? (
                    <p className="pm-thesis-detail-empty">
                        No catalysts tracked. Add dates that could prove or disprove the thesis.
                    </p>
                ) : (
                    <ul className="pm-thesis-detail-catalysts">
                        {thesis.catalysts.map((c) => (
                            <CatalystRow key={c.id} catalyst={c} />
                        ))}
                    </ul>
                )}
            </section>

            {/* ------------- Linked sources ---------------------------------- */}
            <section className="pm-thesis-detail-section" aria-label="Linked sources">
                <div className="pm-thesis-detail-section-head">
                    <span className="pm-thesis-detail-eyebrow">LINKED SOURCES</span>
                    <span className="pm-thesis-detail-section-hint">
                        {thesis.linkedEvidence.length} item
                        {thesis.linkedEvidence.length === 1 ? "" : "s"}
                    </span>
                </div>
                {thesis.linkedEvidence.length === 0 ? (
                    <p className="pm-thesis-detail-empty">
                        No sources linked yet. Attach articles, reports, or notes so the
                        trail survives future you.
                    </p>
                ) : (
                    <ul className="pm-thesis-detail-sources">
                        {thesis.linkedEvidence.map((e) => (
                            <SourceRow key={e.id} evidence={e} />
                        ))}
                    </ul>
                )}
            </section>
        </>
    );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function Readout({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: "pos" | "neg";
}) {
    const cls =
        tone === "pos"
            ? "pm-readout-value pm-readout-value-pos"
            : tone === "neg"
              ? "pm-readout-value pm-readout-value-neg"
              : "pm-readout-value";
    return (
        <div className="pm-readout">
            <span className="pm-readout-label">{label}</span>
            <span className={`${cls} num`}>{value}</span>
        </div>
    );
}

function EvidenceColumn({
    side,
    label,
    items,
    empty,
}: {
    side: "for" | "against";
    label: string;
    items: string[];
    empty: string;
}) {
    return (
        <div
            className={`pm-thesis-detail-ev-col pm-thesis-detail-ev-col-${side}`}
        >
            <header className="pm-thesis-detail-ev-head">
                <span className="pm-thesis-detail-eyebrow">{label}</span>
                <span className="pm-thesis-detail-ev-count">{items.length}</span>
            </header>
            {items.length === 0 ? (
                <p className="pm-thesis-detail-hf-empty">{empty}</p>
            ) : (
                <ul className="pm-thesis-detail-ev-list">
                    {items.map((it, i) => (
                        <li key={i}>{it}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function CatalystRow({ catalyst }: { catalyst: ThesisCatalyst }) {
    const impactClass =
        catalyst.impact === "high"
            ? "pm-thesis-detail-impact-high"
            : catalyst.impact === "medium"
              ? "pm-thesis-detail-impact-med"
              : "pm-thesis-detail-impact-low";
    return (
        <li className="pm-thesis-detail-catalyst">
            <span className="pm-thesis-detail-catalyst-date">
                {formatCatalystDate(catalyst.date)}
            </span>
            <span className="pm-thesis-detail-catalyst-title">{catalyst.title}</span>
            <span className={`pm-thesis-detail-impact ${impactClass}`}>
                {catalyst.impact}
            </span>
        </li>
    );
}

function SourceRow({ evidence }: { evidence: ThesisEvidence }) {
    const typeClass = `pm-thesis-detail-source-type-${evidence.type}`;
    const inner = (
        <>
            <span className={`pm-thesis-detail-source-type ${typeClass}`}>
                {evidence.type}
            </span>
            <span className="pm-thesis-detail-source-title">{evidence.title}</span>
            <span className="pm-thesis-detail-source-date">
                {formatDate(evidence.date)}
            </span>
            {evidence.url && (
                <ExternalLink
                    size={12}
                    aria-hidden="true"
                    className="pm-thesis-detail-source-icon"
                />
            )}
        </>
    );
    return (
        <li className="pm-thesis-detail-source">
            {evidence.url ? (
                <a
                    href={evidence.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pm-thesis-detail-source-link"
                >
                    {inner}
                </a>
            ) : (
                <span className="pm-thesis-detail-source-link pm-thesis-detail-source-link-plain">
                    {inner}
                </span>
            )}
        </li>
    );
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function fmtMoney(x: number): string {
    if (!Number.isFinite(x)) return "0";
    return x.toLocaleString(undefined, {
        minimumFractionDigits: x < 10 ? 2 : 2,
        maximumFractionDigits: 2,
    });
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    // Fixed locale + UTC: ISO dates are UTC midnight, and the server and
    // browser must format them identically for hydration.
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    });
}

/**
 * Catalyst dates may be ISO ("2024-02-21"), a loose string ("Q2 2024"), or
 * a keyword ("Monthly"). ISO gets `MMM D` formatting; anything else passes
 * through untouched.
 */
function formatCatalystDate(raw: string): string {
    if (!raw) return "";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    // ISO dates are 10 chars (YYYY-MM-DD) — otherwise fall through.
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        return d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
        });
    }
    return raw;
}
