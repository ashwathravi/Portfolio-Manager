import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";

import type { PlaidFetch } from "./link";
import { PLAID_WEBHOOK_MAX_AGE_SECONDS, plaidWebhookKeyFetcher, resetPlaidWebhookKeysForTests, verifyPlaidWebhook, type PlaidWebhookKey } from "./webhook";

const NOW = Date.UTC(2026, 9, 26, 15, 0, 0);
const BODY = '{\n  "webhook_type": "HOLDINGS",\n  "webhook_code": "DEFAULT_UPDATE",\n  "item_id": "item-1"\n}';

function keyPair() {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const jwk = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string; y: string };
    return { privateKey, key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } satisfies PlaidWebhookKey };
}

const b64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

/** A Plaid-Verification JWT as Plaid makes one: ES256 over header.payload. */
function plaidJwt({
    privateKey,
    body = BODY,
    iat = NOW / 1000,
    header = { alg: "ES256", kid: "kid-1", typ: "JWT" },
}: {
    privateKey: ReturnType<typeof keyPair>["privateKey"];
    body?: string;
    iat?: number;
    header?: Record<string, unknown>;
}) {
    const encodedHeader = b64url(JSON.stringify(header));
    const encodedPayload = b64url(JSON.stringify({ iat, request_body_sha256: createHash("sha256").update(body).digest("hex") }));
    const signature = sign("sha256", Buffer.from(`${encodedHeader}.${encodedPayload}`), { key: privateKey, dsaEncoding: "ieee-p1363" });
    return `${encodedHeader}.${encodedPayload}.${b64url(signature)}`;
}

describe("verifyPlaidWebhook", () => {
    const signer = keyPair();
    const getKey = async (kid: string) => (kid === "kid-1" ? signer.key : null);

    test("a webhook Plaid signed over this exact body, just now, is verified", async () => {
        assert.deepEqual(await verifyPlaidWebhook({ jwt: plaidJwt(signer), body: BODY, getKey, now: NOW }), { ok: true });
    });

    test("refuses a webhook without a signature, or with one that isn't a JWT", async () => {
        assert.deepEqual(await verifyPlaidWebhook({ jwt: null, body: BODY, getKey, now: NOW }), { ok: false, reason: "missing" });
        assert.deepEqual(await verifyPlaidWebhook({ jwt: "a.b", body: BODY, getKey, now: NOW }), { ok: false, reason: "malformed" });
        assert.deepEqual(await verifyPlaidWebhook({ jwt: "%%%.%%%.%%%", body: BODY, getKey, now: NOW }), { ok: false, reason: "malformed" });
    });

    test("refuses another algorithm, an unknown or expired key, and a signature by another key", async () => {
        assert.deepEqual(await verifyPlaidWebhook({ jwt: plaidJwt({ ...signer, header: { alg: "HS256", kid: "kid-1" } }), body: BODY, getKey, now: NOW }), { ok: false, reason: "algorithm" });
        assert.deepEqual(await verifyPlaidWebhook({ jwt: plaidJwt({ ...signer, header: { alg: "ES256", kid: "kid-2" } }), body: BODY, getKey, now: NOW }), { ok: false, reason: "unknown-key" });
        const expired = async () => ({ ...signer.key, expired_at: NOW / 1000 - 1 });
        assert.deepEqual(await verifyPlaidWebhook({ jwt: plaidJwt(signer), body: BODY, getKey: expired, now: NOW }), { ok: false, reason: "unknown-key" });
        const impostor = keyPair();
        assert.deepEqual(await verifyPlaidWebhook({ jwt: plaidJwt(impostor), body: BODY, getKey, now: NOW }), { ok: false, reason: "signature" });
    });

    test("refuses a replay: issued more than five minutes ago, or ahead", async () => {
        const at = (seconds: number) => verifyPlaidWebhook({ jwt: plaidJwt({ ...signer, iat: NOW / 1000 + seconds }), body: BODY, getKey, now: NOW });
        assert.deepEqual(await at(-PLAID_WEBHOOK_MAX_AGE_SECONDS), { ok: true });
        assert.deepEqual(await at(-PLAID_WEBHOOK_MAX_AGE_SECONDS - 1), { ok: false, reason: "stale" });
        assert.deepEqual(await at(PLAID_WEBHOOK_MAX_AGE_SECONDS + 1), { ok: false, reason: "stale" });
    });

    test("refuses a body that isn't the one signed, down to its whitespace", async () => {
        assert.deepEqual(await verifyPlaidWebhook({ jwt: plaidJwt(signer), body: BODY.replace("DEFAULT_UPDATE", "ERROR"), getKey, now: NOW }), { ok: false, reason: "body" });
        assert.deepEqual(await verifyPlaidWebhook({ jwt: plaidJwt(signer), body: JSON.stringify(JSON.parse(BODY)), getKey, now: NOW }), { ok: false, reason: "body" });
    });
});

describe("plaidWebhookKeyFetcher", () => {
    const config = { credentials: { clientId: "client", secret: "secret" }, environment: "sandbox" as const };
    const reply = (json: unknown, status = 200): ReturnType<PlaidFetch> => Promise.resolve({ ok: status < 400, status, json: async () => json });

    test("asks Plaid for a key by its kid once, and again after a day", async () => {
        resetPlaidWebhookKeysForTests();
        let now = NOW;
        const asked: string[] = [];
        const fetchImpl: PlaidFetch = (url, init) => {
            assert.equal(url, "https://sandbox.plaid.com/webhook_verification_key/get");
            asked.push(JSON.parse(String(init.body)).key_id);
            return reply({ key: { kty: "EC", crv: "P-256", x: "x1", y: "y1", kid: "kid-1", expired_at: null, created_at: 1 }, request_id: "r" });
        };
        const getKey = plaidWebhookKeyFetcher({ ...config, fetchImpl, clock: () => now });
        assert.deepEqual(await getKey("kid-1"), { kty: "EC", crv: "P-256", x: "x1", y: "y1", expired_at: null });
        await getKey("kid-1");
        assert.deepEqual(asked, ["kid-1"]);
        now += 24 * 60 * 60 * 1000;
        await getKey("kid-1");
        assert.deepEqual(asked, ["kid-1", "kid-1"]);
    });

    test("regression: a kid Plaid doesn't know is remembered as unknown for a while, so forged webhooks don't each call Plaid", async () => {
        resetPlaidWebhookKeysForTests();
        let now = NOW;
        let calls = 0;
        const fetchImpl: PlaidFetch = () => {
            calls++;
            return reply({ error_type: "INVALID_INPUT", error_code: "INVALID_WEBHOOK_VERIFICATION_KEY_ID", error_message: "unknown" }, 400);
        };
        const getKey = plaidWebhookKeyFetcher({ ...config, fetchImpl, clock: () => now });
        assert.equal(await getKey("kid-x"), null);
        assert.equal(await getKey("kid-x"), null);
        assert.equal(calls, 1);
        now += 5 * 60 * 1000;
        assert.equal(await getKey("kid-x"), null);
        assert.equal(calls, 2);
    });

    test("Plaid unreachable is no key, and asked again next time", async () => {
        resetPlaidWebhookKeysForTests();
        let calls = 0;
        const fetchImpl: PlaidFetch = () => {
            calls++;
            return Promise.reject(new TypeError("fetch failed"));
        };
        const getKey = plaidWebhookKeyFetcher({ ...config, fetchImpl, clock: () => NOW });
        assert.equal(await getKey("kid-1"), null);
        assert.equal(await getKey("kid-1"), null);
        assert.equal(calls, 2);
    });
});
