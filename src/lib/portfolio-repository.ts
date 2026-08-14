import { and, eq, getTableColumns, sql } from "drizzle-orm";

import { db } from "@/db";
import { holdings, portfolios, transactions } from "@/db/schema";

const holdingWithPortfolio = {
    ...getTableColumns(holdings),
    portfolioName: portfolios.name,
};

const transactionWithPortfolio = {
    ...getTableColumns(transactions),
    portfolioName: portfolios.name,
};

export function buildDashboardPortfoliosQuery(userId: string) {
    return db.query.portfolios.findMany({
        where: eq(portfolios.userId, userId),
        with: { holdings: true },
    });
}

export function buildUserHoldingsQuery(userId: string) {
    return db
        .select(holdingWithPortfolio)
        .from(holdings)
        .innerJoin(portfolios, eq(holdings.portfolioId, portfolios.id))
        .where(eq(portfolios.userId, userId));
}

export function buildUserHoldingPositionsQuery(userId: string, symbol: string) {
    return db
        .select(holdingWithPortfolio)
        .from(holdings)
        .innerJoin(portfolios, eq(holdings.portfolioId, portfolios.id))
        .where(and(
            eq(portfolios.userId, userId),
            sql`upper(${holdings.symbol}) = ${symbol.toUpperCase()}`,
        ));
}

export function buildUserTransactionsQuery(userId: string) {
    return db
        .select(transactionWithPortfolio)
        .from(transactions)
        .innerJoin(portfolios, eq(transactions.portfolioId, portfolios.id))
        .where(eq(portfolios.userId, userId));
}

export function buildUserPortfolioCountQuery(userId: string) {
    return db
        .select({ count: sql<number>`count(*)::int` })
        .from(portfolios)
        .where(eq(portfolios.userId, userId));
}

export function buildOwnedPortfolioQuery(userId: string, portfolioId: string) {
    return db
        .select({ id: portfolios.id })
        .from(portfolios)
        .where(and(
            eq(portfolios.id, portfolioId),
            eq(portfolios.userId, userId),
        ))
        .limit(1);
}

export function buildOwnedPortfolioHoldingsQuery(userId: string, portfolioId: string) {
    return db
        .select(getTableColumns(holdings))
        .from(holdings)
        .innerJoin(portfolios, eq(holdings.portfolioId, portfolios.id))
        .where(and(
            eq(holdings.portfolioId, portfolioId),
            eq(portfolios.userId, userId),
        ));
}
