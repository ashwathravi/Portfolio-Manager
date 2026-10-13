import { marketDataEngine } from "@/lib/api/market-data";
import { requirePageUserId } from "@/lib/auth/request-user";
import { loadDashboardPortfolios } from "@/lib/dashboard-portfolios";
import { buildDashboardPortfoliosQuery } from "@/lib/portfolio-repository";
import { buildAccountRows, summarizeAccounts } from "@/lib/portfolio/accounts";
import { AccountsView } from "@/components/portfolio/AccountsView";
import { PageHeaderSync } from "@/components/layout/TopBar";
import { DataUnavailableNotice } from "@/components/data-display/DataUnavailableNotice";

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
                <DataUnavailableNotice what="your accounts" />
            </>
        );
    }

    let quotes: Record<string, number> = {};
    try {
        const symbols = [...new Set(portfolios.flatMap((p) => p.holdings.map((h) => h.symbol.toUpperCase())))];
        if (symbols.length > 0) {
            const live = await marketDataEngine.getQuotes(symbols);
            quotes = Object.fromEntries(Object.entries(live).map(([s, q]) => [s.toUpperCase(), q.price]));
        }
    } catch (e) {
        console.warn("Accounts quote warm-up failed — using cached prices.", e);
    }

    const rows = buildAccountRows(portfolios, quotes);
    return (
        <>
            {header}
            <AccountsView rows={rows} summary={summarizeAccounts(rows)} />
        </>
    );
}
