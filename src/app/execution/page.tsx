import { ExecutionPageClient } from "@/components/execution/ExecutionPageClient";
import { PolicyPortfolioProvider } from "@/components/providers/PolicyPortfolioProvider";
import { requirePageUserId } from "@/lib/auth/request-user";
import { loadPolicyPortfolio } from "@/lib/risk-policy/server";

/**
 * Phase 7 (AR-83/84/85/86) Execution workspace.
 *
 * Thin server shell. All the page chrome (title, subtitle, crumbs, the
 * Focus/Checkout/Terminal variant switcher that lives in the topbar's
 * actions slot) is owned by `ExecutionPageClient` because the breadcrumb
 * trail updates live with the variant — something a server component
 * can't do without a round-trip.
 *
 * The ticket's risk-policy checks run against the user's own portfolio
 * (launch item i54), loaded here.
 *
 * Rendered dynamic so the variant choice (persisted per-user in
 * localStorage) hydrates on every visit without SSR cache surprises.
 */

export const dynamic = "force-dynamic";

export default async function ExecutionPage() {
    const userId = await requirePageUserId();
    const policyPortfolio = await loadPolicyPortfolio(userId);
    return (
        <PolicyPortfolioProvider value={policyPortfolio}>
            <ExecutionPageClient />
        </PolicyPortfolioProvider>
    );
}
