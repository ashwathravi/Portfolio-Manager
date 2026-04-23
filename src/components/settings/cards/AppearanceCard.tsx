"use client";

import { Palette } from "lucide-react";

/**
 * AR-87 stub — the real Appearance card lands in AR-88.
 *
 * The page grid ships together in AR-87, so the two later cards exist
 * as placeholders until their own tickets replace them. Same pattern
 * used by Phase 7 Execution variants.
 */

export function AppearanceCard() {
    return (
        <section
            className="pm-settings-card pm-settings-card-stub"
            aria-labelledby="pm-settings-appearance-head"
        >
            <header className="pm-settings-card-head">
                <div className="pm-settings-card-head-left">
                    <Palette className="pm-settings-card-icon" aria-hidden="true" />
                    <h2
                        id="pm-settings-appearance-head"
                        className="pm-settings-card-title"
                    >
                        Appearance
                    </h2>
                </div>
                <span className="pm-settings-card-sub">Coming in AR-88</span>
            </header>
            <div className="pm-settings-card-body">
                <p className="pm-settings-card-placeholder">
                    Theme, density, and accent controls. Mirrors the Tweaks panel.
                </p>
            </div>
        </section>
    );
}
