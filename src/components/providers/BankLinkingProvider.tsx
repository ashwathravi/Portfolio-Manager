"use client";

import { createContext, useContext, type ReactNode } from "react";

const BankLinkingContext = createContext(false);

/**
 * Whether Settings can connect a bank (bankLinkingAvailable, x30), decided on
 * the server by the root layout, for the example-data notices and empty
 * states every page shares (SampleDataNotice, SampleEmptyState). Without it
 * they lead to Accounts, to add an account by hand, instead of a Connect
 * link to a Settings card that says bank linking isn't set up. A page's own
 * empty state (Today, Holdings, Accounts, Activity) gets the same answer as
 * a prop from its page. False outside the provider: Accounts always works.
 */
export function BankLinkingProvider({ available, children }: { available: boolean; children: ReactNode }) {
    return <BankLinkingContext.Provider value={available}>{children}</BankLinkingContext.Provider>;
}

export function useBankLinking(): boolean {
    return useContext(BankLinkingContext);
}
