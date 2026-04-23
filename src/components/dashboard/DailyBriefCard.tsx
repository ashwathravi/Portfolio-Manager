import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Phase 3 (AR-73) Daily Brief card — the dark "insight" variant.
 *
 * Layout:
 *
 *     [DAILY BRIEF]
 *     N decisions need your attention
 *
 *     ① Rebalance tech exposure
 *        AAPL + NVDA now 34% of portfolio — consider trim.
 *
 *     ② ...
 *
 *     [ Open decision queue → ]
 *
 * The dark surface is `.pm-card-insight` (fg/card inverted). List items
 * use a CSS counter so callers don't have to number them manually. The
 * CTA links to /decisions by default — the route is a stub today, the
 * spec explicitly allows that.
 */

export interface DecisionItem {
    title: string;
    description: string;
}

export interface DailyBriefCardProps {
    items: DecisionItem[];
    /** Override the "N decisions…" headline. */
    headline?: string;
    /** CTA href; default /decisions. */
    ctaHref?: string;
    /** CTA label; default "Open decision queue". */
    ctaLabel?: string;
    className?: string;
}

export function DailyBriefCard({
    items,
    headline,
    ctaHref = "/decisions",
    ctaLabel = "Open decision queue",
    className,
}: DailyBriefCardProps) {
    const resolvedHeadline =
        headline ??
        (items.length === 0
            ? "Your queue is clear."
            : items.length === 1
              ? "1 decision needs your attention"
              : `${items.length} decisions need your attention`);

    return (
        <section
            className={`pm-card-insight${className ? ` ${className}` : ""}`}
            aria-label="Daily brief"
        >
            <span className="pm-insight-chip">Daily Brief</span>

            <h3 className="pm-insight-headline">{resolvedHeadline}</h3>

            {items.length > 0 && (
                <ol className="pm-insight-list">
                    {items.map((it, i) => (
                        <li key={`${it.title}-${i}`} className="pm-insight-item">
                            <div>
                                <div className="pm-insight-heading">{it.title}</div>
                                <div className="pm-insight-desc">{it.description}</div>
                            </div>
                        </li>
                    ))}
                </ol>
            )}

            <Link href={ctaHref} className="pm-insight-cta">
                {ctaLabel}
                <ArrowRight size={14} aria-hidden="true" />
            </Link>
        </section>
    );
}
