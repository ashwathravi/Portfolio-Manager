import { test } from "node:test";
import assert from "node:assert/strict";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

test("GET /api/health/ready reports 503 when no database is configured", async (t) => {
    delete process.env.DATABASE_URL;
    t.after(() => {
        if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    });
    t.mock.method(console, "warn", () => {});

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(body.status, "degraded");
    assert.equal(body.database, "not_configured");
});
