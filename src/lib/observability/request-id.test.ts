import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { requestIdFrom } from "./request-id";

const VERCEL_ID = "pdx1::iad1::abcde-1760745600000-0123456789ab";

describe("requestIdFrom", () => {
    test("prefers Vercel's request ID", () => {
        assert.equal(requestIdFrom(new Headers({ "x-vercel-id": VERCEL_ID, "x-request-id": "upstream-1" })), VERCEL_ID);
    });

    test("falls back to an upstream x-request-id", () => {
        assert.equal(requestIdFrom(new Headers({ "x-request-id": " upstream-1 " })), "upstream-1");
    });

    test("reads plain header objects, as onRequestError passes them", () => {
        assert.equal(requestIdFrom({ "x-vercel-id": VERCEL_ID }), VERCEL_ID);
        assert.equal(requestIdFrom({ "x-request-id": ["first", "second"] }), "first");
    });

    test("ignores values that aren't a short token", () => {
        assert.equal(requestIdFrom(new Headers({ "x-request-id": 'a"}, {"event":"forged' })), undefined);
        assert.equal(requestIdFrom(new Headers({ "x-request-id": "a".repeat(129) })), undefined);
        assert.equal(
            requestIdFrom(new Headers({ "x-vercel-id": "has space", "x-request-id": "upstream-1" })),
            "upstream-1",
        );
    });

    test("is undefined without either header", () => {
        assert.equal(requestIdFrom(new Headers()), undefined);
        assert.equal(requestIdFrom({}), undefined);
    });
});
