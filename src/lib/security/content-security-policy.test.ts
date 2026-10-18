import { describe, test } from "node:test";
import assert from "node:assert";
import { buildContentSecurityPolicy, createNonce } from "./content-security-policy";

const NONCE = "bm9uY2UtZm9yLXRlc3Rz";

function production(overrides: Partial<Parameters<typeof buildContentSecurityPolicy>[0]> = {}) {
    return buildContentSecurityPolicy({ nonce: NONCE, nodeEnv: "production", sentryDsn: undefined, plaidEnv: undefined, ...overrides });
}

describe("buildContentSecurityPolicy", () => {
    test("runs only scripts carrying this request's nonce, and what they load", () => {
        const policy = production();

        assert.deepEqual(sourcesFor(policy, "script-src"), ["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
        assert.match(policy, /default-src 'self'/);
        assert.match(policy, /frame-src https:\/\/cdn\.plaid\.com/);
        assert.match(policy, /object-src 'none'/);
        assert.match(policy, /frame-ancestors 'none'/);
    });

    test("regression: no inline or eval'd script runs in production", () => {
        const scripts = sourcesFor(production(), "script-src");

        assert.ok(!scripts.includes("'unsafe-inline'"));
        assert.ok(!scripts.includes("'unsafe-eval'"));
    });

    test("keeps inline styles, which React style attributes need", () => {
        assert.deepEqual(sourcesFor(production(), "style-src"), ["'self'", "'unsafe-inline'"]);
    });

    test("loads images and fonts only from the app (and data: or blob: URLs)", () => {
        const policy = production();

        assert.deepEqual(sourcesFor(policy, "img-src"), ["'self'", "blob:", "data:"]);
        assert.deepEqual(sourcesFor(policy, "font-src"), ["'self'", "data:"]);
    });

    test("allows the Plaid API host of the configured environment only", () => {
        assert.deepEqual(sourcesFor(production({ plaidEnv: "sandbox" }), "connect-src"), [
            "'self'",
            "https://cdn.plaid.com",
            "https://sandbox.plaid.com",
        ]);
        assert.deepEqual(sourcesFor(production({ plaidEnv: "production" }), "connect-src"), [
            "'self'",
            "https://cdn.plaid.com",
            "https://production.plaid.com",
        ]);
        // Unset or unknown (including the retired "development") means sandbox.
        for (const plaidEnv of [undefined, "", "development"]) {
            assert.ok(sourcesFor(production({ plaidEnv }), "connect-src").includes("https://sandbox.plaid.com"));
        }
    });

    test("adds development-only allowances outside production", () => {
        const policy = buildContentSecurityPolicy({ nonce: NONCE, nodeEnv: "development" });

        assert.ok(sourcesFor(policy, "script-src").includes("'unsafe-eval'"));
        assert.ok(sourcesFor(policy, "script-src").includes(`'nonce-${NONCE}'`));
        assert.ok(!sourcesFor(policy, "script-src").includes("'unsafe-inline'"));
        assert.ok(sourcesFor(policy, "connect-src").includes("ws:"));
        assert.ok(sourcesFor(policy, "connect-src").includes("http://localhost:*"));
        assert.ok(sourcesFor(policy, "connect-src").includes("http://127.0.0.1:*"));
    });
});

describe("buildContentSecurityPolicy — Sentry", () => {
    test("lets the browser reach the DSN's ingest host and nothing else of Sentry's", () => {
        const policy = production({
            plaidEnv: "production",
            sentryDsn: "https://abc123@o4501234.ingest.us.sentry.io/4509876",
        });

        // The exact list: the ingest origin is added once, without the key or a wildcard.
        assert.deepEqual(sourcesFor(policy, "connect-src"), [
            "'self'",
            "https://cdn.plaid.com",
            "https://production.plaid.com",
            "https://o4501234.ingest.us.sentry.io",
        ]);
    });

    test("adds nothing without a usable DSN", () => {
        for (const sentryDsn of [undefined, "", "[SENSITIVE]"]) {
            const policy = production({ sentryDsn });
            assert.ok(!policy.includes("sentry"), `added for ${String(sentryDsn)}`);
        }
    });
});

describe("createNonce", () => {
    test("is 128 random bits in base64, different every time", () => {
        const nonces = new Set(Array.from({ length: 100 }, () => createNonce()));

        assert.equal(nonces.size, 100);
        for (const nonce of nonces) {
            assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
            assert.equal(Buffer.from(nonce, "base64").length, 16);
        }
    });
});

function sourcesFor(policy: string, name: string): string[] {
    const directive = policy.split("; ").find((part) => part.startsWith(`${name} `));
    return directive?.split(" ").slice(1) ?? [];
}
