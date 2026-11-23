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
 *   - which bucket each holding is in (`bucketAssignments`: by ticker, or
 *     by `manual:<id>` for a holding valued by hand), the bucket its
 *     security type suggests until they choose (`defaultPolicyBucket`), and
 *     core for a holding valued by hand, whose theme follows its bucket;
 *   - which tickers are their employer's (the employer plan's `symbols`),
 *     none until they name them.
 */

import { isManualSymbol, manualHoldingId, manualSymbol } from "@/lib/portfolio/manual-symbol";

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
import { optionNetValue, type OptionRiskPosition, type OptionsRiskPolicy } from "./options";
import type { SellDisciplineRule, SellDisciplineThesis } from "./sell-discipline";
import type { ThemeId, ThemeWeight } from "./themes";

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

/**
 * Choices kept per user, tickers and holdings valued by hand together: far
 * more than anyone holds.
 */
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
    /**
     * The bucket the user chose for a holding: by ticker (upper case), or by
     * `manual:<id>` (lower case) for a holding valued by hand
     * (`bucketChoiceKey`). A holding without one keeps its default.
     */
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
    /** The account it's in; set for holdings valued by hand. */
    account?: string;
}

/** The user's portfolio, as every risk-policy view reads it. */
export interface PolicyPortfolio {
    holdings: PolicyPortfolioHolding[];
    /**
     * Holdings valued by hand (no ticker): in the portfolio's value, its
     * buckets, themes and stress tests, never checked as a single name.
     */
    handValued?: PolicyPortfolioHolding[];
    cashTotal: number;
    trades: RiskPolicyDashboardTrade[];
    /** The theses the user wrote (examples left out). */
    theses: SellDisciplineThesis[];
    /** The option positions the user holds (launch item i63), marked as the LEAPS ledger marks them. */
    options: OptionRiskPosition[];
}

export const EMPTY_POLICY_PORTFOLIO: PolicyPortfolio = { holdings: [], cashTotal: 0, trades: [], theses: [], options: [] };

/** What the holdings, option positions and cash are worth together; a written option counts against it. */
export function policyPortfolioValue(portfolio: Pick<PolicyPortfolio, "holdings" | "cashTotal" | "handValued"> & { options?: readonly OptionRiskPosition[] }): number {
    return portfolio.cashTotal
        + portfolio.holdings.reduce((sum, holding) => sum + holding.marketValue, 0)
        + (portfolio.handValued ?? []).reduce((sum, holding) => sum + holding.marketValue, 0)
        + (portfolio.options ?? []).reduce((sum, position) => sum + optionNetValue(position), 0);
}

export function normalizeTicker(symbol: string | null | undefined): string {
    return symbol?.trim().toUpperCase() ?? "";
}

/**
 * The key a holding's bucket choice goes by in `bucketAssignments`: a
 * ticker in upper case, and a holding valued by hand as `manual:<id>` with
 * the id in lower case, as Postgres writes it. Any case comes in (the
 * dashboard upper-cases every symbol), and no ticker has a colon, so the
 * two never meet.
 */
export function bucketChoiceKey(symbol: string): string {
    const id = manualHoldingId(symbol.trim());
    return id === null ? normalizeTicker(symbol) : manualSymbol(id.toLowerCase());
}

/** The bucket the user chose for a holding, by ticker or by its id when valued by hand; none while it keeps its default. */
export function chosenBucket(
    policy: Pick<RiskPolicySettings, "bucketAssignments">,
    symbol: string,
): AssignablePolicyBucket | undefined {
    return policy.bucketAssignments?.[bucketChoiceKey(symbol)];
}

const HAND_VALUED_THEMES: Record<AssignablePolicyBucket, ThemeId> = {
    core: "broad_core_index",
    active: "unknown",
    speculative: "unknown",
    special_situation: "special_situation_regulatory",
    cash_reserve: "bonds_treasuries_cash_equivalent",
};

/**
 * The theme a holding valued by hand counts under: it has no ticker to
 * classify, so its bucket stands for it. Core is a diversified fund, cash
 * reserve is cash or bonds, a special situation is one; an active or
 * speculative holding could be anything, so its theme is unknown.
 */
export function handValuedThemeWeights(bucket: AssignablePolicyBucket): ThemeWeight[] {
    const theme = HAND_VALUED_THEMES[bucket];
    return [{ theme, weight: 1, source: theme === "unknown" ? "unknown" : "fallback" }];
}

/**
 * Holdings valued by hand with the user's choices applied: in the bucket
 * chosen for each, core until then, with the theme that bucket implies.
 * Never employer stock: the employer plan acts on tickers.
 */
export function policyHandValued(
    handValued: readonly PolicyPortfolioHolding[],
    policy: Pick<RiskPolicySettings, "bucketAssignments">,
): RiskPolicyDashboardHolding[] {
    return handValued.map((holding) => {
        const bucket = chosenBucket(policy, holding.symbol) ?? assignableOrCore(holding.defaultBucket);
        return {
            ...holding,
            policyBucket: bucket,
            isEmployerStock: false,
            themeWeights: handValuedThemeWeights(bucket),
        };
    });
}

function assignableOrCore(bucket: PolicyBucketId | null): AssignablePolicyBucket {
    return bucket && bucket !== "unassigned" ? bucket : "core";
}

/** What the policy calls a holding valued by hand when its name isn't at hand. */
export const HAND_VALUED_LABEL = "Valued by hand";

/** The names of the holdings valued by hand, by their `bucketChoiceKey`. */
export function handValuedNames(portfolio: Pick<PolicyPortfolio, "handValued">): Map<string, string> {
    return new Map((portfolio.handValued ?? []).map((holding) => [bucketChoiceKey(holding.symbol), holding.name]));
}

/**
 * How the policy lists a holding: a ticker as itself, a holding valued by
 * hand by its name, never by its internal key.
 */
export function policyHoldingLabel(symbol: string, name?: string | null): string {
    if (!isManualSymbol(symbol.trim())) return symbol;
    return name?.trim() || HAND_VALUED_LABEL;
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
    return holdings.map((holding) => ({
        ...holding,
        policyBucket: chosenBucket(policy, holding.symbol) ?? null,
        isEmployerStock: employer.has(normalizeTicker(holding.symbol)),
    }));
}

/**
 * The user's bucket choices after choosing `bucket` for `symbol`, a ticker
 * or a holding valued by hand (null: back to its default). Past
 * MAX_BUCKET_ASSIGNMENTS, choices for holdings no longer `held` go first,
 * so a save is never refused for holding too many.
 */
export function withBucketChoice(
    assignments: RiskPolicySettings["bucketAssignments"],
    symbol: string,
    bucket: AssignablePolicyBucket | null,
    held: readonly string[],
): RiskPolicySettings["bucketAssignments"] {
    const chosen = bucketChoiceKey(symbol);
    const next = { ...assignments };
    if (bucket) next[chosen] = bucket;
    else delete next[chosen];
    const keys = Object.keys(next);
    if (keys.length <= MAX_BUCKET_ASSIGNMENTS) return next;
    const keep = new Set([chosen, ...held.map(bucketChoiceKey)]);
    return Object.fromEntries(
        Object.entries(next).filter(([key]) => keep.has(key)).slice(-MAX_BUCKET_ASSIGNMENTS),
    );
}

/**
 * The bucket the user chose for a ticker they're about to trade, held now
 * or not (a choice outlives selling out). An option keeps its own
 * classification, so none; nor is a holding valued by hand ever traded.
 */
export function chosenBucketForTrade(
    policy: Pick<RiskPolicySettings, "bucketAssignments">,
    ticker: string,
    instrumentType: "equity" | "option",
): AssignablePolicyBucket | undefined {
    if (instrumentType !== "equity" || isManualSymbol(ticker.trim())) return undefined;
    return chosenBucket(policy, ticker);
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
        otherHoldings: policyHandValued(portfolio.handValued ?? [], policy),
        cashTotal: portfolio.cashTotal,
        trades: portfolio.trades,
        theses: portfolio.theses,
        asOf,
        bucketPolicies: policy.bucketPolicies,
        themeCaps: policy.themeCaps,
        cashJobs: policy.cashJobs,
        cashDeploymentRule: policy.cashDeploymentRule,
        employerStockPlan: policy.employerStockPlan,
        optionPositions: portfolio.options,
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
