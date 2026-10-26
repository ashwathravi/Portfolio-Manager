/**
 * The user's portfolio as the risk policy reads it (./user-policy.ts), from
 * what the server loaded: every account's holdings valued as Today values
 * them, their cash, their buys and sells, and the theses they wrote.
 */

import type { ActivityRow } from "@/lib/portfolio/activity";
import type { SecurityProfile } from "@/lib/markets/security-profile";
import { holdingName } from "@/lib/markets/security-profile";
import type { Quote } from "@/types/market-data";

import { defaultPolicyBucket } from "./buckets";
import type { SellDisciplineThesis } from "./sell-discipline";
import type { PolicyPortfolio, PolicyPortfolioHolding } from "./user-policy";

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

export interface StoredPolicyAccount {
    cashBalance?: number | null;
    holdings: readonly StoredPolicyHolding[];
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
    asOf,
}: {
    accounts: readonly StoredPolicyAccount[];
    quotes?: Readonly<Record<string, Pick<Quote, "price">>>;
    profiles?: ReadonlyMap<string, SecurityProfile>;
    activity?: readonly ActivityRow[];
    theses?: readonly SellDisciplineThesis[];
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
        cashTotal: accounts.reduce((sum, account) => sum + (account.cashBalance || 0), 0),
        trades: activity
            .filter((row) => (row.side === "BUY" || row.side === "SELL") && !(Date.parse(row.date) < since))
            .map((row) => ({
                id: row.id,
                date: row.date,
                type: row.side.toLowerCase(),
                ticker: row.symbol ?? undefined,
                amount: row.value,
            })),
        theses: [...theses],
    };
}
