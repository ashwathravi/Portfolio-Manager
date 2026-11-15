/**
 * Plaid Link's OAuth redirect (launch item i47). Banks that sign in through
 * OAuth (Chase, Schwab, …) open their own site. On a desktop browser Link
 * opens it in a pop-up and nothing here is used; where pop-ups don't work
 * (phones' in-app browsers, some mobile browsers) the bank sends the user
 * back to PLAID_REDIRECT_URI with `?oauth_state_id=…`, and that page has to
 * open Link again with the same link token and the address it came back to.
 *
 * The redirect page is Settings itself: the Connected accounts card notices
 * `oauth_state_id`, reads the Link session saved before Link opened, and
 * carries on (src/components/settings/cards/IntegrationsCard.tsx).
 */

import { readUserValue, removeUserValue, writeUserValue } from "@/lib/storage/user-scope";
import type { PlaidEnvironment, PlaidLinkTokenResponse } from "./types";

/** Where a bank sends the user back; PLAID_REDIRECT_URI must point here. */
export const PLAID_OAUTH_REDIRECT_PATH = "/settings";

/** The query parameter Plaid adds to the redirect URI. */
export const OAUTH_STATE_PARAM = "oauth_state_id";

/** localStorage, per user: the Link session waiting on a bank's redirect. */
export const PENDING_PLAID_LINK_KEY = "pm-plaid-link-pending";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * PLAID_REDIRECT_URI as Link is given it, or undefined when it isn't set
 * (OAuth banks then work only where Link can open a pop-up). Plaid compares
 * it with the Dashboard's allowed redirect URIs, so it's passed as written.
 * Throws when it can't work: Plaid wants https (http only for localhost in
 * Sandbox) and no query or fragment, and it must be the page that finishes
 * the connection.
 */
export function plaidRedirectUri(value: string | undefined, environment: PlaidEnvironment): string | undefined {
    const uri = value?.trim();
    if (!uri) return undefined;

    let url: URL;
    try {
        url = new URL(uri);
    } catch {
        throw new Error("PLAID_REDIRECT_URI must be an absolute URL");
    }
    const localHttp = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname) && environment === "sandbox";
    if (url.protocol !== "https:" && !localHttp) {
        throw new Error("PLAID_REDIRECT_URI must use https (http only for localhost in Sandbox)");
    }
    if (uri.includes("?") || uri.includes("#")) {
        throw new Error("PLAID_REDIRECT_URI can't have a query or a fragment");
    }
    if (url.pathname !== PLAID_OAUTH_REDIRECT_PATH) {
        throw new Error(`PLAID_REDIRECT_URI must end in ${PLAID_OAUTH_REDIRECT_PATH}, the page that finishes the connection`);
    }
    return uri;
}

/** The bank's `oauth_state_id`, when this page is its redirect back. */
export function oauthStateIdFrom(search: string): string | null {
    return new URLSearchParams(search).get(OAUTH_STATE_PARAM)?.trim() || null;
}

/** A Link session that may come back through a bank's redirect. */
export interface PendingPlaidLink {
    token: PlaidLinkTokenResponse;
    /** Update mode for this connection (sign in again); a new connection without it. */
    itemId?: string;
}

export type PendingPlaidLinkRead =
    | { status: "ready"; pending: PendingPlaidLink }
    | { status: "missing" }
    | { status: "expired" };

type ReadableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** False when it couldn't be stored: a redirect back then can't carry on. */
export function savePendingPlaidLink(storage: ReadableStorage | null | undefined, pending: PendingPlaidLink, scope?: string): boolean {
    return writeUserValue(storage, PENDING_PLAID_LINK_KEY, JSON.stringify(pending), scope);
}

/**
 * The saved Link session. "missing" when there's none (Link was started in
 * another browser, or already finished); "expired" when its link token has
 * run out, and then it's removed.
 */
export function readPendingPlaidLink(
    storage: ReadableStorage | null | undefined,
    now: Date = new Date(),
    scope?: string,
): PendingPlaidLinkRead {
    const pending = parsePending(readUserValue(storage, PENDING_PLAID_LINK_KEY, scope));
    if (!pending) return { status: "missing" };
    const expiresAt = Date.parse(pending.token.expiration);
    if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) {
        clearPendingPlaidLink(storage, scope);
        return { status: "expired" };
    }
    return { status: "ready", pending };
}

export function clearPendingPlaidLink(storage: ReadableStorage | null | undefined, scope?: string): void {
    removeUserValue(storage, PENDING_PLAID_LINK_KEY, scope);
}

function parsePending(raw: string | null): PendingPlaidLink | null {
    if (!raw) return null;
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!value || typeof value !== "object") return null;
    const { token, itemId } = value as { token?: Partial<PlaidLinkTokenResponse>; itemId?: unknown };
    if (!token || typeof token.linkToken !== "string" || !token.linkToken || typeof token.expiration !== "string") return null;
    return {
        token: {
            linkToken: token.linkToken,
            expiration: token.expiration,
            requestId: typeof token.requestId === "string" ? token.requestId : "",
            environment: token.environment === "production" ? "production" : "sandbox",
            products: Array.isArray(token.products) ? token.products.filter((p): p is string => typeof p === "string") : [],
        },
        ...(typeof itemId === "string" && itemId ? { itemId } : {}),
    };
}
