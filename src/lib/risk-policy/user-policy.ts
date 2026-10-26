/**
 * The risk policy on the user's own portfolio (launch items i52 and i54).
 *
 * The server loads the portfolio once (holdings valued as Today values them,
 * cash, trades, and the theses the user wrote; ./portfolio.ts), and Today,
 * Trade, Holdings and the Settings previews all evaluate it here with the
 * user's saved policy: the server with the stored settings, a page with the
 * settings as the user edits them. Nothing here reads example data.
 *
 * The user's own choices are part of the policy:
 *   - which bucket each holding is in (`bucketAssignments`, by ticker), the
 *     bucket its security type suggests until they choose
 *     (`defaultPolicyBucket`);
 *   - which tickers are their employer's (the employer plan's `symbols`),
 *     none until they name them.
 */

import { POLICY_BUCKETS, type PolicyBucketId, type PolicyBucketPolicy } from "./buckets";
import type { CashDeploymentRule, CashJob } from "./cash";
import {
    computeRiskPolicyDashboard,
    type RiskPolicyDashboardHolding,
    type RiskPolicyDashboardInput,
    type RiskPolicyDashboardSummary,
    type RiskPolicyDashboardTrade,
} from "./dashboard";
import type { EmployerStockDeRiskingPlan } from "./de-risking";
import type { OptionsRiskPolicy } from "./options";
import type { SellDisciplineRule, SellDisciplineThesis } from "./sell-discipline";
import type { ThemeId } from "./themes";

export interface ChurnPolicySettings {
    windowDays: number;
    watchRepeatSymbols: number;
    breachRepeatSymbols: number;
}

export const DEFAULT_CHURN_POLICY: ChurnPolicySettings = {
    windowDays: 90,
    watchRepeatSymbols: 1,
    breachRepeatSymbols: 3,
};

/** The buckets a user can put a holding in: "unassigned" is having chosen none. */
export const ASSIGNABLE_POLICY_BUCKETS = POLICY_BUCKETS.filter(
    (bucket): bucket is Exclude<PolicyBucketId, "unassigned"> => bucket !== "unassigned",
);
export type AssignablePolicyBucket = (typeof ASSIGNABLE_POLICY_BUCKETS)[number];

/** Choices kept per user: far more tickers than anyone holds. */
export const MAX_BUCKET_ASSIGNMENTS = 500;

/** The settings store's `riskPolicy` slice. */
export interface RiskPolicySettings {
    bucketPolicies: PolicyBucketPolicy[];
    themeCaps: Partial<Record<ThemeId, number>>;
    cashJobs: CashJob[];
    cashDeploymentRule: CashDeploymentRule;
    employerStockPlan: EmployerStockDeRiskingPlan;
    optionsRiskPolicy: OptionsRiskPolicy;
    sellDisciplineRules: SellDisciplineRule[];
    churnPolicy: ChurnPolicySettings;
    /** The bucket the user chose for a ticker (upper case); a ticker without one keeps its default. */
    bucketAssignments: Partial<Record<string, AssignablePolicyBucket>>;
}

/** One position, valued, with the bucket its security type suggests. */
export interface PolicyPortfolioHolding {
    id: string;
    symbol: string;
    name: string;
    quantity: number;
    avgCost: number;
    currentPrice: number;
    marketValue: number;
    /** From the securities master (`defaultPolicyBucket`); null when nothing says. */
    defaultBucket: PolicyBucketId | null;
}

/** The user's portfolio, as every risk-policy view reads it. */
export interface PolicyPortfolio {
    holdings: PolicyPortfolioHolding[];
    cashTotal: number;
    trades: RiskPolicyDashboardTrade[];
    /** The theses the user wrote (examples left out). */
    theses: SellDisciplineThesis[];
}

export const EMPTY_POLICY_PORTFOLIO: PolicyPortfolio = { holdings: [], cashTotal: 0, trades: [], theses: [] };

/** What the holdings and cash are worth together. */
export function policyPortfolioValue(portfolio: Pick<PolicyPortfolio, "holdings" | "cashTotal">): number {
    return portfolio.cashTotal + portfolio.holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
}

export function normalizeTicker(symbol: string | null | undefined): string {
    return symbol?.trim().toUpperCase() ?? "";
}

/** The tickers the user named as their employer's. */
export function employerSymbols(policy: Pick<RiskPolicySettings, "employerStockPlan">): string[] {
    return [...new Set((policy.employerStockPlan?.symbols ?? []).map(normalizeTicker).filter(Boolean))];
}

/** Tickers named as the employer's: a company rarely has more than a few share classes. */
export const MAX_EMPLOYER_TICKERS = 5;

const TICKER = /^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/;

/**
 * The tickers in what the user typed ("goog, googl" or "GOOG GOOGL"): upper
 * case, each once, up to MAX_EMPLOYER_TICKERS; anything that isn't a ticker
 * is left out.
 */
export function parseEmployerTickers(text: string): string[] {
    const tickers = text
        .split(/[\s,;]+/)
        .map(normalizeTicker)
        .filter((ticker) => ticker.length <= 10 && TICKER.test(ticker));
    return [...new Set(tickers)].slice(0, MAX_EMPLOYER_TICKERS);
}

/** The holdings with the user's choices applied: the bucket they chose, and whether it is employer stock. */
export function policyHoldings(
    holdings: readonly PolicyPortfolioHolding[],
    policy: Pick<RiskPolicySettings, "bucketAssignments" | "employerStockPlan">,
): RiskPolicyDashboardHolding[] {
    const employer = new Set(employerSymbols(policy));
    const assignments = policy.bucketAssignments ?? {};
    return holdings.map((holding) => {
        const symbol = normalizeTicker(holding.symbol);
        return {
            ...holding,
            policyBucket: assignments[symbol] ?? null,
            isEmployerStock: employer.has(symbol),
        };
    });
}

/**
 * The user's bucket choices after choosing `bucket` for `symbol` (null: back
 * to its default). Past MAX_BUCKET_ASSIGNMENTS, choices for tickers no
 * longer `held` go first, so a save is never refused for holding too many.
 */
export function withBucketChoice(
    assignments: RiskPolicySettings["bucketAssignments"],
    symbol: string,
    bucket: AssignablePolicyBucket | null,
    held: readonly string[],
): RiskPolicySettings["bucketAssignments"] {
    const ticker = normalizeTicker(symbol);
    const next = { ...assignments };
    if (bucket) next[ticker] = bucket;
    else delete next[ticker];
    const keys = Object.keys(next);
    if (keys.length <= MAX_BUCKET_ASSIGNMENTS) return next;
    const keep = new Set([ticker, ...held.map(normalizeTicker)]);
    return Object.fromEntries(
        Object.entries(next).filter(([key]) => keep.has(key)).slice(-MAX_BUCKET_ASSIGNMENTS),
    );
}

/**
 * The bucket the user chose for a ticker they're about to trade, held now
 * or not (a choice outlives selling out). An option keeps its own
 * classification, so none.
 */
export function chosenBucketForTrade(
    policy: Pick<RiskPolicySettings, "bucketAssignments">,
    ticker: string,
    instrumentType: "equity" | "option",
): AssignablePolicyBucket | undefined {
    if (instrumentType !== "equity") return undefined;
    return policy.bucketAssignments?.[normalizeTicker(ticker)];
}

/** The evaluation's input from the user's portfolio and policy. */
export function riskPolicyInput(
    portfolio: PolicyPortfolio,
    policy: RiskPolicySettings,
    { asOf }: { asOf?: Date } = {},
): RiskPolicyDashboardInput {
    const churn = policy.churnPolicy ?? DEFAULT_CHURN_POLICY;
    return {
        holdings: policyHoldings(portfolio.holdings, policy),
        cashTotal: portfolio.cashTotal,
        trades: portfolio.trades,
        theses: portfolio.theses,
        asOf,
        bucketPolicies: policy.bucketPolicies,
        themeCaps: policy.themeCaps,
        cashJobs: policy.cashJobs,
        cashDeploymentRule: policy.cashDeploymentRule,
        employerStockPlan: policy.employerStockPlan,
        // No options feed yet: the policy sees no option positions rather than example ones.
        optionPositions: [],
        optionsRiskPolicy: policy.optionsRiskPolicy,
        sellDisciplineRules: policy.sellDisciplineRules,
        options: {
            churnWindowDays: churn.windowDays,
            churnWatchRepeatSymbols: churn.watchRepeatSymbols,
            churnBreachRepeatSymbols: churn.breachRepeatSymbols,
        },
    };
}

/** The user's portfolio against their policy: the one evaluation every view shows. */
export function evaluateRiskPolicy(
    portfolio: PolicyPortfolio,
    policy: RiskPolicySettings,
    options: { asOf?: Date } = {},
): RiskPolicyDashboardSummary {
    return computeRiskPolicyDashboard(riskPolicyInput(portfolio, policy, options));
}
