/**
 * Answering a question from the user's own data (launch item i56): plan
 * it, load what its tools read, run them. Everything comes from the
 * database: the portfolio, transactions and closed trades, the theses the
 * user wrote and the risk policy they saved, and, only for the tools that
 * need them, stored closes and Alpha Radar's evidence. Without a database
 * there is nothing to load and the answer says so.
 */

import { isDatabaseConfigured } from "@/db/connection-options";
import { DrizzleAlphaRadarSemanticMemoryRepository } from "@/lib/alpha-radar/memory-repository";
import { storedClosesLoader, type ClosesLoader } from "@/lib/performance/return-history";
import { closedTrades } from "@/lib/portfolio/closed-trades";
import { EMPTY_POLICY_PORTFOLIO, normalizeTicker } from "@/lib/risk-policy";
import { loadPolicyData, loadUserRiskPolicy } from "@/lib/risk-policy/server";
import { storedRiskPolicy } from "@/lib/settings/risk-policy";

import { plan, type PlannerResult } from "../planner";
import { answerPlanned } from "../run";
import { CORRELATION_SESSIONS, type AskContext } from "../tools";
import type { AskAnswer } from "../types";

/** Calendar days of closes that hold CORRELATION_SESSIONS sessions, holidays included. */
const CORRELATION_LOOKBACK_DAYS = Math.ceil(CORRELATION_SESSIONS * 1.6);

export interface AskSources {
    loadData: typeof loadPolicyData;
    loadPolicy: typeof loadUserRiskPolicy;
    loadCloses: ClosesLoader;
    loadEvidence: () => Promise<NonNullable<AskContext["alphaRadarMemory"]>>;
}

const DATABASE_SOURCES: AskSources = {
    loadData: loadPolicyData,
    loadPolicy: loadUserRiskPolicy,
    loadCloses: (symbols, from, to) => storedClosesLoader()(symbols, from, to),
    loadEvidence: () => new DrizzleAlphaRadarSemanticMemoryRepository().listChunks(),
};

/** The user's data the planned tools read. Throws when the database fails. */
export async function loadAskContext(
    userId: string,
    planned: PlannerResult,
    {
        now = new Date(),
        databaseConfigured = isDatabaseConfigured(),
        sources = DATABASE_SOURCES,
    }: { now?: Date; databaseConfigured?: boolean; sources?: AskSources } = {},
): Promise<AskContext> {
    if (!databaseConfigured) {
        return {
            portfolio: EMPTY_POLICY_PORTFOLIO,
            activity: [],
            closedTrades: [],
            policy: storedRiskPolicy({ status: "unavailable" }),
            now: now.getTime(),
        };
    }
    const uses = (name: PlannerResult["calls"][number]["name"]) => planned.calls.some((call) => call.name === name);
    const [data, policy, evidence] = await Promise.all([
        sources.loadData(userId, now),
        sources.loadPolicy(userId),
        uses("alpha_radar_evidence_search") ? sources.loadEvidence() : Promise.resolve(undefined),
    ]);

    let closes: AskContext["closes"];
    const correlation = planned.calls.find((call) => call.name === "correlation_with");
    if (correlation) {
        const target = normalizeTicker(correlation.args.symbol as string | undefined);
        const symbols = [...new Set([target, ...data.portfolio.holdings.map((holding) => normalizeTicker(holding.symbol))])].filter(Boolean);
        const from = new Date(now.getTime() - CORRELATION_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
        closes = await sources.loadCloses(symbols, from, now.toISOString().slice(0, 10));
    }

    const sectors: Record<string, string> = {};
    for (const [symbol, profile] of data.profiles) if (profile.sector) sectors[symbol] = profile.sector;

    return {
        portfolio: data.portfolio,
        activity: data.activity,
        closedTrades: closedTrades(data.activity),
        policy,
        sectors,
        closes,
        alphaRadarMemory: evidence,
        now: now.getTime(),
    };
}

/** The answer to `question` from the user's own data. */
export async function answerQuestion(
    userId: string,
    question: string,
    options: Parameters<typeof loadAskContext>[2] = {},
): Promise<AskAnswer> {
    const planned = plan(question);
    return answerPlanned(planned, await loadAskContext(userId, planned, options));
}
