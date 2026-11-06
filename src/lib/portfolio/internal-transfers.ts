/**
 * Transfers between the user's own accounts (launch item i80).
 *
 * Money moved from one of the user's accounts to another shows up twice: a
 * withdrawal in one and a deposit in the other. Across the accounts together
 * it is neither money added nor money taken out. A withdrawal and a deposit
 * in different accounts, of the same amount in the same currency, at most
 * TRANSFER_WINDOW_DAYS apart, are taken as one transfer.
 *
 * It works the same for linked, imported and hand-entered accounts, and is
 * worked out whenever transactions are read: nothing is stored, so deleting
 * either side simply ends the pairing. Money that went out of one account
 * to the bank and into another from it is a transfer here too, which is
 * what it is for the accounts together.
 */

/** Bank transfers settle in a few business days, a weekend included. */
export const TRANSFER_WINDOW_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A transaction as matching needs it. */
export interface TransferLeg {
    id: string;
    /** DEPOSIT or WITHDRAWAL; anything else is never a transfer. */
    side: string;
    /** Identifies the account: two accounts can share a name. */
    accountId: string;
    account: string;
    /** Absolute amount. */
    value: number;
    currency: string;
    /** ISO timestamp. */
    date: string;
}

/** One side of a transfer between two of the user's accounts. */
export interface InternalTransfer {
    /** "out" for the withdrawal, "in" for the deposit. */
    direction: "in" | "out";
    /** The other side's transaction. */
    otherId: string;
    otherAccountId: string;
    otherAccount: string;
}

function cents(value: number): number {
    return Math.round(value * 100);
}

function byDateThenId(a: TransferLeg, b: TransferLeg): number {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The transfers among `legs`, keyed by transaction ID, both sides of each.
 * Withdrawals pair oldest first, each with the closest deposit in time
 * (the older one when two are as close); every transaction is in at most
 * one transfer.
 */
export function matchInternalTransfers(legs: readonly TransferLeg[]): Map<string, InternalTransfer> {
    const deposits = new Map<string, TransferLeg[]>();
    for (const leg of legs) {
        if (leg.side !== "DEPOSIT" || !(leg.value > 0)) continue;
        const key = `${leg.currency}|${cents(leg.value)}`;
        const group = deposits.get(key);
        if (group) group.push(leg);
        else deposits.set(key, [leg]);
    }
    for (const group of deposits.values()) group.sort(byDateThenId);

    const withdrawals = legs.filter((leg) => leg.side === "WITHDRAWAL" && leg.value > 0).sort(byDateThenId);
    const matches = new Map<string, InternalTransfer>();
    for (const out of withdrawals) {
        const outAt = Date.parse(out.date);
        let best: TransferLeg | null = null;
        let bestGap = Infinity;
        for (const into of deposits.get(`${out.currency}|${cents(out.value)}`) ?? []) {
            if (into.accountId === out.accountId || matches.has(into.id)) continue;
            const gap = Math.abs(Date.parse(into.date) - outAt);
            // Deposits are oldest first, so on a tie the older one stays.
            if (gap <= TRANSFER_WINDOW_DAYS * DAY_MS && gap < bestGap) {
                best = into;
                bestGap = gap;
            }
        }
        if (!best) continue;
        matches.set(out.id, { direction: "out", otherId: best.id, otherAccountId: best.accountId, otherAccount: best.account });
        matches.set(best.id, { direction: "in", otherId: out.id, otherAccountId: out.accountId, otherAccount: out.account });
    }
    return matches;
}
