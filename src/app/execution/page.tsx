import { ExecutionPageClient } from "@/components/execution/ExecutionPageClient";
import { PolicyPortfolioProvider } from "@/components/providers/PolicyPortfolioProvider";
import { requirePageUserId } from "@/lib/auth/request-user";
import { loadTradeTicket } from "@/lib/execution/server";
import { loadPolicyPortfolio } from "@/lib/risk-policy/server";

/**
 * Phase 7 (AR-83/84/85/86) Execution workspace.
 *
 * Thin server shell. The page chrome (title, subtitle, crumbs) is owned by
 * `ExecutionPageClient`.
 *
 * The ticket runs on the user's own data (launch item i53): their accounts
 * with cash and positions, the last price of each ticker they hold, and
 * the order plans they saved. Its risk-policy checks run against their
 * whole portfolio (launch item i54), loaded here too.
 */

export const dynamic = "force-dynamic";

export default async function ExecutionPage() {
    const userId = await requirePageUserId();
    const [policyPortfolio, ticket] = await Promise.all([loadPolicyPortfolio(userId), loadTradeTicket(userId)]);
    return (
        <PolicyPortfolioProvider value={policyPortfolio}>
            <ExecutionPageClient ticket={ticket} />
        </PolicyPortfolioProvider>
    );
}
