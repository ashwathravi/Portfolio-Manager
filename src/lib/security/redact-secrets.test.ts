import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SECRET_SETTINGS, redactSecrets } from "./redact-secrets";

const SRC = join(__dirname, "..", "..");

/** Every source file under src, tests left out. */
function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
}

/** The environment variables the app reads: `process.env.X`, `env.X`, `env["X"]` and `readOptionalEnv("X")`. */
function settingsRead(): Set<string> {
    const names = new Set<string>();
    for (const file of sourceFiles(SRC)) {
        for (const match of readFileSync(file, "utf8").matchAll(/(?:\benv\.|\benv\[\s*["']|Env\(\s*["'])([A-Z][A-Z0-9_]*)/g)) {
            names.add(match[1]);
        }
    }
    return names;
}

describe("SECRET_SETTINGS", () => {
    test("covers every key, secret, token and database URL the app reads", () => {
        const read = settingsRead();
        // The scan finds the settings it should: this one is read as process.env.POLYGON_API_KEY.
        assert.ok(read.has("POLYGON_API_KEY"));
        const secrets = [...read].filter((name) => /(?:_KEY|_SECRET|_TOKEN|^DATABASE(?:_MIGRATION)?_URL)$/.test(name));
        const masked = new Set<string>(SECRET_SETTINGS);
        assert.deepEqual(secrets.filter((name) => !masked.has(name)).sort(), [], "secret settings that would reach a log or Sentry unmasked");
    });

    test("covers the AI Gateway credentials, which the AI SDK reads rather than the app, and the keys added for email, quotes and Schwab", () => {
        for (const name of ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "RESEND_API_KEY", "FINNHUB_API_KEY", "SCHWAB_CLIENT_SECRET", "SCHWAB_ACCESS_TOKEN"]) {
            assert.ok((SECRET_SETTINGS as readonly string[]).includes(name), name);
            assert.equal(redactSecrets(`failed with ${name.toLowerCase()}-value-1234`, { [name]: `${name.toLowerCase()}-value-1234` }), "failed with ***");
        }
    });
});

describe("redactSecrets", () => {
    test("masks the value of every secret setting", () => {
        const env = Object.fromEntries(SECRET_SETTINGS.map((setting) => [setting, `${setting.toLowerCase()}-value`]));
        const text = SECRET_SETTINGS.map((setting) => `${setting}=${env[setting]}`).join(" ");

        const redacted = redactSecrets(text, env);

        for (const setting of SECRET_SETTINGS) {
            assert.ok(!redacted.includes(env[setting]), `${setting} leaked`);
            assert.ok(redacted.includes(`${setting}=***`));
        }
    });

    test("masks the Sentry auth token", () => {
        assert.equal(
            redactSecrets("upload failed for sntrys_abcdefgh12345678", { SENTRY_AUTH_TOKEN: "sntrys_abcdefgh12345678" }),
            "upload failed for ***",
        );
    });

    test("masks URL credentials and apiKey parameters without any settings", () => {
        assert.equal(
            redactSecrets("connect postgres://atlas_app:hunter22@db.example.com:6543/postgres failed", {}),
            "connect postgres://***@db.example.com:6543/postgres failed",
        );
        assert.equal(
            redactSecrets("GET https://api.polygon.io/v2/aggs?api_key=abc123&x=1", {}),
            "GET https://api.polygon.io/v2/aggs?api_key=***&x=1",
        );
    });

    test("ignores short and blank values so ordinary words survive", () => {
        assert.equal(redactSecrets("the test failed", { CRON_SECRET: "test", AUTH_SECRET: "   " }), "the test failed");
    });

    test("keeps every line", () => {
        assert.equal(redactSecrets("one\ntwo", {}), "one\ntwo");
    });
});
