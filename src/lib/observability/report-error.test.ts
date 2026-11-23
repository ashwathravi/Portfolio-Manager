import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";

import { DrizzleQueryError } from "drizzle-orm";

import { DatabaseQueryError } from "./loggable-error";
import { reportError, setErrorReporterForTests, type ErrorReporter } from "./report-error";

function recordingReporter() {
    const captured: Array<{ error: unknown; context: unknown }> = [];
    const tasks: Array<() => Promise<unknown>> = [];
    const reporter: ErrorReporter = {
        capture: (error, context) => { captured.push({ error, context }); },
        afterResponse: (task) => { tasks.push(task); },
    };
    return { reporter, captured, tasks };
}

describe("reportError", () => {
    afterEach(() => setErrorReporterForTests(null));

    test("captures the error with its tags, then flushes after the response", async () => {
        const { reporter, captured, tasks } = recordingReporter();
        setErrorReporterForTests(reporter);
        const error = new Error("boom");

        reportError(error, { tags: { job: "prices" } });

        assert.deepEqual(captured, [{ error, context: { tags: { job: "prices" } } }]);
        assert.equal(tasks.length, 1);
        // Without a started SDK the flush has nothing to send.
        await tasks[0]();
    });

    test("does nothing visible without a DSN, even outside a request", () => {
        assert.doesNotThrow(() => reportError(new Error("no Sentry here")));
    });

    test("regression: a scheduled job's failed query is reported without its parameters", () => {
        const { reporter, captured } = recordingReporter();
        setErrorReporterForTests(reporter);
        const sql = 'insert into "manual_holdings" ("id", "name", "value") values (default, $1, $2)';
        const cause = Object.assign(new Error("deadlock detected"), { code: "40P01" });

        reportError(new DrizzleQueryError(sql, ["Sample Stable Value Fund MARKER", "1234.56"], cause), { tags: { job: "plaid-sync" } });

        assert.equal(captured.length, 1);
        assert.ok(captured[0].error instanceof DatabaseQueryError);
        assert.equal((captured[0].error as Error).message, `Failed query: ${sql} (code 40P01)`);
        assert.ok(!inspect(captured[0].error, { showHidden: true, depth: 8 }).includes("MARKER"));
        assert.deepEqual(captured[0].context, { tags: { job: "plaid-sync" } });
    });
});
