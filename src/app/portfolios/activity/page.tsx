import { requirePageUserId } from "@/lib/auth/request-user";
import { buildUserPortfolioOptionsQuery, buildUserTransactionsQuery } from "@/lib/portfolio-repository";
import { toActivityRows, type TransactionRowInput } from "@/lib/portfolio/activity";
import { ActivityPageClient } from "@/components/portfolio/ActivityPageClient";
import { PageHeaderSync } from "@/components/layout/TopBar";

/** Portfolio › Activity — every transaction across the user's accounts. */

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
    const userId = await requirePageUserId();
    let rows: TransactionRowInput[] = [];
    let accounts: { id: string; name: string }[] = [];
    try {
        [rows, accounts] = await Promise.all([buildUserTransactionsQuery(userId), buildUserPortfolioOptionsQuery(userId)]);
    } catch (e) {
        console.warn("Transactions fetch failed — showing empty activity.", e);
    }
    return (
        <>
            <PageHeaderSync
                title="Portfolio"
                subtitle="Every buy, sell, dividend, and transfer"
                crumbs={["Portfolio", "Activity"]}
            />
            <ActivityPageClient rows={toActivityRows(rows)} accountOptions={accounts} />
        </>
    );
}
