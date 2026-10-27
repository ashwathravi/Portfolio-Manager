import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { legalBackLink } from "./links";

describe("legalBackLink", () => {
    test("sends someone signed out back to sign in, keeping the page they asked for", () => {
        assert.deepEqual(legalBackLink(undefined, false), { href: "/login", label: "Back to sign in" });
        assert.deepEqual(legalBackLink("/execution?symbol=IBM", false), {
            href: "/login?callbackUrl=%2Fexecution%3Fsymbol%3DIBM",
            label: "Back to sign in",
        });
    });

    test("sends someone signed in back to the page they opened it from", () => {
        assert.deepEqual(legalBackLink("/execution", true), { href: "/execution", label: "Back to Atlas Wealth" });
        assert.deepEqual(legalBackLink(undefined, true), { href: "/", label: "Back to Atlas Wealth" });
    });

    test("never sends anyone off the site", () => {
        for (const callback of ["//evil.test", "/\t/evil.test", "/..//evil.test", "https://evil.test/"]) {
            assert.equal(legalBackLink(callback, true).href, "/", callback);
            assert.equal(legalBackLink(callback, false).href, "/login", callback);
        }
    });
});
