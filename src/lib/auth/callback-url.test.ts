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
