import { test } from "node:test";
import assert from "node:assert/strict";

import { GET } from "./route";

test("GET /api/health is public and reports process health", async () => {
    const response = GET();

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
});
