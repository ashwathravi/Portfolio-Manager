"use client";

import type { RiskPolicyDashboardSummary } from "@/lib/risk-policy";
import {
    RiskPolicyDashboardCard,
    type RiskPolicyDashboardCardInput,
} from "@/components/dashboard/RiskPolicyDashboardCard";

/**
 * One-line risk-policy summary with the full check grid behind a
 * disclosure. The review found the 12-tile grid filled the first screen
 * and pushed the user's money below the fold; breaches already surface in
 * "Needs your attention".
 */
export function PolicyStrip({ summary, input }: { summary: RiskPolicyDashboardSummary; input: RiskPolicyDashboardCardInput }) {
    const { breached, watch, missing_data: missing, inside } = summary.statusCounts;
    const parts = [
        breached ? `${breached} breached` : null,
        watch ? `${watch} to watch` : null,
        missing ? `${missing} missing data` : null,
        `${inside} inside policy`,
    ].filter(Boolean);
    return (
        <details className="pm-card pm-policy-strip" data-testid="policy-strip" data-status={summary.overallStatus}>
            <summary>
                <span className="pm-policy-strip-label">Risk policy</span>
                <span className="pm-policy-strip-counts">{parts.join(" · ")}</span>
                <span className="pm-policy-strip-toggle">Show all checks</span>
            </summary>
            <div className="pm-policy-strip-body">
                <RiskPolicyDashboardCard summary={summary} input={input} />
            </div>
        </details>
    );
}
