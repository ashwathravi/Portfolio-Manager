"use client";

import Link from "next/link";
import { useSettingsStore } from "@/lib/stores/settingsStore";

/**
 * Shown in place of an example-data screen when "Show example data" is off.
 */
export function SampleEmptyState({ title, body }: { title: string; body: string }) {
    const setShowSampleData = useSettingsStore((s) => s.setShowSampleData);
    return (
        <section className="pm-card pm-empty-card" data-testid="sample-empty-state">
            <h2>{title}</h2>
            <p>{body}</p>
            <div className="pm-empty-actions">
                <Link href="/settings#accounts" className="pm-btn pm-btn-primary">Connect an account</Link>
                <button type="button" className="pm-btn pm-btn-ghost" onClick={() => setShowSampleData(true)}>
                    Show example data
                </button>
            </div>
        </section>
    );
}
