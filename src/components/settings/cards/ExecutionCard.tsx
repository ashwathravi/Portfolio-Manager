"use client";

import { ScrollText } from "lucide-react";
import { useSettingsStore } from "@/lib/stores/settingsStore";

/**
 * AR-109 Execution settings card.
 *
 * Houses workflow toggles that shape the *shape* of the order ticket
 * rather than risk rails (those live in `GuardrailsCard`). Keeping
 * these concerns split means flipping "require rationale" never looks
 * like it's touching "approval threshold" — the copy, icon, and
 * position in the grid all signal a different axis.
 *
 * Currently owns a single toggle:
 *
 *   - Require pre-trade rationale — gates Submit in the Focus variant
 *     behind the `<PreTradeRationale>` capture panel. Default ON.
 *
 * More execution-shape toggles will land here in subsequent
 * JournalPlus tickets (AR-114 weekly review ritual, AR-113 time
 * heatmap opt-ins).
 */
export function ExecutionCard() {
    const exec = useSettingsStore((s) => s.execution);
    const update = useSettingsStore((s) => s.updateExecution);

    return (
        <section
            className="pm-settings-card"
            aria-labelledby="pm-settings-execution-head"
        >
            <header className="pm-settings-card-head">
                <div className="pm-settings-card-head-left">
                    <ScrollText
                        className="pm-settings-card-icon"
                        aria-hidden="true"
                    />
                    <h2
                        id="pm-settings-execution-head"
                        className="pm-settings-card-title"
                    >
                        Execution
                    </h2>
                </div>
                <span className="pm-settings-card-sub">
                    JournalPlus ritual
                </span>
            </header>

            <div className="pm-guard-list">
                <div
                    className={`pm-guard-item${
                        exec.rationaleRequired ? "" : " is-off"
                    }`}
                >
                    <div className="pm-guard-text">
                        <div className="pm-guard-title">
                            Require pre-trade rationale
                        </div>
                        <div className="pm-guard-desc">
                            Capture setup, conviction, mood, and a one-line why
                            before Submit enables. Turning this off disables the
                            gate but still records a skipped event for review.
                        </div>
                    </div>
                    <label
                        className="pm-switch"
                        aria-label="Toggle pre-trade rationale requirement"
                    >
                        <input
                            type="checkbox"
                            checked={exec.rationaleRequired}
                            onChange={(e) =>
                                update({ rationaleRequired: e.target.checked })
                            }
                        />
                        <span />
                    </label>
                </div>
            </div>
        </section>
    );
}
