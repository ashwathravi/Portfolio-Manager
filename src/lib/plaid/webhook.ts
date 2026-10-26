/**
 * Plaid webhooks (launch item i45): checking that one came from Plaid.
 *
 * Plaid signs each webhook with a JWT in the Plaid-Verification header:
 * ES256, the key named by its `kid` (fetched from
 * /webhook_verification_key/get and kept by kid), an `iat` at most five
 * minutes old, and the SHA-256 of the raw body as `request_body_sha256`.
 * Anything else is refused before the body is acted on.
 */

import { createHash, createPublicKey, timingSafeEqual, verify } from "node:crypto";

import { PlaidApiError, asRecord, postPlaid, type PlaidCredentials, type PlaidFetch } from "./link";
import type { PlaidEnvironment } from "./types";

/** Plaid's limit on a webhook's age, against replays. */
export const PLAID_WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

export interface PlaidWebhookKey {
    kty: string;
    crv: string;
    x: string;
    y: string;
    /** Unix seconds; a key past it isn't used. */
    expired_at?: number | null;
}

export type PlaidWebhookVerification =
    | { ok: true }
    | { ok: false; reason: "missing" | "malformed" | "algorithm" | "unknown-key" | "signature" | "stale" | "body" };

function base64url(part: string): Buffer {
    return Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function json(part: string): Record<string, unknown> | null {
    try {
        return asRecord(JSON.parse(base64url(part).toString("utf8")));
    } catch {
        return null;
    }
}

/**
 * Whether `jwt` (the Plaid-Verification header) signs `body`, the raw
 * request body as received: whitespace counts, so it's hashed unparsed.
 */
export async function verifyPlaidWebhook({
    jwt,
    body,
    getKey,
    now = Date.now(),
}: {
    jwt: string | null;
    body: string;
    getKey: (kid: string) => Promise<PlaidWebhookKey | null>;
    now?: number;
}): Promise<PlaidWebhookVerification> {
    if (!jwt) return { ok: false, reason: "missing" };
    const parts = jwt.split(".");
    if (parts.length !== 3) return { ok: false, reason: "malformed" };
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = json(encodedHeader);
    const payload = json(encodedPayload);
    if (!header || !payload) return { ok: false, reason: "malformed" };
    if (header.alg !== "ES256") return { ok: false, reason: "algorithm" };
    if (typeof header.kid !== "string" || !header.kid) return { ok: false, reason: "malformed" };

    const key = await getKey(header.kid);
    if (!key || (key.expired_at != null && key.expired_at * 1000 <= now)) return { ok: false, reason: "unknown-key" };

    let signed: boolean;
    try {
        const publicKey = createPublicKey({ key: { kty: key.kty, crv: key.crv, x: key.x, y: key.y }, format: "jwk" });
        signed = verify(
            "sha256",
            Buffer.from(`${encodedHeader}.${encodedPayload}`),
            { key: publicKey, dsaEncoding: "ieee-p1363" },
            base64url(encodedSignature),
        );
    } catch {
        signed = false;
    }
    if (!signed) return { ok: false, reason: "signature" };

    const issuedAt = typeof payload.iat === "number" ? payload.iat : NaN;
    if (!Number.isFinite(issuedAt) || Math.abs(now / 1000 - issuedAt) > PLAID_WEBHOOK_MAX_AGE_SECONDS) {
        return { ok: false, reason: "stale" };
    }

    const expected = typeof payload.request_body_sha256 === "string" ? payload.request_body_sha256 : "";
    const actual = createHash("sha256").update(body, "utf8").digest("hex");
    if (expected.length !== actual.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) {
        return { ok: false, reason: "body" };
    }
    return { ok: true };
}

/** Keys don't change for a kid; refetched daily to catch one Plaid expires. */
const KEY_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * A kid Plaid says it doesn't know is remembered as unknown this long, so
 * forged webhooks can't make each request a call to Plaid. (A new key is
 * at worst refused for this long; Plaid retries a refused webhook.)
 */
const UNKNOWN_KEY_TTL_MS = 5 * 60 * 1000;
/**
 * At most this many kids kept: forged webhooks name kids of their choosing,
 * so the cache can't be left to grow with them. Plaid uses a handful.
 */
const MAX_CACHED_KEYS = 256;
const keyCache = new Map<string, { key: PlaidWebhookKey | null; fetchedAt: number }>();

/** Drops expired entries, then the oldest (unknown kids before real keys) past the cap. */
function remember(kid: string, key: PlaidWebhookKey | null, now: number): void {
    for (const [cached, entry] of keyCache) {
        if (now - entry.fetchedAt >= (entry.key ? KEY_TTL_MS : UNKNOWN_KEY_TTL_MS)) keyCache.delete(cached);
    }
    keyCache.delete(kid);
    keyCache.set(kid, { key, fetchedAt: now });
    for (const [cached, entry] of keyCache) {
        if (keyCache.size <= MAX_CACHED_KEYS) break;
        if (!entry.key) keyCache.delete(cached);
    }
    for (const cached of keyCache.keys()) {
        if (keyCache.size <= MAX_CACHED_KEYS) break;
        keyCache.delete(cached);
    }
}

/** Plaid's key for `kid`, kept by kid; null when Plaid doesn't know it. */
export function plaidWebhookKeyFetcher({
    credentials,
    environment,
    fetchImpl = fetch,
    clock = Date.now,
}: {
    credentials: PlaidCredentials;
    environment: PlaidEnvironment;
    fetchImpl?: PlaidFetch;
    clock?: () => number;
}) {
    return async (kid: string): Promise<PlaidWebhookKey | null> => {
        const cached = keyCache.get(kid);
        if (cached && clock() - cached.fetchedAt < (cached.key ? KEY_TTL_MS : UNKNOWN_KEY_TTL_MS)) return cached.key;
        let key: PlaidWebhookKey | null = null;
        try {
            const response = asRecord(await postPlaid({
                endpoint: "/webhook_verification_key/get",
                environment,
                credentials,
                fetchImpl,
                body: { key_id: kid },
            }));
            const candidate = asRecord(response.key);
            if (typeof candidate.x === "string" && typeof candidate.y === "string" && typeof candidate.kty === "string" && typeof candidate.crv === "string") {
                key = {
                    kty: candidate.kty,
                    crv: candidate.crv,
                    x: candidate.x,
                    y: candidate.y,
                    expired_at: typeof candidate.expired_at === "number" ? candidate.expired_at : null,
                };
            }
        } catch (error) {
            // Plaid unreachable: not verified, and asked again next time.
            if (!(error instanceof PlaidApiError)) return null;
            // Plaid answered that it has no such key: remembered as unknown below.
        }
        remember(kid, key, clock());
        return key;
    };
}

export function resetPlaidWebhookKeysForTests(): void {
    keyCache.clear();
}

export function plaidWebhookKeysCachedForTests(): number {
    return keyCache.size;
}
