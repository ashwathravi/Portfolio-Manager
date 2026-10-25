import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { loggableError } from "./loggable-error";

/** What postgres.js rejects with when neither of localhost's addresses answers. */
function refusedOnBothAddresses() {
    const refused = (address: string) => Object.assign(new Error(`connect ECONNREFUSED ${address}:5432`), {
        code: "ECONNREFUSED",
        address,
        port: 5432,
    });
    return Object.assign(new AggregateError([refused("::1"), refused("127.0.0.1")], ""), { code: "ECONNREFUSED" });
}

describe("loggableError", () => {
    test("turns an AggregateError into a plain Error React can replay", () => {
        const result = loggableError(refusedOnBothAddresses());

        assert.ok(result instanceof Error);
        assert.ok(!(result instanceof AggregateError));
        assert.ok(!("errors" in result));
        assert.equal(result.name, "AggregateError");
        assert.equal(result.message, "connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432");
        assert.equal((result as { code?: unknown }).code, "ECONNREFUSED");
    });

    test("keeps the AggregateError's own message before its inner ones", () => {
        const result = loggableError(new AggregateError([new Error("first"), "second"], "All attempts failed"));

        assert.equal((result as Error).message, "All attempts failed; first; second");
    });

    test("names the error when it has no message at all", () => {
        const result = loggableError(new AggregateError([], ""));

        assert.equal((result as Error).message, "AggregateError");
        assert.ok(!("code" in (result as Error)));
    });

    test("keeps the cause, an AggregateError cause made plain too", () => {
        const cause = refusedOnBothAddresses();
        const result = loggableError(new AggregateError([], "Transaction failed", { cause })) as Error;

        assert.ok(result.cause instanceof Error);
        assert.ok(!(result.cause instanceof AggregateError));
        assert.match((result.cause as Error).message, /ECONNREFUSED ::1:5432/);
    });

    test("leaves anything else as it is", () => {
        const plain = new Error("Failed query: select 1", { cause: refusedOnBothAddresses() });

        assert.equal(loggableError(plain), plain);
        assert.equal(loggableError("timeout"), "timeout");
        assert.equal(loggableError(null), null);
    });
});
