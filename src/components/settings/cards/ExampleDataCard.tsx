"use client";

import { FlaskConical } from "lucide-react";
import { useSettingsStore } from "@/lib/stores/settingsStore";

/**
 * Example data switch. Every example-backed figure carries a "Sample"
 * tag; turning this off hides those cards so only your own data remains.
 */
export function ExampleDataCard() {
    const show = useSettingsStore((s) => s.demo?.showSampleData ?? true);
    const setShow = useSettingsStore((s) => s.setShowSampleData);
    return (
        <section className="pm-settings-card" aria-labelledby="pm-settings-example-head" data-testid="example-data-card">
            <header className="pm-settings-card-head">
                <div className="pm-settings-card-head-left">
                    <FlaskConical className="pm-settings-card-icon" aria-hidden="true" />
                    <h2 id="pm-settings-example-head" className="pm-settings-card-title">Example data</h2>
                </div>
            </header>
            <div className="pm-guard-list">
                <div className="pm-guard-item">
                    <div className="pm-guard-text">
                        <div className="pm-guard-title">Show example data</div>
                        <div className="pm-guard-desc">
                            Performance, strategies, the trade blotter, and research start with labelled examples
                            so you can explore before connecting accounts. Turn this off to see only your own data.
                        </div>
                    </div>
                    <label className="pm-switch" aria-label="Show example data">
                        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
                        <span />
                    </label>
                </div>
            </div>
        </section>
    );
}
