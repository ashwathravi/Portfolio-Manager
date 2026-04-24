"use client";

import { CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { useMemo } from "react";
import {
    evaluateRules,
    type TradeContext,
} from "@/lib/adherence/evaluate";
import type { AdherenceRule } from "@/lib/adherence/rules";
import { adherenceTier } from "@/lib/adherence/impact";

/**
 * AR-111 live adherence panel (Focus execution variant).
 *
 * Purely presentational. Parent hands in the rule set + a fully-formed
 * `TradeContext`, the panel runs `evaluateRules` on every render and
 * paints the result. No side effects — the evaluator is pure and
 * synchronous, and the parent memoizes the context so this panel only
 * re-runs when something the user actually changed would affect a score.
 *
 * Layout:
 *   [ big score badge  |  1-line verdict ("4 of 5 rules pass") ]
 *   [   rule 1  •  observed / threshold   (tone icon) ]
 *   [   rule 2  •  observed / threshold   (tone icon) ]
 *   ...
 *
 * v1 non-goal (from AR-111): we never block submit. Violations are
 * styled as warnings; the Submit button above carries its own gates
 * (rationale complete, cooldown done, guardrails pass). We surface the
 * count so the user can *choose* to stop — that's the behavioral nudge.
 *
 * Hidden when `rules` is empty — an empty rule set means "this strategy
 * has no discipline rules yet", and the panel rendering "100/100" would
 * be noisy congratulations for doing nothing.
 */

export interface AdherencePanelProps {
    rules: ReadonlyArray<AdherenceRule>;
    context: TradeContext;
    /** Optional strategy name for the header, e.g. "Momentum & Value".
     *  When omitted the header just reads "Discipline check". */
    strategyName?: string;
}

export function AdherencePanel({ rules, context, strategyName }: AdherencePanelProps) {
    const result = useMemo(() => evaluateRules(rules, context), [rules, context]);

    if (rules.length === 0) {
        return null;
    }

    const passedCount = result.results.filter((r) => r.passed).length;
    const failed = result.results.filter((r) => !r.passed);
    const tier = adherenceTier(result.score);

    return (
        <section
            className="pm-adherence-live"
            data-testid="adherence-live-panel"
            data-score={result.score}
            aria-label="Rule adherence"
        >
            <header className="pm-adherence-live-head">
                <div className="pm-adherence-live-lede">
                    <span className="pm-adherence-live-eyebrow">
                        Discipline check
                        {strategyName ? ` · ${strategyName}` : ""}
                    </span>
                    <span className="pm-adherence-live-verdict">
                        {passedCount} of {rules.length} rule
                        {rules.length === 1 ? "" : "s"} pass
                        {failed.length > 0 && (
                            <>
                                {" "}
                                <span className="pm-adherence-live-warn">
                                    · {failed.length} to address
                                </span>
                            </>
                        )}
                    </span>
                </div>
                <span
                    className="pm-adherence-live-score"
                    data-tier={tier ?? "none"}
                    aria-label={`Adherence score ${result.score} of 100`}
                >
                    <span className="pm-adherence-live-score-num num">
                        {result.score}
                    </span>
                    <span className="pm-adherence-live-score-max">/ 100</span>
                </span>
            </header>

            <ul className="pm-adherence-live-list" role="list">
                {result.results.map((r) => {
                    const Icon = r.passed
                        ? CheckCircle2
                        : r.observed === "—"
                            ? MinusCircle
                            : XCircle;
                    // "Unknown" results (observed === '—') are passed-neutral
                    // in the evaluator; style them muted so the user can tell
                    // at a glance that the check ran but had no data — as
                    // opposed to a clean pass.
                    const tone = r.passed
                        ? r.observed === "—"
                            ? "neutral"
                            : "pass"
                        : "fail";
                    return (
                        <li
                            key={r.ruleId}
                            className="pm-adherence-live-row"
                            data-tone={tone}
                            data-severity={r.severity}
                            data-rule-type={r.ruleType}
                        >
                            <Icon
                                className="pm-adherence-live-icon"
                                aria-hidden="true"
                            />
                            <div className="pm-adherence-live-body">
                                <span className="pm-adherence-live-label">
                                    {r.label}
                                </span>
                                <span className="pm-adherence-live-meta num">
                                    <span className="pm-adherence-live-observed">
                                        {r.observed}
                                    </span>
                                    <span className="pm-adherence-live-vs" aria-hidden="true">
                                        vs.
                                    </span>
                                    <span className="pm-adherence-live-threshold">
                                        {r.threshold}
                                    </span>
                                </span>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
