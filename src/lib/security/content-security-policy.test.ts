import { describe, test } from "node:test";
import assert from "node:assert";
import { buildContentSecurityPolicy } from "./content-security-policy";

describe("buildContentSecurityPolicy", () => {
    test("builds a production policy without dev-only eval or broad connect sources", () => {
        const policy = buildContentSecurityPolicy({ nodeEnv: "production" });

        assert.match(policy, /default-src 'self'/);
        assert.match(policy, /script-src 'self' https:\/\/cdn\.plaid\.com 'unsafe-inline'/);
        assert.doesNotMatch(policy, /'unsafe-eval'/);
        assert.match(policy, /connect-src 'self' https:\/\/cdn\.plaid\.com https:\/\/sandbox\.plaid\.com https:\/\/development\.plaid\.com https:\/\/production\.plaid\.com/);
        assert.ok(!sourcesFor(policy, "connect-src").includes("https:"));
        assert.ok(!sourcesFor(policy, "connect-src").includes("ws:"));
        assert.match(policy, /frame-src https:\/\/cdn\.plaid\.com/);
        assert.match(policy, /frame-ancestors 'none'/);
    });

    test("keeps development-only allowances out of the production policy", () => {
        const policy = buildContentSecurityPolicy({ nodeEnv: "development" });

        assert.match(policy, /script-src[^;]*'unsafe-eval'/);
        assert.match(policy, /connect-src[^;]*ws:/);
        assert.match(policy, /connect-src[^;]*http:\/\/localhost:\*/);
        assert.match(policy, /connect-src[^;]*http:\/\/127\.0\.0\.1:\*/);
    });
});

describe("buildContentSecurityPolicy — Sentry", () => {
    test("lets the browser reach the DSN's ingest host and nothing else of Sentry's", () => {
        const policy = buildContentSecurityPolicy({
            nodeEnv: "production",
            sentryDsn: "https://abc123@o4501234.ingest.us.sentry.io/4509876",
        });

        // The exact list: the ingest origin is added once, without the key or a wildcard.
        assert.deepEqual(sourcesFor(policy, "connect-src"), [
            "'self'",
            "https://cdn.plaid.com",
            "https://sandbox.plaid.com",
            "https://development.plaid.com",
            "https://production.plaid.com",
            "https://o4501234.ingest.us.sentry.io",
        ]);
    });

    test("adds nothing without a usable DSN", () => {
        for (const sentryDsn of [undefined, "", "[SENSITIVE]"]) {
            const policy = buildContentSecurityPolicy({ nodeEnv: "production", sentryDsn });
            assert.ok(!policy.includes("sentry"), `added for ${String(sentryDsn)}`);
        }
    });
});

function sourcesFor(policy: string, name: string): string[] {
    const directive = policy.split("; ").find((part) => part.startsWith(`${name} `));
    return directive?.split(" ").slice(1) ?? [];
}
