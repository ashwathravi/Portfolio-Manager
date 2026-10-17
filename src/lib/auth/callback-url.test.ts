import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { safeCallbackPath, withCallback } from "./callback-url";

describe("safeCallbackPath", () => {
    test("keeps same-site paths with their query", () => {
        assert.equal(safeCallbackPath("/execution?symbol=NVDA"), "/execution?symbol=NVDA");
    });

    test("falls back to Today for missing, absolute and protocol-relative targets", () => {
        for (const value of [undefined, null, "", "https://evil.test/", "//evil.test", "/\\evil.test", "execution"]) {
            assert.equal(safeCallbackPath(value), "/", String(value));
        }
    });

    test("refuses targets a browser would normalize to another site", () => {
        // Browsers strip tabs and newlines and read "\\" as "/" in URLs.
        for (const value of ["/\t/evil.test", "/\n/evil.test", "/\r\n/evil.test", "/\\/evil.test", "/\t\\evil.test"]) {
            assert.equal(safeCallbackPath(value), "/", JSON.stringify(value));
        }
    });

    test("refuses paths whose dot segments normalize to another site", () => {
        // Same-origin while resolving, but the returned "//evil.test" is not.
        for (const value of ["/..//evil.test", "/.//evil.test", "/a/..//evil.test", "/%2e%2e//evil.test"]) {
            assert.equal(safeCallbackPath(value), "/", JSON.stringify(value));
        }
    });

    test("returns the normalized path", () => {
        assert.equal(safeCallbackPath("/research/../execution#ticket"), "/execution#ticket");
    });
});

describe("withCallback", () => {
    test("carries a non-default callback, encoded", () => {
        assert.equal(withCallback("/privacy", "/execution?symbol=NVDA"), "/privacy?callbackUrl=%2Fexecution%3Fsymbol%3DNVDA");
    });

    test("leaves the default and unsafe callbacks off", () => {
        assert.equal(withCallback("/login", "/"), "/login");
        assert.equal(withCallback("/login", "//evil.test"), "/login");
        assert.equal(withCallback("/login", undefined), "/login");
    });
});
