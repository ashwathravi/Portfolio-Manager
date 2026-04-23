"use client";

import { Shield } from "lucide-react";

/**
 * AR-87 stub — the real Guardrails card lands in AR-89.
 *
 * The page grid ships together in AR-87, so the two later cards exist
 * as placeholders until their own tickets replace them.
 */

export function GuardrailsCard() {
    return (
        <section
            className="pm-settings-card pm-settings-card-stub"
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
                <span className="pm-settings-card-sub">Coming in AR-89</span>
            </header>
            <div className="pm-settings-card-body">
                <p className="pm-settings-card-placeholder">
                    Order approval threshold, concentration cap, thesis linkage.
                </p>
            </div>
        </section>
    );
}
