"use client";

import Link from "next/link";
import { Sparkline } from "@/components/charts";

/**
 * Phase 3 (AR-73) Active-theses card.
 *
 * Three rows per the handoff: tag + name + state + conviction chip +
 * mini sparkline. The "N open" pill in the header summarizes all theses
 * with state !== "closed".
 *
 * Conviction color mapping comes from `.pm-chip-conv-*` in globals:
 *   High → accent
 *   Med  → warn (var(--pm-warn))
 *   Low  → muted
 */

export type Conviction = "High" | "Med" | "Low";

export interface ThesisRow {
    id: string;
    tag: string;          // e.g. "AAPL", "SEMI", "MACRO"
    name: string;         // headline: "Apple margins compressing"
    state: string;        // e.g. "Watching", "Active", "Fading"
    conviction: Conviction;
    /** Mini sparkline series (price-since-thesis-opened). */
    spark?: number[];
    /** Optional URL to open the thesis detail. */
    href?: string;
}

export interface ActiveThesesCardProps {
    rows: ThesisRow[];
    /** Max rows to render. Default 3 (handoff spec). */
    limit?: number;
    /** Override for the "N open" pill label. */
    openLabel?: string;
    className?: string;
}

export function ActiveThesesCard({
    rows,
    limit = 3,
    openLabel,
    className,
}: ActiveThesesCardProps) {
    const shown = rows.slice(0, limit);
    const openCount =
        rows.filter((r) => r.state.toLowerCase() !== "closed").length || shown.length;

    return (
        <section
            className={`pm-card pm-card-stack${className ? ` ${className}` : ""}`}
            aria-label="Active theses"
        >
            <header className="pm-card-header">
                <div>
                    <h3 className="pm-card-title">Active Theses</h3>
                    <p className="pm-card-subtitle">
                        Research ideas you're tracking
                    </p>
                </div>
                <span className="pm-pill pm-pill-muted" aria-label={`${openCount} open theses`}>
                    {openLabel ?? `${openCount} open`}
                </span>
            </header>

            {shown.length === 0 ? (
                <p className="pm-card-subtitle">No active theses.</p>
            ) : (
                <ul
                    style={{
                        listStyle: "none",
                        margin: 0,
                        padding: 0,
                        display: "flex",
                        flexDirection: "column",
                    }}
                >
                    {shown.map((t) => (
                        <li key={t.id} className="pm-thesis-row">
                            <div className="pm-thesis-name">
                                {t.href ? (
                                    <Link href={t.href} className="pm-thesis-title" style={{ textDecoration: "none", color: "inherit" }}>
                                        <span className="pm-pill pm-pill-muted" style={{ marginRight: 6 }}>
                                            {t.tag}
                                        </span>
                                        {t.name}
                                    </Link>
                                ) : (
                                    <span className="pm-thesis-title">
                                        <span className="pm-pill pm-pill-muted" style={{ marginRight: 6 }}>
                                            {t.tag}
                                        </span>
                                        {t.name}
                                    </span>
                                )}
                                <span className="pm-thesis-meta">{t.state}</span>
                            </div>
                            <ConvictionChip conviction={t.conviction} />
                            {t.spark && t.spark.length > 1 ? (
                                <Sparkline
                                    data={t.spark}
                                    width={60}
                                    height={22}
                                    autoColor
                                    ariaLabel={`${t.name} since opened`}
                                    fill
                                />
                            ) : (
                                <span />
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function ConvictionChip({ conviction }: { conviction: Conviction }) {
    const cls =
        conviction === "High"
            ? "pm-chip-conv pm-chip-conv-high"
            : conviction === "Med"
              ? "pm-chip-conv pm-chip-conv-med"
              : "pm-chip-conv pm-chip-conv-low";
    return <span className={cls}>{conviction}</span>;
}
