import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { SECRET_SETTINGS, redactSecrets } from "./redact-secrets";

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
