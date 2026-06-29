"use client";

import Link from "next/link";
import {
    AlertTriangle,
    TrendingUp,
    CheckCircle2,
    Info,
    X,
} from "lucide-react";
import type { Pattern, PatternSeverity } from "@/lib/patterns/types";

/**
 * AR-112 single pattern row.
 *
 * Three visual zones, left to right:
 *   [ glyph tile (severity colour) | headline + body | actions ]
 *
 * `dangerouslySetInnerHTML` is used on the headline because detectors
 * embed `<em>` around the key metric. The render path sanitizes the
 * headline first so AI-polished or future persisted strings cannot
 * smuggle arbitrary markup into the dashboard.
 *
 * Actions:
 *   - `link`    → next/link to the href in payload
 *   - `rule`    → link to /strategies with a type hint
 *   - `dismiss` → calls parent's onDismiss (30-day snooze)
 *
 * Only one action in the row wears the "primary" dark pill — that
 * default is set by the detector, not by the row.
 */

const SEVERITY_ICON: Record<PatternSeverity, typeof AlertTriangle> = {
    warn: AlertTriangle,
    caution: TrendingUp,
    positive: CheckCircle2,
    info: Info,
};

export interface PatternRowProps {
    pattern: Pattern;
    onDismiss: () => void;
}

export function PatternRow({ pattern, onDismiss }: PatternRowProps) {
    const Icon = SEVERITY_ICON[pattern.severity];

    return (
        <li
            className="pm-pattern-row"
            data-severity={pattern.severity}
            data-detector={pattern.detector}
            data-testid="pattern-row"
        >
            <span
                className="pm-pattern-glyph"
                aria-label={`Severity ${pattern.severity}`}
            >
                <Icon
                    className="pm-pattern-glyph-icon"
                    aria-hidden="true"
                />
            </span>
            <div className="pm-pattern-body">
                <p
                    className="pm-pattern-headline"
                    dangerouslySetInnerHTML={{
                        __html: sanitizePatternHeadlineHtml(pattern.headline),
                    }}
                />
                <p className="pm-pattern-explainer">{pattern.body}</p>
                <div className="pm-pattern-actions">
                    {pattern.actions.map((a, i) => {
                        const key = `${pattern.id}-action-${i}`;
                        const variantClass =
                            a.variant === "primary"
                                ? "pm-btn pm-btn-primary pm-pattern-action"
                                : "pm-btn pm-btn-ghost pm-pattern-action";
                        if (a.kind === "dismiss") {
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    className={`${variantClass} pm-pattern-action-dismiss`}
                                    onClick={onDismiss}
                                    aria-label="Dismiss pattern for 30 days"
                                    data-testid="pattern-row-dismiss"
                                >
                                    <X
                                        className="pm-pattern-action-icon"
                                        aria-hidden="true"
                                    />
                                    {a.label}
                                </button>
                            );
                        }
                        if (a.kind === "link") {
                            const href =
                                (a.payload?.href as string | undefined) ??
                                "/performance";
                            return (
                                <Link
                                    key={key}
                                    href={href}
                                    className={variantClass}
                                    data-testid="pattern-row-link"
                                >
                                    {a.label}
                                </Link>
                            );
                        }
                        // `rule` kind — route to strategies; the
                        // payload hint is reserved for the v2 deep
                        // link that pre-fills a new rule.
                        return (
                            <Link
                                key={key}
                                href="/strategies"
                                className={variantClass}
                                data-testid="pattern-row-rule"
                            >
                                {a.label}
                            </Link>
                        );
                    })}
                </div>
            </div>
        </li>
    );
}

export function sanitizePatternHeadlineHtml(headline: string): string {
    return escapeHtml(headline)
        .replaceAll("&lt;em&gt;", "<em>")
        .replaceAll("&lt;/em&gt;", "</em>");
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
