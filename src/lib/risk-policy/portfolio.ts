/**
 * The user's portfolio as the risk policy reads it (./user-policy.ts), from
 * what the server loaded: every account's holdings valued as Today values
 * them, their cash, their buys and sells, the theses they wrote and the
 * option positions they hold. Today's Allocation card groups the same
 * holdings, in the buckets the policy puts them in.
 */

import type { ActivityRow } from "@/lib/portfolio/activity";
import type { SecurityProfile } from "@/lib/markets/security-profile";
import { holdingName } from "@/lib/markets/security-profile";
import { manualSymbol } from "@/lib/portfolio/manual-symbol";
import type { Quote } from "@/types/market-data";

import { defaultPolicyBucket, type PolicyBucketId } from "./buckets";
import type { OptionRiskPosition } from "./options";
import type { SellDisciplineThesis } from "./sell-discipline";
import type { ThemeWeight } from "./themes";
import {
    chosenBucket,
    policyHandValued,
    type AssignablePolicyBucket,
    type PolicyPortfolio,
    type PolicyPortfolioHolding,
    type RiskPolicySettings,
} from "./user-policy";

/** A stored holding, as the portfolio queries return it. */
export interface StoredPolicyHolding {
    id: string;
    symbol: string;
    name?: string | null;
    quantity: string | number;
    avgCost: string | number;
    currentPrice?: string | number | null;
    marketValue?: string | number | null;
}

/** A holding valued by hand (manual_holdings), as the portfolio queries return it. */
export interface StoredHandValuedHolding {
    id: string;
    name: string;
    value: string | number;
    costBasis?: string | number | null;
}

export interface StoredPolicyAccount {
    /** The account's name: a holding valued by hand is listed with it. */
    name?: string;
    cashBalance?: number | null;
    holdings: readonly StoredPolicyHolding[];
    manualHoldings?: readonly StoredHandValuedHolding[];
}

/**
 * Holdings valued by hand, as the policy reads them: part of the
 * portfolio's value, never a single name, and in the core bucket (most are
 * a retirement plan's or a college plan's diversified fund) until the user
 * chooses another (`chosenBucket`).
 */
export function handValuedPolicyHoldings(accounts: readonly StoredPolicyAccount[]): PolicyPortfolioHolding[] {
    return accounts.flatMap((account) => (account.manualHoldings ?? []).map((holding) => {
        const marketValue = Number(holding.value) || 0;
        const cost = holding.costBasis == null ? marketValue : Number(holding.costBasis) || 0;
        return {
            id: holding.id,
            symbol: manualSymbol(holding.id),
            name: holding.name,
            quantity: 1,
            avgCost: cost,
            currentPrice: marketValue,
            marketValue,
            defaultBucket: "core" as const,
            ...(account.name ? { account: account.name } : {}),
        };
    }));
}

/**
 * A holding's value now. A live quote values it; otherwise the stored
 * value, then the stored price; without any price it counts at cost, as on
 * Holdings and Accounts, rather than as nothing.
 */
export function valueHolding(
    holding: StoredPolicyHolding,
    livePrice?: number | null,
): { quantity: number; avgCost: number; currentPrice: number; marketValue: number } {
    const quantity = Number(holding.quantity) || 0;
    const avgCost = Number(holding.avgCost) || 0;
    const currentPrice = Number(livePrice ?? holding.currentPrice ?? 0);
    const marketValue = livePrice != null && livePrice > 0
        ? quantity * livePrice
        : Number(holding.marketValue) || quantity * (currentPrice > 0 ? currentPrice : avgCost);
    return { quantity, avgCost, currentPrice, marketValue };
}

/** The longest window the trading-activity check looks back over (Settings clamps to it). */
export const MAX_CHURN_WINDOW_DAYS = 365;

/**
 * The portfolio from what the server loaded. With `asOf`, only the trades
 * the trading-activity check could look at are kept: the page carries them
 * to the browser.
 */
export function buildPolicyPortfolio({
    accounts,
    quotes = {},
    profiles = new Map(),
    activity = [],
    theses = [],
    options = [],
    asOf,
}: {
    accounts: readonly StoredPolicyAccount[];
    quotes?: Readonly<Record<string, Pick<Quote, "price">>>;
    profiles?: ReadonlyMap<string, SecurityProfile>;
    activity?: readonly ActivityRow[];
    theses?: readonly SellDisciplineThesis[];
    options?: readonly OptionRiskPosition[];
    asOf?: Date;
}): PolicyPortfolio {
    const since = asOf ? asOf.getTime() - (MAX_CHURN_WINDOW_DAYS + 1) * 86_400_000 : -Infinity;
    const holdings: PolicyPortfolioHolding[] = accounts.flatMap((account) =>
        account.holdings.map((holding) => {
            const symbol = holding.symbol.toUpperCase();
            const profile = profiles.get(symbol);
            return {
                id: holding.id,
                symbol: holding.symbol,
                name: holdingName(holding.symbol, holding.name, profile),
                ...valueHolding(holding, quotes[symbol]?.price),
                defaultBucket: defaultPolicyBucket(symbol, profile),
            };
        }),
    );
    return {
        holdings,
        handValued: handValuedPolicyHoldings(accounts),
        cashTotal: accounts.reduce((sum, account) => sum + (account.cashBalance || 0), 0),
        // The policy's figures are in dollars: a trade in another currency is
        // left out of its turnover rather than added as if it were dollars.
        trades: activity
            .filter((row) => (row.side === "BUY" || row.side === "SELL") && row.currency === "USD" && !(Date.parse(row.date) < since))
            .map((row) => ({
                id: row.id,
                date: row.date,
                type: row.side.toLowerCase(),
                ticker: row.symbol ?? undefined,
                amount: row.value,
            })),
        theses: [...theses],
        options: [...options],
    };
}

/** A holding as Today's Allocation card groups it: by theme, by policy bucket or by account. */
export interface PolicyAllocationHolding {
    symbol: string;
    /** The account's name, for the Account grouping. */
    portfolio: string;
    marketValue: number;
    /** The bucket the user chose for it; a holding valued by hand always has one, core until they choose. */
    policyBucket?: AssignablePolicyBucket;
    /** The bucket a ticker starts in until the user chooses one (`defaultPolicyBucket`). */
    defaultBucket?: PolicyBucketId | null;
    /** A holding valued by hand's theme, which follows its bucket. */
    themeWeights?: readonly ThemeWeight[];
}

/**
 * Every account's holdings as Today's Allocation card groups them, valued
 * and bucketed as the policy checks read them: a ticker in the bucket the
 * user chose for it, else the one it starts in (`defaultPolicyBucket`); a
 * holding valued by hand in the one chosen for it, core until then, with
 * the theme that bucket implies (`policyHandValued`).
 */
export function policyAllocationHoldings(
    {
        accounts,
        quotes,
        profiles,
    }: {
        accounts: readonly StoredPolicyAccount[];
        quotes?: Readonly<Record<string, Pick<Quote, "price">>>;
        profiles?: ReadonlyMap<string, SecurityProfile>;
    },
    policy: Pick<RiskPolicySettings, "bucketAssignments">,
): PolicyAllocationHolding[] {
    return accounts.flatMap((account) => {
        const portfolio = account.name ?? "";
        const { holdings, handValued = [] } = buildPolicyPortfolio({ accounts: [account], quotes, profiles });
        return [
            ...holdings.map((holding) => ({
                symbol: holding.symbol,
                portfolio,
                marketValue: holding.marketValue,
                policyBucket: chosenBucket(policy, holding.symbol),
                defaultBucket: holding.defaultBucket,
            })),
            ...policyHandValued(handValued, policy).map((holding) => ({
                symbol: holding.symbol,
                portfolio,
                marketValue: holding.marketValue,
                policyBucket: holding.policyBucket,
                themeWeights: holding.themeWeights,
            })),
        ];
    });
}
