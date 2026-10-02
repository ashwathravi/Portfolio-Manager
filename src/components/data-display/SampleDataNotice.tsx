"use client";

import Link from "next/link";
import { useSettingsStore } from "@/lib/stores/settingsStore";

/**
 * One-line banner for screens built entirely on example data. Pairs with
 * <SampleTag/> (used on individual cards inside otherwise-real screens).
 * Offers the two ways out: connect real data, or hide examples entirely.
 */
export function SampleDataNotice({ children }: { children?: React.ReactNode }) {
    const setShowSampleData = useSettingsStore((s) => s.setShowSampleData);
    return (
        <p className="pm-sample-notice" data-testid="sample-data-notice" role="note">
            <span className="pm-sample-tag">Sample</span>
            <span>
                {children ?? "These figures are example data, not your accounts."}{" "}
                <Link href="/settings#accounts">Connect an account</Link> or{" "}
                <button type="button" className="pm-link-btn" onClick={() => setShowSampleData(false)}>
                    hide examples
                </button>
                .
            </span>
        </p>
    );
}
