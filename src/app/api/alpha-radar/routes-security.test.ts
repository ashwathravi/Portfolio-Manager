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
        delete process.env.AUTH_LOCAL_DEV_BYPASS;
        delete process.env.AUTH_LOCAL_DEV_USER_ID;
        resetApiSecurityForTests();
    });

    test("fails closed when sign-in is not configured", async () => {
        const response = await refreshAll(apiRequest("/api/alpha-radar/refresh", {}));

        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
            error: "Authentication is not configured.",
            code: "AUTH_CONFIGURATION_ERROR",
        });
    });

    test("does not accept the internal secret and a user id header as a session", async () => {
        process.env.INTERNAL_API_SECRET = "test-secret";

        const response = await refreshAll(apiRequest("/api/alpha-radar/refresh", {}, {
            "x-api-key": "test-secret",
            "x-user-id": USER_ID,
        }));

        assert.equal(response.status, 503);
    });

    test("authorizes a signed-in user before validating payloads", async () => {
        signInAsLocalUser();

        const response = await refreshAll(apiRequest("/api/alpha-radar/refresh", {
            filingLimit: -1,
        }));

        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "INVALID_REFRESH_PAYLOAD");
    });

    test("requires a signed-in user for tracked filer mutations", async () => {
        process.env.INTERNAL_API_SECRET = "test-secret";
        const forged = { "x-api-key": "test-secret", "x-user-id": USER_ID };

        const createResponse = await createTrackedFiler(apiRequest("/api/alpha-radar/filers", {}, forged));
        const patchResponse = await updateTrackedFiler(
            apiRequest("/api/alpha-radar/filers/filer-1", {}, forged),
            { params: Promise.resolve({ filerId: "filer-1" }) },
        );

        assert.equal(createResponse.status, 503);
        assert.equal(patchResponse.status, 503);
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

// Explicit non-production local bypass: the same fixed principal E2E uses.
function signInAsLocalUser(): void {
    process.env.AUTH_LOCAL_DEV_BYPASS = "1";
    process.env.AUTH_LOCAL_DEV_USER_ID = USER_ID;
}
