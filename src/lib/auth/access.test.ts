import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isGoogleProfileAllowed } from "./access";

describe("Google auth access policy", () => {
    test("allows verified Google profiles when no allowlist is configured", () => {
        assert.equal(
            isGoogleProfileAllowed({
                email: "ashwath@example.com",
                email_verified: true,
            }, {}),
            true,
        );
    });

    test("rejects unverified or missing emails", () => {
        assert.equal(
            isGoogleProfileAllowed({
                email: "ashwath@example.com",
                email_verified: false,
            }, {}),
            false,
        );
        assert.equal(isGoogleProfileAllowed({ email_verified: true }, {}), false);
    });

    test("enforces explicit email allowlists", () => {
        assert.equal(
            isGoogleProfileAllowed({
                email: "ashwath@example.com",
                email_verified: true,
            }, {
                allowedEmails: "ashwath@example.com, teammate@example.com",
            }),
            true,
        );
        assert.equal(
            isGoogleProfileAllowed({
                email: "other@example.com",
                email_verified: true,
            }, {
                allowedEmails: "ashwath@example.com",
            }),
            false,
        );
    });

    test("uses Google's hosted-domain claim for Workspace domain allowlists", () => {
        assert.equal(
            isGoogleProfileAllowed({
                email: "person@example.com",
                email_verified: true,
                hd: "example.com",
            }, {
                allowedDomains: "example.com",
            }),
            true,
        );
        assert.equal(
            isGoogleProfileAllowed({
                email: "person@example.com",
                email_verified: true,
            }, {
                allowedDomains: "example.com",
            }),
            false,
        );
    });
});
