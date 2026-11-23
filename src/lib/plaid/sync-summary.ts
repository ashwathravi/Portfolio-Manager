/**
 * What a Plaid sync brought in, in a sentence for its toast (launch item
 * i44): the positions, option positions and transactions, and each reason
 * a holding wasn't brought in. Browser-safe: no database or Plaid client
 * here (the types below are only types).
 */

import type { HoldingSkipReason, TransactionSkipReason } from "./investments";

export interface SyncedAccountSummary {
    name: string;
    positions: number;
    /**
     * Option positions from the account's contracts (launch item i63), and
     * holdings with no ticker at the institution's value. Absent from a
     * server before these were counted, as the reasons below are.
     */
    options?: number;
    valued?: number;
    transactionsAdded: number;
    transactionsPending: boolean;
    holdingsSkipped: number;
    /** holdingsSkipped by reason. */
    skipped?: Partial<Record<HoldingSkipReason, number>>;
    costUnknown: number;
    /** Transactions not recorded, by reason. */
    transactionsSkippedBy?: Partial<Record<TransactionSkipReason, number>>;
}

/** Each account in POST /api/plaid/sync's answer. */
export interface PlaidSyncAccountResponse extends SyncedAccountSummary {
    portfolioId: string;
    created: boolean;
    cashUsd: number;
    transactionsUpdated: number;
    /** All the transactions not recorded, for a page loaded before transactionsSkippedBy. */
    transactionsSkipped: number;
}

function count(n: number, one: string, many = `${one}s`): string {
    return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

function wasnt(n: number): string {
    return n === 1 ? "wasn't" : "weren't";
}

/** "a", "a and b", "a, b and c": the app's lists, with no comma before "and". */
function list(items: readonly string[]): string {
    return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Why holdings weren't brought in, in the order the toast gives them. */
const SKIP_SENTENCES: ReadonlyArray<readonly [HoldingSkipReason, (n: number) => string]> = [
    ["option", (n) => `${count(n, "option or warrant", "options or warrants")} without clear contract details ${wasnt(n)} brought in.`],
    ["no-ticker", (n) => `${count(n, "holding")} with no ticker and no value ${wasnt(n)} brought in.`],
    ["other-currency", (n) => `${n === 1 ? "1 holding in another currency" : `${count(n, "holding")} in other currencies`} ${wasnt(n)} brought in.`],
    ["short", (n) => `${count(n, "short position")} ${wasnt(n)} brought in.`],
];

/** `overLimit`: picked accounts not added, the user having as many accounts as Atlas keeps. */
export function plaidSyncMessage(accounts: readonly SyncedAccountSummary[], overLimit: readonly string[] = []): string {
    const full = overLimit.length > 0
        ? `${overLimit.length === 1 ? overLimit[0] : count(overLimit.length, "account")} ${overLimit.length === 1 ? "wasn't" : "weren't"} added: you already have as many accounts as Atlas keeps. Delete one on Accounts to make room.`
        : null;
    if (accounts.length === 0) return full ?? "No investment accounts to sync on this connection.";
    const sum = (of: (a: SyncedAccountSummary) => number | undefined) => accounts.reduce((total, a) => total + (of(a) ?? 0), 0);
    const positions = sum((a) => a.positions);
    const options = sum((a) => a.options);
    const valued = sum((a) => a.valued);
    const added = sum((a) => a.transactionsAdded);
    const costUnknown = sum((a) => a.costUnknown);
    const who = accounts.length === 1 ? accounts[0].name : count(accounts.length, "account");
    const brought = [
        count(positions, "position"),
        ...(options > 0 ? [count(options, "option position")] : []),
        ...(valued > 0 ? [`${count(valued, "holding")} valued by the institution`] : []),
        count(added, "new transaction"),
    ];
    const parts = [`${who}: ${list(brought)}.`];
    if (accounts.some((a) => a.transactionsPending)) parts.push("Transactions follow once the institution has them ready.");

    let reasons = 0;
    for (const [reason, sentence] of SKIP_SENTENCES) {
        const n = sum((a) => a.skipped?.[reason]);
        if (n > 0) {
            parts.push(sentence(n));
            reasons++;
        }
    }
    // What a server before the reasons counted, or a reason this page doesn't know.
    const rest = sum((a) => Math.max(0, a.holdingsSkipped - SKIP_SENTENCES.reduce((known, [reason]) => known + (a.skipped?.[reason] ?? 0), 0)));
    if (rest > 0) parts.push(`${count(rest, reasons > 0 ? "other holding" : "holding")} ${wasnt(rest)} brought in.`);

    if (costUnknown > 0) parts.push(`${count(costUnknown, "position")} without a reported cost ${costUnknown === 1 ? "is" : "are"} held at ${costUnknown === 1 ? "its" : "their"} price.`);
    const otherCurrency = sum((a) => a.transactionsSkippedBy?.["other-currency"]);
    if (otherCurrency > 0) {
        parts.push(`${otherCurrency === 1 ? "1 transaction in another currency" : `${count(otherCurrency, "transaction")} in other currencies`} ${wasnt(otherCurrency)} recorded.`);
    }
    if (full) parts.push(full);
    return parts.join(" ");
}
