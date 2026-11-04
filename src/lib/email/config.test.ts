import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { emailSetup, isEmailConfigured } from "./config";

const KEYS = { RESEND_API_KEY: " re_test_key ", EMAIL_FROM: "Atlas Wealth <alerts@mail.example.test>" };

describe("emailSetup (launch item i58)", () => {
    test("needs Resend's key and a sender, and names what's missing", () => {
        assert.deepEqual(emailSetup({}), { ok: false, reason: "Email is not configured: RESEND_API_KEY and EMAIL_FROM are not set." });
        assert.deepEqual(emailSetup({ RESEND_API_KEY: "re_1", EMAIL_FROM: " ", APP_URL: "https://atlas.example.test" }), {
            ok: false,
            reason: "Email is not configured: EMAIL_FROM is not set.",
        });
        assert.equal(isEmailConfigured({ ...KEYS }), false, "no address for the links");
    });

    test("links use APP_URL, then AUTH_URL, then Vercel's production domain, as an origin", () => {
        const origin = (env: Record<string, string>) => {
            const setup = emailSetup({ ...KEYS, ...env });
            return setup.ok ? setup.config.siteUrl : setup.reason;
        };
        assert.equal(origin({ APP_URL: "https://atlas.example.test/settings/", AUTH_URL: "https://auth.example.test" }), "https://atlas.example.test");
        assert.equal(origin({ AUTH_URL: "http://localhost:3000" }), "http://localhost:3000");
        assert.equal(origin({ VERCEL_PROJECT_PRODUCTION_URL: "atlas-wealth.vercel.app" }), "https://atlas-wealth.vercel.app");
        assert.equal(origin({ APP_URL: "not a url", VERCEL_PROJECT_PRODUCTION_URL: "atlas.example.test" }), "https://atlas.example.test");
        assert.equal(origin({ APP_URL: "javascript:alert(1)" }), "Email is not configured: set APP_URL to the site's address for the links.");
    });

    test("the key and sender are trimmed", () => {
        const setup = emailSetup({ ...KEYS, APP_URL: "https://atlas.example.test" });
        assert.deepEqual(setup, {
            ok: true,
            config: { apiKey: "re_test_key", from: "Atlas Wealth <alerts@mail.example.test>", siteUrl: "https://atlas.example.test" },
        });
    });
});
