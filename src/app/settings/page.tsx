import { Suspense } from "react";
import { SettingsRouter } from "@/components/settings/SettingsRouter";
import { PolicyPortfolioProvider } from "@/components/providers/PolicyPortfolioProvider";
import { requirePageUserId } from "@/lib/auth/request-user";
import { loadPolicyPortfolio } from "@/lib/risk-policy/server";

/**
 * Phase 8 (AR-87) Settings page.
 *
 * The default surface is the new 4-card grid (`SettingsPageClient`).
 * The legacy tabbed layout (`SettingsTabs`) is still reachable at
 * `/settings?tab=<slug>` for deep-dive areas not yet rebuilt —
 * notifications, API keys, data & privacy, tags, alerts, security.
 *
 * The router lives in `components/` rather than inline here so that
 * the server shell stays a thin wrapper. `usePageHeader` has to run
 * in a client component, which is why we delegate one layer down.
 *
 * The risk policy previews run the user's rules against their own
 * portfolio (launch item i54), loaded here.
 */

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
    const userId = await requirePageUserId();
    const policyPortfolio = await loadPolicyPortfolio(userId);
    return (
        <PolicyPortfolioProvider value={policyPortfolio}>
            <Suspense fallback={null}>
                <SettingsRouter />
            </Suspense>
        </PolicyPortfolioProvider>
    );
}
