"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Archive, ArchiveRestore, ExternalLink, Trash2 } from "lucide-react";
import { AreaChart } from "@/components/charts";
import { useHistoricalQuery } from "@/lib/api/market-data/queries";
import type { HistoricalBar } from "@/lib/api/market-data";
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
 *      the action row (Open full view / Edit / Archive|Restore / Delete).
 *   2. Lede — one-line description.
 *   3. Price since open — mini AreaChart with 4-readout strip
 *      (Open / Now / Target / % to target). Pulls live 1D bars via
 *      `useHistoricalQuery` and falls back to a synthesized walk anchored
 *      on `thesis.currentPrice` when the provider returns empty.
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
    // --- Price series (live → synthesized fallback) --------------------------
    const { data: bars } = useHistoricalQuery(thesis.ticker, "1D");
    const price = useMemo(
        () => buildPriceSeries(bars, thesis),
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
                    {isArchived ? (
                        <button type="button" className="pm-btn pm-btn-ghost" onClick={onRestore}>
                            <ArchiveRestore size={14} aria-hidden="true" />
                            <span>Restore</span>
                        </button>
                    ) : (
                        <button type="button" className="pm-btn pm-btn-ghost" onClick={onArchive}>
                            <Archive size={14} aria-hidden="true" />
                            <span>Archive</span>
                        </button>
                    )}
                    <button type="button" className="pm-btn pm-btn-ghost" onClick={onEdit}>
                        Edit
                    </button>
                    <button
                        type="button"
                        className="pm-btn pm-btn-ghost pm-btn-danger"
                        onClick={onDelete}
                        aria-label="Delete thesis"
                    >
                        <Trash2 size={14} aria-hidden="true" />
                    </button>
                </div>
            </header>

            <p className="pm-thesis-detail-lede">{thesis.description}</p>

            {/* ------------- Price since open (mini chart) ------------------- */}
            <section
                className="pm-thesis-detail-section pm-thesis-detail-chart-section"
                aria-label="Price since open"
            >
                <div className="pm-thesis-detail-section-head">
                    <span className="pm-thesis-detail-eyebrow">PRICE SINCE OPEN</span>
                    <span className="pm-thesis-detail-section-hint">1D · target as dashed line</span>
                </div>

                <div className="pm-thesis-detail-readouts">
                    <Readout
                        label="Open"
                        value={price.open != null ? `$${fmtMoney(price.open)}` : "—"}
                    />
                    <Readout
                        label="Now"
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
                    range="1D"
                    ariaLabel={`${thesis.ticker} price since open with $${fmtMoney(thesis.targetPrice)} target`}
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
// Price series
// ---------------------------------------------------------------------------

interface PriceSeries {
    /** Portfolio series passed to AreaChart (closes over the session). */
    data: number[];
    /** Flat benchmark at `thesis.targetPrice` so the chart shows how far we are. */
    benchmark: number[];
    open: number | null;
    now: number | null;
    /** % change from open to now. */
    changePct: number | null;
    /** % distance from "now" to target, signed (thesis-POV handled by caller). */
    toTargetPct: number | null;
}

/**
 * Assemble the chart series. Preference order:
 *   1. Live 1D bars from `useHistoricalQuery`, using bar.close.
 *   2. Synthesized walk anchored on `thesis.currentPrice` when bars are empty
 *      (e.g. weekends, offline dev).
 *
 * The benchmark line is a constant array at `thesis.targetPrice` so the user
 * can eyeball the gap between price and target.
 */
function buildPriceSeries(
    bars: HistoricalBar[] | undefined,
    thesis: Thesis,
): PriceSeries {
    const target = thesis.targetPrice;
    const fallbackNow =
        typeof thesis.currentPrice === "number" && Number.isFinite(thesis.currentPrice)
            ? thesis.currentPrice
            : null;

    let data: number[];
    let open: number | null;
    let now: number | null;

    if (bars && bars.length > 0) {
        data = bars.map((b) => b.close);
        open = bars[0].open ?? bars[0].close;
        now = data[data.length - 1];
    } else if (fallbackNow != null) {
        data = synthesize1DWalk(fallbackNow, thesis.ticker);
        open = data[0];
        now = data[data.length - 1];
    } else {
        data = [];
        open = null;
        now = null;
    }

    const benchmark = data.length > 0 ? new Array<number>(data.length).fill(target) : [];

    const changePct =
        open != null && now != null && open > 0 ? ((now - open) / open) * 100 : null;

    // Signed distance from the thesis's perspective:
    //   bull: (target - now) / now  → positive = upside remaining.
    //   bear: (now - target) / now  → positive = downside remaining.
    const toTargetPct =
        now != null && now > 0 && target > 0
            ? thesis.type === "bull"
                ? ((target - now) / now) * 100
                : ((now - target) / now) * 100
            : null;

    return { data, benchmark, open, now, changePct, toTargetPct };
}

/**
 * Deterministic 1D random walk anchored on `current`. 78 points = 5-minute
 * bars through a 6.5h session (same shape the dashboard equity curve uses
 * for its 1D range).
 */
function synthesize1DWalk(current: number, seedSource: string): number[] {
    const points = 78;
    const drift = 0.004; // ~0.4% over the session
    const vol = 0.004;
    const end = Math.max(current, 0.01);
    const start = end / (1 + drift);

    const rand = mulberry32(hashString(seedSource));
    const out = new Array<number>(points);
    for (let i = 0; i < points; i++) {
        const t = i / (points - 1 || 1);
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
    return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
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
        return d.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    }
    return raw;
}
