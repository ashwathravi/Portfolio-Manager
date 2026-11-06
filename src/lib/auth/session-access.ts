/**
 * Whether a signed-in user may still come in, on every session read
 * (src/auth.ts). The invite list and the block list are checked against the
 * user's email; a blocked Google Workspace domain is checked against the
 * Workspace the user signed in with too (launch item i77), since a
 * Workspace user's email can be in another of its domains, an alias. At
 * sign-in that's Google's `hd` claim; here it's the same claim in the ID
 * token Auth.js stored when the Google account was first linked, read only
 * while AUTH_BLOCKED_DOMAINS names a domain.
 */

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { authAccounts } from "@/db/schema";
import { currentAccessPolicy, hasBlockedDomains, isBlockedDomain, isSessionEmailAllowed, type GoogleAccessPolicy } from "@/lib/auth/access";

/** The `hd` claim of a Google ID token, or "" (none, or not a token). */
export function hostedDomainFromIdToken(idToken: string | null | undefined): string {
    const payload = idToken?.split(".")[1];
    if (!payload) return "";
    try {
        const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        const hd = claims && typeof claims === "object" ? (claims as { hd?: unknown }).hd : undefined;
        return typeof hd === "string" ? hd.trim().toLowerCase() : "";
    } catch {
        return "";
    }
}

/** The Google Workspace domains the user's Google sign-ins belong to. */
export async function googleWorkspaceDomains(userId: string, database: Pick<typeof db, "select"> = db): Promise<string[]> {
    const rows = await database
        .select({ idToken: authAccounts.id_token })
        .from(authAccounts)
        .where(and(eq(authAccounts.userId, userId), eq(authAccounts.provider, "google")));
    return rows.map((row) => hostedDomainFromIdToken(row.idToken)).filter(Boolean);
}

export async function isSessionUserAllowed(
    user: { id?: string; email?: string | null } | undefined,
    {
        policy = currentAccessPolicy(),
        workspaceDomains = googleWorkspaceDomains,
    }: { policy?: GoogleAccessPolicy; workspaceDomains?: (userId: string) => Promise<string[]> } = {},
): Promise<boolean> {
    if (!isSessionEmailAllowed(user?.email, policy)) return false;
    if (!user?.id || !hasBlockedDomains(policy)) return true;
    try {
        return !(await workspaceDomains(user.id)).some((domain) => isBlockedDomain(domain, policy));
    } catch (error) {
        // The email was checked; a failed read doesn't sign everyone out.
        console.warn("Session check: couldn't read the user's Google Workspace.", error instanceof Error ? error.name : "error");
        return true;
    }
}
