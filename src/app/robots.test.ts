import { test } from "node:test";
import assert from "node:assert/strict";

import robots from "./robots";

test("robots.txt lets crawlers fetch every page, so they read its noindex", () => {
    assert.deepEqual(robots(), { rules: { userAgent: "*", allow: "/" } });
});
