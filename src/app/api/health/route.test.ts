import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import { GET } from "./route";

const originalRelease = process.env.SENTRY_RELEASE;

afterEach(() => {
    if (originalRelease === undefined) delete process.env.SENTRY_RELEASE;
    else process.env.SENTRY_RELEASE = originalRelease;
});

test("GET /api/health is public and reports process health", async () => {
    delete process.env.SENTRY_RELEASE;
    const response = GET();

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", release: null });
});

test("GET /api/health reports the commit the deploy job passed in", async () => {
    process.env.SENTRY_RELEASE = " 1eb1344eb04cd600268b3298812935ade8f149ef ";

    assert.deepEqual(await GET().json(), { status: "ok", release: "1eb1344eb04cd600268b3298812935ade8f149ef" });
});

test("GET /api/health reports no release for an empty value", async () => {
    process.env.SENTRY_RELEASE = "";

    assert.deepEqual(await GET().json(), { status: "ok", release: null });
});
