"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { SEED_JOURNAL } from "@/lib/journal/seed";
import { SEED_SECTOR_BY_TICKER } from "@/lib/adherence/seed";
import {
    DEFAULT_NAV,
    DEFAULT_SECTOR_TARGETS,
    generatePatterns,
} from "@/lib/patterns/generate";
import type { Pattern } from "@/lib/patterns/types";
import { getSnoozedIds, snoozePattern } from "@/lib/patterns/snooze";
import { PatternRow } from "./PatternRow";

/**
 * AR-112 Pattern feed card.
 *
 * Client-only. Pulls the seed journal (swap to a Zustand store once
 * live trade data lands), runs the deterministic detectors, renders
 * the ranked list. The card replaces the old static Daily Brief on
 * the dashboard's bottom 3-col strip.
 *
 * State:
 *   - `patterns`   — ranked list (up to MAX)
 *   - `snoozedAt`  — bump on dismiss so the filter re-applies
 *   - `expanded`   — collapse/expand past the 6-item ceiling
 *   - `refreshKey` — bump to force regeneration on manual Refresh
 *   - `loading`    — true only on the very first async pass
 *
 * Generation is `await`-compatible because the pipeline supports an
 * optional AI polish pass. In Next.js the polish flag is off so the
 * call resolves synchronously-ish. We still keep the loading state so
 * the shell renders a skeleton instead of an empty card on first paint.
 *
 * Regeneration is also cheap to rerun manually — the detectors are
 * sub-millisecond. The "cached 1h" line in the spec is really about
 * the AI polish; without it, each Refresh just re-runs the detectors.
 */

/** Max patterns shown collapsed. Expanded shows everything. */
const MAX_COLLAPSED = 6;

export interface PatternFeedProps {
    /** Override the journal source — keeps the component pure for tests. */
    entries?: typeof SEED_JOURNAL;
    /** Approximate NAV — drives the %-of-NAV detectors. */
    nav?: number;
}

export function PatternFeed({
    entries = SEED_JOURNAL,
    nav = DEFAULT_NAV,
}: PatternFeedProps) {
    const [patterns, setPatterns] = useState<Pattern[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshKey, setRefreshKey] = useState(0);
    const [snoozedAt, setSnoozedAt] = useState(0);
    const [expanded, setExpanded] = useState(false);

    // Regenerate when trades or refreshKey change. `generatePatterns`
    // returns a Promise (for the AI-polish future); we swallow the
    // return and set state when it resolves.
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        generatePatterns(entries, {
            nav,
            sectorByTicker: SEED_SECTOR_BY_TICKER,
            sectorTargets: DEFAULT_SECTOR_TARGETS,
            limit: MAX_COLLAPSED * 3, // generate more than we show so expand has room
        }).then((next) => {
            if (!cancelled) {
                setPatterns(next);
                setLoading(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [entries, nav, refreshKey]);

    // Filter snoozed. `snoozedAt` is a trigger so the dismiss handler
    // can force a re-evaluation without re-running detectors.
    const snoozedIds = useMemo(() => {
        // `snoozedAt` is intentionally part of the dep list to force
        // the memo to re-run after a dismiss. Treating it as a key
        // keeps the no-unused-vars rule happy while making the
        // dependency explicit.
        void snoozedAt;
        return getSnoozedIds();
    }, [snoozedAt]);

    const visible = useMemo(
        () => patterns.filter((p) => !snoozedIds.has(p.id)),
        [patterns, snoozedIds],
    );
    const shown = expanded ? visible : visible.slice(0, MAX_COLLAPSED);

    const onDismiss = useCallback((id: string) => {
        snoozePattern(id);
        setSnoozedAt(Date.now());
    }, []);

    const onRefresh = useCallback(() => {
        setRefreshKey((k) => k + 1);
    }, []);

    const trimmed = Math.max(visible.length - MAX_COLLAPSED, 0);

    return (
        <section
            className="pm-card pm-pattern-feed"
            aria-labelledby="pm-pattern-feed-head"
            data-testid="pattern-feed"
        >
            <header className="pm-pattern-feed-head">
                <div className="pm-pattern-feed-lede">
                    <h3
                        id="pm-pattern-feed-head"
                        className="pm-pattern-feed-title"
                    >
                        Pattern feed
                    </h3>
                    <p className="pm-pattern-feed-sub">
                        From <strong>{entries.length}</strong> trades · last 90 days
                    </p>
                </div>
                <div className="pm-pattern-feed-actions">
                    <span
                        className="pm-pattern-feed-pill"
                        aria-label={`${visible.length} patterns`}
                    >
                        <Sparkles
                            className="pm-pattern-feed-pill-icon"
                            aria-hidden="true"
                        />
                        <span className="num">{visible.length}</span> new
                    </span>
                    <button
                        type="button"
                        className="pm-btn pm-btn-ghost pm-pattern-feed-refresh"
                        onClick={onRefresh}
                        aria-label="Refresh patterns"
                        data-testid="pattern-feed-refresh"
                        disabled={loading}
                    >
                        <RefreshCw
                            className="pm-pattern-feed-refresh-icon"
                            aria-hidden="true"
                            data-spinning={loading ? "true" : "false"}
                        />
                        Refresh
                    </button>
                </div>
            </header>

            {loading && patterns.length === 0 ? (
                <PatternSkeleton />
            ) : visible.length === 0 ? (
                <EmptyState />
            ) : (
                <>
                    <ul className="pm-pattern-list" role="list">
                        {shown.map((p) => (
                            <PatternRow
                                key={p.id}
                                pattern={p}
                                onDismiss={() => onDismiss(p.id)}
                            />
                        ))}
                    </ul>
                    {trimmed > 0 && (
                        <button
                            type="button"
                            className="pm-pattern-expand"
                            onClick={() => setExpanded((x) => !x)}
                            data-testid="pattern-feed-expand"
                            aria-expanded={expanded}
                        >
                            {expanded ? (
                                <>
                                    <ChevronUp
                                        className="pm-pattern-expand-icon"
                                        aria-hidden="true"
                                    />
                                    Show fewer
                                </>
                            ) : (
                                <>
                                    <ChevronDown
                                        className="pm-pattern-expand-icon"
                                        aria-hidden="true"
                                    />
                                    Show {trimmed} more
                                </>
                            )}
                        </button>
                    )}
                </>
            )}
        </section>
    );
}

// --------------------------------------------------------------------- //
// Loading + empty
// --------------------------------------------------------------------- //

function PatternSkeleton() {
    return (
        <div
            className="pm-pattern-skeleton"
            role="status"
            aria-label="Loading patterns"
            data-testid="pattern-feed-loading"
        >
            {[0, 1, 2].map((i) => (
                <div key={i} className="pm-pattern-skel-row">
                    <div className="pm-pattern-skel-glyph" />
                    <div className="pm-pattern-skel-body">
                        <div className="pm-pattern-skel-line pm-pattern-skel-line-head" />
                        <div className="pm-pattern-skel-line" />
                    </div>
                </div>
            ))}
        </div>
    );
}

function EmptyState() {
    return (
        <div className="pm-pattern-empty" data-testid="pattern-feed-empty">
            <Sparkles
                className="pm-pattern-empty-icon"
                aria-hidden="true"
            />
            <p className="pm-pattern-empty-copy">
                Nothing to surface yet. Close a few trades with
                rationale captured and patterns will start lighting up here.
            </p>
        </div>
    );
}
