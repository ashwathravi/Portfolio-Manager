"use client";

import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import { useSettingsStore } from "@/lib/stores/settingsStore";

/**
 * AR-89 Guardrails card.
 *
 * Three independent safety rails with a `pm-switch` toggle + optional
 * inline numeric value:
 *
 *   1. Order approval threshold — orders over the USD value land in
 *      the approval queue instead of auto-routing. Bounded [500, 10M].
 *   2. Concentration cap — block new orders that would push a single
 *      position past this % of the portfolio. Bounded [5, 50].
 *   3. Thesis linkage required — every open order must reference a
 *      living thesis.
 *
 * Values persist to `useSettingsStore.guardrails`; the Execution
 * Focus variant reads them via `useGuardrails`, so flipping any
 * toggle here is reflected on the next order preview.
 *
 * Input buffering: the numeric inputs hold local draft state and
 * commit to the store on blur or Enter. Rationale is the same as the
 * Profile card — we don't want the Execution evaluator re-running on
 * every keystroke while the user is typing a new threshold.
 */

const DOLLAR_MIN = 500;
const DOLLAR_MAX = 10_000_000;
const PCT_MIN = 5;
const PCT_MAX = 50;

function clamp(n: number, min: number, max: number): number {
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

export function GuardrailsCard() {
    const g = useSettingsStore((s) => s.guardrails);
    const update = useSettingsStore((s) => s.updateGuardrails);

    // Local drafts — the numeric inputs render these so typing feels
    // responsive, and we commit to the store on blur/Enter.
    const [dollarDraft, setDollarDraft] = useState<string>(
        g.approvalThresholdUsd.toString(),
    );
    const [pctDraft, setPctDraft] = useState<string>(
        g.concentrationCapPct.toString(),
    );

    // Keep drafts in sync if the store changes externally (e.g. a
    // reset). Otherwise stale drafts would quietly clobber the fresh
    // values the next time the user blurs.
    useEffect(() => {
        setDollarDraft(g.approvalThresholdUsd.toString());
    }, [g.approvalThresholdUsd]);
    useEffect(() => {
        setPctDraft(g.concentrationCapPct.toString());
    }, [g.concentrationCapPct]);

    const commitDollar = () => {
        const n = Math.round(Number(dollarDraft));
        const clamped = clamp(n, DOLLAR_MIN, DOLLAR_MAX);
        if (clamped !== g.approvalThresholdUsd) {
            update({ approvalThresholdUsd: clamped });
            toast.success(
                `Approval threshold set to ${clamped.toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                })}`,
            );
        }
        setDollarDraft(clamped.toString());
    };

    const commitPct = () => {
        const n = Math.round(Number(pctDraft));
        const clamped = clamp(n, PCT_MIN, PCT_MAX);
        if (clamped !== g.concentrationCapPct) {
            update({ concentrationCapPct: clamped });
            toast.success(`Concentration cap set to ${clamped}%`);
        }
        setPctDraft(clamped.toString());
    };

    return (
        <section
            className="pm-settings-card"
            aria-labelledby="pm-settings-guardrails-head"
        >
            <header className="pm-settings-card-head">
                <div className="pm-settings-card-head-left">
                    <Shield className="pm-settings-card-icon" aria-hidden="true" />
                    <h2
                        id="pm-settings-guardrails-head"
                        className="pm-settings-card-title"
                    >
                        Guardrails
                    </h2>
                </div>
                <span className="pm-settings-card-sub">
                    Applied in Execution
                </span>
            </header>

            <div className="pm-guard-list">
                {/* Order approval threshold ------------------------------- */}
                <div
                    className={`pm-guard-item${g.approvalThresholdEnabled ? "" : " is-off"}`}
                >
                    <div className="pm-guard-text">
                        <div className="pm-guard-title">
                            Order approval threshold
                        </div>
                        <div className="pm-guard-desc">
                            Require manual approval for orders over{" "}
                            <input
                                type="number"
                                className="pm-guard-inline pm-guard-inline-dollar"
                                min={DOLLAR_MIN}
                                max={DOLLAR_MAX}
                                step={500}
                                value={dollarDraft}
                                onChange={(e) => setDollarDraft(e.target.value)}
                                onBlur={commitDollar}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        (e.target as HTMLInputElement).blur();
                                    }
                                }}
                                disabled={!g.approvalThresholdEnabled}
                                aria-label="Approval threshold (USD)"
                            />
                        </div>
                    </div>
                    <label className="pm-switch" aria-label="Toggle order approval threshold">
                        <input
                            type="checkbox"
                            checked={g.approvalThresholdEnabled}
                            onChange={(e) =>
                                update({
                                    approvalThresholdEnabled: e.target.checked,
                                })
                            }
                        />
                        <span />
                    </label>
                </div>

                {/* Concentration cap -------------------------------------- */}
                <div
                    className={`pm-guard-item${g.concentrationCapEnabled ? "" : " is-off"}`}
                >
                    <div className="pm-guard-text">
                        <div className="pm-guard-title">Concentration cap</div>
                        <div className="pm-guard-desc">
                            Block new orders if a single position would exceed{" "}
                            <input
                                type="number"
                                className="pm-guard-inline pm-guard-inline-pct"
                                min={PCT_MIN}
                                max={PCT_MAX}
                                step={1}
                                value={pctDraft}
                                onChange={(e) => setPctDraft(e.target.value)}
                                onBlur={commitPct}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        (e.target as HTMLInputElement).blur();
                                    }
                                }}
                                disabled={!g.concentrationCapEnabled}
                                aria-label="Concentration cap (percent)"
                            />
                            % of the portfolio
                        </div>
                    </div>
                    <label
                        className="pm-switch"
                        aria-label="Toggle concentration cap"
                    >
                        <input
                            type="checkbox"
                            checked={g.concentrationCapEnabled}
                            onChange={(e) =>
                                update({
                                    concentrationCapEnabled: e.target.checked,
                                })
                            }
                        />
                        <span />
                    </label>
                </div>

                {/* Thesis linkage ---------------------------------------- */}
                <div
                    className={`pm-guard-item${g.thesisLinkageRequired ? "" : " is-off"}`}
                >
                    <div className="pm-guard-text">
                        <div className="pm-guard-title">
                            Thesis linkage required
                        </div>
                        <div className="pm-guard-desc">
                            Every open order must link to an active thesis.
                        </div>
                    </div>
                    <label
                        className="pm-switch"
                        aria-label="Toggle thesis linkage requirement"
                    >
                        <input
                            type="checkbox"
                            checked={g.thesisLinkageRequired}
                            onChange={(e) =>
                                update({
                                    thesisLinkageRequired: e.target.checked,
                                })
                            }
                        />
                        <span />
                    </label>
                </div>
            </div>
        </section>
    );
}
