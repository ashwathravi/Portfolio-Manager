import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { reportBoundaryError } from "./report-boundary-error";

describe("reportBoundaryError", () => {
    test("reports an error thrown in the browser, tagged with its boundary", () => {
        const captured: unknown[][] = [];
        const error = new Error("render failed");

        reportBoundaryError(error, "portfolios", (...args) => { captured.push(args); });

        assert.deepEqual(captured, [[error, { tags: { boundary: "portfolios" } }]]);
    });

    test("skips server errors, which onRequestError already reported", () => {
        const captured: unknown[] = [];
        const error = Object.assign(new Error("An error occurred in the Server Components render."), { digest: "1234567890" });

        reportBoundaryError(error, "root", (reported) => { captured.push(reported); });

        assert.deepEqual(captured, []);
    });
});
