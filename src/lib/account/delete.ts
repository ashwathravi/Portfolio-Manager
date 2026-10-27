/**
 * Deleting an account (launch item i65): everything Atlas holds for the
 * user, and Atlas's access to their institutions through Plaid.
 *
 * Linked connections are ended at Plaid first (/item/remove, as Disconnect
 * does): deleting the account with one still open would leave Atlas's
 * access at the institution with no token left to end it. If any can't be
 * ended, nothing is deleted and the institutions are named, to try again
 * (or to disconnect them first). Then, in one transaction, the user's
 * accounts (their holdings, transactions and valuation history cascade)
 * and the user row, which takes everything else that cascades from it:
 * sign-in records and sessions, settings, watchlist, journal, theses and
 * Plaid connections. Alpha Radar's tracked filers are shared by every
 * account during the beta, not the user's, so they stay.
 */

import { and, eq, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { authUsers, authVerificationTokens, plaidItems, portfolios } from "@/db/schema";
import { disconnectPlaidItem } from "@/lib/plaid/connections";
import type { PlaidFetch } from "@/lib/plaid/link";
import type { PlaidConfig } from "@/lib/plaid/sync";
import { buildLockUserAccountsQuery } from "@/lib/portfolio/manage";

type Database = typeof db;

/** Connections that couldn't be ended at Plaid; nothing was deleted. */
export class AccountDeletionBlockedError extends Error {
    constructor(readonly institutions: string[]) {
        super(`Couldn't end the connection to ${institutions.join(", ")} at Plaid`);
        this.name = "AccountDeletionBlockedError";
    }
}

export interface AccountDeletion {
    /** The user's accounts deleted (with their holdings, transactions and history). */
    accounts: number;
    /** Linked connections ended at Plaid. */
    connections: number;
}

export async function deleteAccount(
    userId: string,
    {
        plaid,
        database = db,
        fetchImpl,
        getAccessToken,
        now = new Date(),
    }: {
        /** Plaid's keys; null where Plaid isn't set up (then any open connection blocks deletion). */
        plaid: PlaidConfig | null;
        database?: Database;
        fetchImpl?: PlaidFetch;
        getAccessToken?: (itemId: string, userId: string) => Promise<string | undefined>;
        now?: Date;
    },
): Promise<AccountDeletion> {
    const open = await database
        .select({ itemId: plaidItems.plaidItemId, institutionName: plaidItems.institutionName })
        .from(plaidItems)
        .where(and(eq(plaidItems.userId, userId), ne(plaidItems.status, "revoked"), isNull(plaidItems.revokedAt)));

    const blocked: string[] = [];
    for (const connection of open) {
        try {
            if (!plaid) throw new Error("Plaid isn't set up here");
            await disconnectPlaidItem(userId, connection.itemId, { config: plaid, database, fetchImpl, getAccessToken, now });
        } catch {
            blocked.push(connection.institutionName ?? "a linked institution");
        }
    }
    if (blocked.length > 0) throw new AccountDeletionBlockedError(blocked);

    return database.transaction(async (tx) => {
        // After any sync, pick or account deletion in flight. Locking the
        // user row makes anything added for them meanwhile (an account, a
        // connection) wait, then fail once they're gone, instead of slipping
        // in between the statements below; locking their connections does
        // the same for one linked again.
        await buildLockUserAccountsQuery(userId, tx);
        const [user] = await tx.select({ email: authUsers.email }).from(authUsers).where(eq(authUsers.id, userId)).for("update");
        const connections = await tx
            .select({ institutionName: plaidItems.institutionName, status: plaidItems.status, revokedAt: plaidItems.revokedAt })
            .from(plaidItems)
            .where(eq(plaidItems.userId, userId))
            .for("update");
        // Linked while the others were being ended: its token would go with
        // the user row, leaving Atlas's access open. Trying again ends it.
        const linkedSince = connections.filter((c) => c.status !== "revoked" && c.revokedAt === null);
        if (linkedSince.length > 0) {
            throw new AccountDeletionBlockedError(linkedSince.map((c) => c.institutionName ?? "a linked institution"));
        }
        // portfolios.user_id is RESTRICT: the accounts go first, taking their
        // holdings, transactions and valuation history with them.
        const accounts = await tx.delete(portfolios).where(eq(portfolios.userId, userId)).returning({ id: portfolios.id });
        if (user?.email) await tx.delete(authVerificationTokens).where(eq(authVerificationTokens.identifier, user.email));
        await tx.delete(authUsers).where(eq(authUsers.id, userId));
        return { accounts: accounts.length, connections: open.length };
    });
}
