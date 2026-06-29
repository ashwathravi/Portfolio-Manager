import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

import { resetApiSecurityForTests } from "@/lib/api/security";
import { POST as refreshAll } from "./refresh/route";
import { POST as createTrackedFiler } from "./filers/route";
import { PATCH as updateTrackedFiler } from "./filers/[filerId]/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("Alpha Radar route security", () => {
    afterEach(() => {
        delete process.env.INTERNAL_API_SECRET;
        resetApiSecurityForTests();
    });

    test("rejects refresh requests without API authentication when configured", async () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        const response = await refreshAll(apiRequest("/api/alpha-radar/refresh", {}));

        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
            error: "Unauthorized",
            code: "UNAUTHORIZED",
        });
    });

    test("rejects refresh requests without a scoped user id", async () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        const response = await refreshAll(apiRequest("/api/alpha-radar/refresh", {}, {
            "x-api-key": "test-secret",
        }));

        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
            error: "User scope is required.",
            code: "USER_SCOPE_REQUIRED",
        });
    });

    test("authorizes scoped refresh requests before validating payloads", async () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        const response = await refreshAll(apiRequest("/api/alpha-radar/refresh", {
            filingLimit: -1,
        }, authorizedHeaders()));

        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "INVALID_REFRESH_PAYLOAD");
    });

    test("requires user scope on tracked filer mutations", async () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        const createResponse = await createTrackedFiler(apiRequest("/api/alpha-radar/filers", {}, {
            "x-api-key": "test-secret",
        }));
        const patchResponse = await updateTrackedFiler(
            apiRequest("/api/alpha-radar/filers/filer-1", {}, { "x-api-key": "test-secret" }),
            { params: Promise.resolve({ filerId: "filer-1" }) },
        );

        assert.equal(createResponse.status, 401);
        assert.equal(patchResponse.status, 401);
    });
});

function apiRequest(pathname: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
    return new Request(`https://atlas.test${pathname}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...headers,
        },
        body: JSON.stringify(body),
    }) as unknown as NextRequest;
}

function authorizedHeaders(): Record<string, string> {
    return {
        "x-api-key": "test-secret",
        "x-user-id": USER_ID,
    };
}
