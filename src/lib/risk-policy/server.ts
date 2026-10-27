/**
 * What the risk policy evaluates, loaded on the server once per page
 * (launch items i52 and i54): the user's portfolio (./portfolio.ts) and
 * their saved policy. Today evaluates them as it renders; Trade and the
 * Settings previews get them from the page and evaluate them with the
 * settings as the user edits them.
 */

import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { isDatabaseConfigured } from "@/db/connection-options";
import { theses } from "@/db/schema";
import { getSecurityProfiles } from "@/lib/markets/price-store";
import { loadSecurityProfiles, type SecurityProfile } from "@/lib/markets/security-profile";
import { loggableError } from "@/lib/observability/loggable-error";
import { buildDashboardPortfoliosQuery, buildUserTransactionsQuery } from "@/lib/portfolio-repository";
import { toActivityRows, type ActivityRow } from "@/lib/portfolio/activity";
import { isSeedThesis } from "@/lib/research/thesis";
import { loadQuotes } from "@/lib/services/market-data-service";
import { storedRiskPolicy } from "@/lib/settings/risk-policy";
import { serverSettingsFor } from "@/lib/settings/server";

import { buildPolicyPortfolio } from "./portfolio";
import type { SellDisciplineThesis } from "./sell-discipline";
import { EMPTY_POLICY_PORTFOLIO, type PolicyPortfolio, type RiskPolicySettings } from "./user-policy";

type Database = typeof db;

/** What the sell rules read of the user's theses, newest first, as the research store has them. */
export function buildPolicyThesesQuery(userId: string, database: Pick<Database, "select"> = db) {
    return database
        .select({
            id: theses.id,
            ticker: theses.ticker,
            status: theses.status,
            targetPrice: theses.targetPrice,
            currentPrice: theses.currentPrice,
            dateUpdated: theses.dateUpdated,
            healthScore: theses.healthScore,
        })
        .from(theses)
        .where(and(eq(theses.userId, userId), eq(theses.dismissed, false)))
        .orderBy(desc(theses.createdAt), asc(theses.id));
}

/** The theses the user wrote: the examples, edited or not, are left out. */
export async function loadPolicyTheses(userId: string, database: Pick<Database, "select"> = db): Promise<SellDisciplineThesis[]> {
    const rows = await buildPolicyThesesQuery(userId, database);
    return rows
        .filter((row) => !isSeedThesis(row))
        .map(({ currentPrice, ...row }) => ({ ...row, currentPrice: currentPrice ?? undefined }));
}

/** What the server loads for the risk policy, and what else Ask reads of it. */
export interface PolicyData {
    portfolio: PolicyPortfolio;
    /** Every transaction, newest first. */
    activity: ActivityRow[];
    /** Securities master profiles of the held tickers. */
    profiles: Map<string, SecurityProfile>;
}

/** The user's portfolio and transactions; throws when the database fails. */
export async function loadPolicyData(userId: string, now: Date = new Date()): Promise<PolicyData> {
    const [accounts, transactions, policyTheses] = await Promise.all([
        buildDashboardPortfoliosQuery(userId),
        buildUserTransactionsQuery(userId),
        loadPolicyTheses(userId),
    ]);
    const symbols = accounts.flatMap((account) => account.holdings.map((holding) => holding.symbol));
    const [quotes, profiles] = await Promise.all([
        loadQuotes(symbols),
        loadSecurityProfiles(symbols, getSecurityProfiles),
    ]);
    const activity = toActivityRows(transactions);
    return {
        portfolio: buildPolicyPortfolio({ accounts, quotes, profiles, activity, theses: policyTheses, asOf: now }),
        activity,
        profiles,
    };
}

export interface LoadedPolicyPortfolio {
    portfolio: PolicyPortfolio;
    /** A configured database failed to answer: views say so instead of showing an empty portfolio. */
    unavailable: boolean;
}

/**
 * The user's portfolio for the risk policy. Without a configured database
 * nothing is queried and the portfolio is empty.
 */
export async function loadPolicyPortfolio(
    userId: string,
    { databaseConfigured = isDatabaseConfigured(), now = new Date() }: { databaseConfigured?: boolean; now?: Date } = {},
): Promise<LoadedPolicyPortfolio> {
    if (!databaseConfigured) return { portfolio: EMPTY_POLICY_PORTFOLIO, unavailable: false };
    try {
        return { portfolio: (await loadPolicyData(userId, now)).portfolio, unavailable: false };
    } catch (error) {
        // Logged during a render, so an AggregateError can't go to the console as is.
        console.error("Risk policy portfolio fetch failed — showing the outage notice.", loggableError(error));
        return { portfolio: EMPTY_POLICY_PORTFOLIO, unavailable: true };
    }
}

/** The user's saved risk policy; the defaults without one, or when it can't be read. */
export async function loadUserRiskPolicy(userId: string): Promise<RiskPolicySettings> {
    return storedRiskPolicy(await serverSettingsFor(userId));
}
