"use client";

import { ScrollText } from "lucide-react";
import {
    useSettingsStore,
    COOLDOWN_OPTIONS,
    type CooldownSeconds,
} from "@/lib/stores/settingsStore";

/**
 * Execution settings card (AR-109 + AR-110).
 *
 * Houses workflow toggles that shape the *shape* of the order ticket
 * rather than risk rails (those live in `GuardrailsCard`). Keeping
 * these concerns split means flipping "require rationale" never looks
 * like it's touching "approval threshold" — the copy, icon, and
 * position in the grid all signal a different axis.
 *
 * Currently owns:
 *
 *   - Require pre-trade rationale (AR-109) — gates Submit in the Focus
 *     variant behind the `<PreTradeRationale>` capture panel. Default
 *     ON.
 *   - Mood cooldown (AR-110) — when the trader tags a caution mood
 *     (`fomo` / `revenge`), Submit locks for N seconds after the first
 *     press. Options: Off / 10s / 30s / 60s. Default 10s.
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
                {/* Rationale toggle (AR-109) */}
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

                {/* Cooldown picker (AR-110) */}
                <div
                    className={`pm-guard-item${
                        exec.cooldownSeconds > 0 ? "" : " is-off"
                    }`}
                >
                    <div className="pm-guard-text">
                        <div className="pm-guard-title">Mood cooldown</div>
                        <div className="pm-guard-desc">
                            Lock Submit for this many seconds when the mood at
                            entry is{" "}
                            <strong>FOMO</strong> or <strong>Revenge</strong>.
                            Short pause, then the ticket unlocks — nudge, not
                            block.
                        </div>
                    </div>
                    <div
                        className="pm-cooldown-chips"
                        role="radiogroup"
                        aria-label="Mood cooldown duration"
                    >
                        {COOLDOWN_OPTIONS.map((opt) => {
                            const selected = exec.cooldownSeconds === opt.value;
                            return (
                                <button
                                    key={opt.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    className={`pm-cooldown-chip${
                                        selected ? " is-on" : ""
                                    }`}
                                    title={opt.desc}
                                    onClick={() =>
                                        update({
                                            cooldownSeconds: opt.value as CooldownSeconds,
                                        })
                                    }
                                >
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
}
