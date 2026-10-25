/**
 * What a Plaid sync brought in, in a sentence for its toast (launch item
 * i44). Browser-safe: no database or Plaid client here.
 */

export interface SyncedAccountSummary {
    name: string;
    positions: number;
    transactionsAdded: number;
    transactionsPending: boolean;
    holdingsSkipped: number;
    costUnknown: number;
}

function count(n: number, one: string, many = `${one}s`): string {
    return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** `overLimit`: picked accounts not added, the user having as many accounts as Atlas keeps. */
export function plaidSyncMessage(accounts: readonly SyncedAccountSummary[], overLimit: readonly string[] = []): string {
    const full = overLimit.length > 0
        ? `${overLimit.length === 1 ? overLimit[0] : count(overLimit.length, "account")} ${overLimit.length === 1 ? "wasn't" : "weren't"} added: you already have as many accounts as Atlas keeps. Delete one on Accounts to make room.`
        : null;
    if (accounts.length === 0) return full ?? "No investment accounts to sync on this connection.";
    const positions = accounts.reduce((sum, a) => sum + a.positions, 0);
    const added = accounts.reduce((sum, a) => sum + a.transactionsAdded, 0);
    const skipped = accounts.reduce((sum, a) => sum + a.holdingsSkipped, 0);
    const costUnknown = accounts.reduce((sum, a) => sum + a.costUnknown, 0);
    const who = accounts.length === 1 ? accounts[0].name : count(accounts.length, "account");
    const parts = [`${who}: ${count(positions, "position")} and ${count(added, "new transaction")}.`];
    if (accounts.some((a) => a.transactionsPending)) parts.push("Transactions follow once the institution has them ready.");
    if (skipped > 0) parts.push(`${count(skipped, "holding")} without a ticker, or in another currency, ${skipped === 1 ? "wasn't" : "weren't"} brought in.`);
    if (costUnknown > 0) parts.push(`${count(costUnknown, "position")} without a reported cost ${costUnknown === 1 ? "is" : "are"} held at ${costUnknown === 1 ? "its" : "their"} price.`);
    if (full) parts.push(full);
    return parts.join(" ");
}
