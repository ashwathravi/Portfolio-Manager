import { test } from "node:test";
import assert from "node:assert/strict";

import { SESSION_MAX_AGE_SECONDS, SESSION_UPDATE_AGE_SECONDS } from "./session-policy.ts";

test("session policy - sessions expire after a week and refresh at most daily", () => {
    assert.equal(SESSION_MAX_AGE_SECONDS, 604_800);
    assert.equal(SESSION_UPDATE_AGE_SECONDS, 86_400);
    assert.ok(SESSION_UPDATE_AGE_SECONDS < SESSION_MAX_AGE_SECONDS);
});
