import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "next-auth";

import { createRequestSessionLoader, getRequestSession } from "./session.ts";

const SESSION: Session = { user: { id: "user-a" }, expires: "2099-01-01T00:00:00.000Z" };

// Stands in for React's per-render cache, which only memoizes during a
// server render: the first call's promise is reused for the rest.
function memoize<T>(fn: () => T): () => T {
    let called = false;
    let value: T;
    return () => {
        if (!called) {
            called = true;
            value = fn();
        }
        return value;
    };
}

describe("createRequestSessionLoader", () => {
    test("returns the loader's session", async () => {
        const loader = createRequestSessionLoader(async () => SESSION, (fn) => fn);

        assert.deepEqual(await loader(), SESSION);
    });

    test("routes lookups through the cache so the layout and page share one", async () => {
        let lookups = 0;
        const loader = createRequestSessionLoader(async () => {
            lookups += 1;
            return SESSION;
        }, memoize);

        const [layoutSession, pageSession] = await Promise.all([loader(), loader()]);

        assert.equal(lookups, 1);
        assert.equal(layoutSession, pageSession);
    });

    test("does not swallow a failed lookup", async () => {
        const loader = createRequestSessionLoader(async () => {
            throw new Error("session store unavailable");
        }, (fn) => fn);

        await assert.rejects(loader(), /session store unavailable/);
    });
});

test("getRequestSession is the shared loader used by pages and the layout", () => {
    assert.equal(typeof getRequestSession, "function");
});
