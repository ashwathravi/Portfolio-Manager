import { requirePageUserId } from "@/lib/auth/request-user";
import { loadQuotes } from "@/lib/services/market-data-service";
import { loadDashboardPortfolios } from "@/lib/dashboard-portfolios";
import { buildDashboardPortfoliosQuery } from "@/lib/portfolio-repository";
import { buildAccountRows, summarizeAccounts } from "@/lib/portfolio/accounts";
import { AccountsView } from "@/components/portfolio/AccountsView";
import { PageHeaderSync } from "@/components/layout/TopBar";
import { DataUnavailableNotice } from "@/components/data-display/DataUnavailableNotice";
import { bankLinkingAvailable } from "@/lib/plaid/availability";

/** Portfolio › Accounts — per-account value, cash, and positions from the database. */

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
    const userId = await requirePageUserId();
    const { portfolios, unavailable } = await loadDashboardPortfolios(userId, buildDashboardPortfoliosQuery);
    const header = (
        <PageHeaderSync
            title="Portfolio"
            subtitle="Value, cash, and positions by account"
            crumbs={["Portfolio", "Accounts"]}
        />
    );
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
            <AccountsView rows={rows} summary={summarizeAccounts(rows)} bankLinking={bankLinkingAvailable()} />
        </>
    );
}
