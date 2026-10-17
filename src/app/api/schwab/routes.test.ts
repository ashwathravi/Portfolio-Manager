import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

import { GET as schwabOAuthCallback } from "../auth/schwab/route";
import { POST as placeSchwabOrder } from "./order/route";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setNodeEnv(value: string | undefined): void {
    const env = process.env as Record<string, string | undefined>;
    if (value === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = value;
}

function callbackRequest(): NextRequest {
    const url = "https://atlas.test/api/auth/schwab?code=abc";
    const request = new Request(url) as unknown as NextRequest;
    Object.defineProperty(request, "nextUrl", { value: new URL(url) });
    return request;
}

function orderRequest(): Request {
    return new Request("https://atlas.test/api/schwab/order", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": "test-secret" },
        body: JSON.stringify({ order: {} }),
    });
}

describe("Schwab routes", () => {
    afterEach(() => {
        delete process.env.SCHWAB_INTEGRATION_ENABLED;
        delete process.env.INTERNAL_API_SECRET;
        setNodeEnv(ORIGINAL_NODE_ENV);
    });

    test("are not found by default, before any provider call", async () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        assert.equal((await schwabOAuthCallback(callbackRequest())).status, 404);
        assert.equal((await placeSchwabOrder(orderRequest())).status, 404);
    });

    test("stay not found in production even with the flag set", async () => {
        setNodeEnv("production");
        process.env.SCHWAB_INTEGRATION_ENABLED = "1";
        process.env.INTERNAL_API_SECRET = "test-secret";

        assert.equal((await schwabOAuthCallback(callbackRequest())).status, 404);
        assert.equal((await placeSchwabOrder(orderRequest())).status, 404);
    });

    test("keep the order route behind the internal secret when enabled locally", async () => {
        setNodeEnv("development");
        process.env.SCHWAB_INTEGRATION_ENABLED = "1";

        assert.equal((await placeSchwabOrder(orderRequest())).status, 503);
    });
});
