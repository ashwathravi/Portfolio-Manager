"use client";

import { createContext, useContext, type ReactNode } from "react";
import { EMPTY_POLICY_PORTFOLIO, type PolicyPortfolio } from "@/lib/risk-policy/user-policy";

export interface PolicyPortfolioState {
    portfolio: PolicyPortfolio;
    /** The database failed to answer: say so rather than show an empty portfolio. */
    unavailable: boolean;
}

const PolicyPortfolioContext = createContext<PolicyPortfolioState>({ portfolio: EMPTY_POLICY_PORTFOLIO, unavailable: false });

/**
 * The user's portfolio as the risk policy reads it, loaded by the page on
 * the server (src/lib/risk-policy/server.ts), for the views that evaluate
 * the policy as the user edits it: the Settings previews and Trade.
 */
export function PolicyPortfolioProvider({ value, children }: { value: PolicyPortfolioState; children: ReactNode }) {
    return <PolicyPortfolioContext.Provider value={value}>{children}</PolicyPortfolioContext.Provider>;
}

/** Outside a provider, an empty portfolio. */
export function usePolicyPortfolio(): PolicyPortfolioState {
    return useContext(PolicyPortfolioContext);
}
