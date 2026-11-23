import { isDatabaseConfigured } from "@/db/connection-options";
import { requirePageUserId } from "@/lib/auth/request-user";
import { loadQuotes } from "@/lib/services/market-data-service";
import { loadDashboardPortfolios } from "@/lib/dashboard-portfolios";
import { buildDashboardPortfoliosQuery } from "@/lib/portfolio-repository";
import { buildAccountRows, summarizeAccounts } from "@/lib/portfolio/accounts";
import { loadNetWorthItems } from "@/lib/portfolio/net-worth-items";
import { AccountsView, type AccountsViewProps } from "@/components/portfolio/AccountsView";
import { PageHeaderSync } from "@/components/layout/TopBar";
import { DataUnavailableNotice } from "@/components/data-display/DataUnavailableNotice";
import { bankLinkingAvailable } from "@/lib/plaid/availability";

/**
 * Portfolio › Accounts — per-account value, cash, and positions from the
 * database, then the user's other assets and debts.
 */

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
    const userId = await requirePageUserId();
    const [{ portfolios, unavailable }, netWorth] = await Promise.all([
        loadDashboardPortfolios(userId, buildDashboardPortfoliosQuery),
        // Without a database there's nowhere to keep them, so no card.
        isDatabaseConfigured()
            ? loadNetWorthItems(userId)
                .then((items): AccountsViewProps["netWorth"] => ({ items }))
                .catch((e): AccountsViewProps["netWorth"] => {
                    console.warn("Accounts: other assets and debts fetch failed — the card shows the outage notice.", e);
                    return "unavailable";
                })
            : null,
    ]);
    const header = (
        <PageHeaderSync
            title="Portfolio"
            subtitle="Value, cash, and positions by account"
            crumbs={["Portfolio", "Accounts"]}
        />
    );
    // The other assets and debts aren't shown either: their card needs the accounts' total.
    if (unavailable) {
        return (
            <>
                {header}
                <div className="pm-page">
                    <DataUnavailableNotice what="your accounts" />
                </div>
            </>
        );
    }

    // Without market data the stored prices stand.
    const live = await loadQuotes(portfolios.flatMap((p) => p.holdings.map((h) => h.symbol)));
    const quotes: Record<string, number> = Object.fromEntries(Object.entries(live).map(([s, q]) => [s, q.price]));

    const rows = buildAccountRows(portfolios, quotes);
    return (
        <>
            {header}
            {/* Decided here, on the server: the empty state offers to connect
                a bank only where Settings can (x30). */}
            <AccountsView rows={rows} summary={summarizeAccounts(rows)} netWorth={netWorth} bankLinking={bankLinkingAvailable()} />
        </>
    );
}
