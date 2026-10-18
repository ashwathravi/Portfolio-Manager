import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

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
});
