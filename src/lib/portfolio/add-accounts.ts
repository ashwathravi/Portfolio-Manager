/**
 * Where "bring in your own accounts" leads (x30). With bank linking set up
 * (bankLinkingAvailable in src/lib/plaid/availability.ts, asked on the
 * server), Settings connects a brokerage. Without it, Settings only says bank
 * linking isn't set up and points back at Accounts, so a Connect link there
 * would go round in a circle: the way in is Accounts, where an account is
 * added by hand and positions are imported from a broker's CSV.
 *
 * Kept free of server imports, so client components (the example-data
 * notices) can use it with the answer the layout passes down.
 */

export interface AddAccountsLink {
    href: string;
    label: string;
}

export const CONNECT_ACCOUNT_LINK: AddAccountsLink = { href: "/settings#accounts", label: "Connect an account" };
export const ADD_ACCOUNT_LINK: AddAccountsLink = { href: "/portfolios/accounts", label: "Add an account" };

export function addAccountsLink(bankLinking: boolean): AddAccountsLink {
    return bankLinking ? CONNECT_ACCOUNT_LINK : ADD_ACCOUNT_LINK;
}
