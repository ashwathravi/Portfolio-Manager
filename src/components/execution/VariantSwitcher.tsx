"use client";

import {
    EXECUTION_VARIANTS,
    EXECUTION_VARIANT_LABELS,
    EXECUTION_VARIANT_SUBS,
    type ExecutionVariant,
} from "@/lib/execution/variant";

/**
 * Phase 7 (AR-83) Execution variant switcher.
 *
 * A 3-button pill group that flips the execution surface between Focus,
 * Checkout, and Terminal layouts. Persistence is owned by the parent
 * (`ExecutionPageClient`) — this component is purely presentational so
 * it stays usable from anywhere a variant needs to be toggled (the top
 * bar today, maybe a command palette later).
 *
 * Each button shows a label + a one-line pitch underneath so the user
 * knows what they're switching to without having to toggle to find out.
 * The active button gets an accent border + ambient ring via the
 * `.is-active` modifier in globals.css.
 */

export interface VariantSwitcherProps {
    value: ExecutionVariant;
    onChange: (next: ExecutionVariant) => void;
}

export function VariantSwitcher({ value, onChange }: VariantSwitcherProps) {
    return (
        <div
            className="pm-variant-switch"
            role="tablist"
            aria-label="Execution layout"
        >
            {EXECUTION_VARIANTS.map((v) => {
                const active = v === value;
                return (
                    <button
                        key={v}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={`pm-variant-btn${active ? " is-active" : ""}`}
                        onClick={() => onChange(v)}
                    >
                        <span className="pm-variant-label">{EXECUTION_VARIANT_LABELS[v]}</span>
                        <span className="pm-variant-sub">{EXECUTION_VARIANT_SUBS[v]}</span>
                    </button>
                );
            })}
        </div>
    );
}
