import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isSchwabIntegrationEnabled } from "./feature.ts";

describe("isSchwabIntegrationEnabled", () => {
    test("is off by default", () => {
        assert.equal(isSchwabIntegrationEnabled({}), false);
        assert.equal(isSchwabIntegrationEnabled({ NODE_ENV: "development" }), false);
    });

    test("turns on only with an explicit flag outside production", () => {
        assert.equal(isSchwabIntegrationEnabled({ NODE_ENV: "development", SCHWAB_INTEGRATION_ENABLED: "1" }), true);
        assert.equal(isSchwabIntegrationEnabled({ NODE_ENV: "development", SCHWAB_INTEGRATION_ENABLED: "true" }), false);
    });

    test("never turns on in production", () => {
        assert.equal(isSchwabIntegrationEnabled({ NODE_ENV: "production", SCHWAB_INTEGRATION_ENABLED: "1" }), false);
    });
});
