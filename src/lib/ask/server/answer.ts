/**
 * Answering a question from the user's own data (launch item i56): plan
 * it, load what its tools read, run them. Everything comes from the
 * database: the portfolio, transactions and closed trades, the theses the
 * user wrote and the risk policy they saved, and, only for the tools that
 * need them, stored closes and Alpha Radar's evidence. Without a database
 * there is nothing to load and the answer says so.
 *
 * With ASK_MODEL set, Claude plans the question instead of the rules
 * (launch item i59, ./claude.ts), calling the same tools over the same
 * data. Without it, or when Claude can't answer, the rules do.
 */

import { isDatabaseConfigured } from "@/db/connection-options";
import { DrizzleAlphaRadarSemanticMemoryRepository } from "@/lib/alpha-radar/memory-repository";
import { loadClosedTrades } from "@/lib/journal/server";
import { storedClosesLoader, type ClosesLoader } from "@/lib/performance/return-history";
import type { ClosedTrade } from "@/lib/portfolio/closed-trades";
import { EMPTY_POLICY_PORTFOLIO, normalizeTicker } from "@/lib/risk-policy";
import { loadPolicyData, loadUserRiskPolicy } from "@/lib/risk-policy/server";
import { storedRiskPolicy } from "@/lib/settings/risk-policy";

import { plan, type PlannedCall, type PlannerResult } from "../planner";
import { answerPlanned } from "../run";
import { CORRELATION_SESSIONS, type AskContext } from "../tools";
import type { AskAnswer, AskMessage, AskWriter } from "../types";
import { answerWithClaude, askModel, type ClaudeOptions } from "./claude";

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

export interface AskContextOptions {
    now?: Date;
    databaseConfigured?: boolean;
    sources?: AskSources;
}

/** The context for some tool calls. Throws when the database fails. */
export type AskContextLoader = (calls: readonly PlannedCall[]) => Promise<AskContext>;

/**
 * Loads the user's data as tool calls need it, each part once: the
 * portfolio, policy and sectors for every call, closed trades and Alpha
 * Radar's evidence for the tools that read them, and stored closes for a
 * correlation, for the ticker asked about and the holdings.
 */
export function askContextLoader(
    userId: string,
    { now = new Date(), databaseConfigured = isDatabaseConfigured(), sources = DATABASE_SOURCES }: AskContextOptions = {},
): AskContextLoader {
    const once = <T>(load: () => Promise<T>) => {
        let loaded: Promise<T> | undefined;
        return () => (loaded ??= load());
    };
    const base = once(async () => {
        const [data, policy] = await Promise.all([sources.loadData(userId, now), sources.loadPolicy(userId)]);
        const sectors: Record<string, string> = {};
        for (const [symbol, profile] of data.profiles) if (profile.sector) sectors[symbol] = profile.sector;
        return { data, policy, sectors };
    });
    // Closed trades, for the questions about them: sales matched against
    // earlier buys, leaving out tickers a split may have put on another scale.
    const trades = once(async () => loadClosedTrades((await base()).data.activity, sources.loadCloses, now));
    const evidence = once(() => sources.loadEvidence());
    const closesFor = new Map<string, Promise<NonNullable<AskContext["closes"]>>>();

    return async (calls) => {
        if (!databaseConfigured) {
            return {
                portfolio: EMPTY_POLICY_PORTFOLIO,
                activity: [],
                closedTrades: [],
                policy: storedRiskPolicy({ status: "unavailable" }),
                now: now.getTime(),
            };
        }
        const uses = (name: PlannedCall["name"]) => calls.some((call) => call.name === name);
        const { data, policy, sectors } = await base();

        let closes: AskContext["closes"];
        const correlation = calls.find((call) => call.name === "correlation_with");
        if (correlation) {
            const target = normalizeTicker(correlation.args.symbol as string | undefined);
            let loading = closesFor.get(target);
            if (!loading) {
                const symbols = [...new Set([target, ...data.portfolio.holdings.map((holding) => normalizeTicker(holding.symbol))])].filter(Boolean);
                const from = new Date(now.getTime() - CORRELATION_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
                loading = sources.loadCloses(symbols, from, now.toISOString().slice(0, 10));
                closesFor.set(target, loading);
            }
            closes = await loading;
        }

        const [closed, memory] = await Promise.all([
            uses("pnl_attribution") || uses("trades_matching")
                ? trades()
                : Promise.resolve({ trades: [] as ClosedTrade[], leftOut: [] as string[] }),
            uses("alpha_radar_evidence_search") ? evidence() : Promise.resolve(undefined),
        ]);

        return {
            portfolio: data.portfolio,
            activity: data.activity,
            closedTrades: closed.trades,
            closedTradesLeftOut: closed.leftOut,
            policy,
            sectors,
            closes,
            alphaRadarMemory: memory,
            now: now.getTime(),
        };
    };
}

/** The user's data the planned tools read. Throws when the database fails. */
export async function loadAskContext(userId: string, planned: PlannerResult, options: AskContextOptions = {}): Promise<AskContext> {
    return askContextLoader(userId, options)(planned.calls);
}

export interface AnswerOptions extends AskContextOptions {
    /** The conversation so far, oldest first, for Claude to read follow-ups by. */
    history?: readonly AskMessage[];
    /** Claude's model and settings; by default ASK_MODEL's, or none. */
    claude?: ClaudeOptions | null;
}

/** The answer to `question` from the user's own data, and who wrote it. */
export async function answerQuestionWith(
    userId: string,
    question: string,
    { history = [], claude = defaultClaude(userId), ...options }: AnswerOptions = {},
): Promise<{ answer: AskAnswer; writer: AskWriter }> {
    const load = askContextLoader(userId, options);
    if (claude) {
        const answer = await answerWithClaude(question, load, { ...claude, history });
        if (answer) return { answer, writer: "claude" };
    }
    const planned = plan(question);
    return { answer: answerPlanned(planned, await load(planned.calls)), writer: "rules" };
}

/** The answer to `question` from the user's own data. */
export async function answerQuestion(userId: string, question: string, options: AnswerOptions = {}): Promise<AskAnswer> {
    return (await answerQuestionWith(userId, question, options)).answer;
}

function defaultClaude(userId: string): ClaudeOptions | null {
    const model = askModel();
    return model ? { model, userId } : null;
}
