import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { resetApiSecurityForTests } from "@/lib/api/security";

import { GET as listFollows } from "./route";
import { DELETE as unfollow, PUT as follow } from "./[filerId]/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const FILER_ID = "00000000-0000-4000-8000-000000000001";

const request = (method: string, path: string) => new Request(`https://atlas.test${path}`, { method });
const params = (filerId: string) => ({ params: Promise.resolve({ filerId }) });

// The database half (what is stored, and for whom) is in
// scripts/db/alpha-radar-follows.test.ts.
describe("Alpha Radar follow routes", () => {
    afterEach(() => {
        delete process.env.AUTH_LOCAL_DEV_BYPASS;
        delete process.env.AUTH_LOCAL_DEV_USER_ID;
        resetApiSecurityForTests();
    });

    const signedIn = () => {
        process.env.AUTH_LOCAL_DEV_BYPASS = "1";
        process.env.AUTH_LOCAL_DEV_USER_ID = USER_ID;
    };

    test("fail closed when sign-in isn't configured", async () => {
        assert.equal((await listFollows(request("GET", "/api/alpha-radar/follows"))).status, 503);
        assert.equal((await follow(request("PUT", `/api/alpha-radar/follows/${FILER_ID}`), params(FILER_ID))).status, 503);
        assert.equal((await unfollow(request("DELETE", `/api/alpha-radar/follows/${FILER_ID}`), params(FILER_ID))).status, 503);
    });

    test("an ID that isn't a filer's is a 404 before the database is asked", async (t) => {
        signedIn();
        t.mock.method(console, "error", () => {});
        for (const id of ["filer-1", "berkshire-hathaway", "1", `${FILER_ID}x`]) {
            for (const handler of [follow, unfollow]) {
                const response = await handler(request(handler === follow ? "PUT" : "DELETE", `/api/alpha-radar/follows/${id}`), params(id));
                assert.equal(response.status, 404, id);
                assert.deepEqual(await response.json(), { error: "Tracked filer not found", code: "TRACKED_FILER_NOT_FOUND" });
            }
        }
    });
});
