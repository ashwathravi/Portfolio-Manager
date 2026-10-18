/**
 * Sends errors the server catches itself (a route answering 500, a failed
 * scheduled job) to Sentry. Errors nothing catches are reported by the SDK on
 * its own through `onRequestError` in src/instrumentation.ts. Without a DSN
 * (local runs, E2E) the SDK isn't started and this does nothing.
 */

import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";

export interface ErrorReportContext {
    tags?: Record<string, string>;
}

export interface ErrorReporter {
    capture: (error: unknown, context?: ErrorReportContext) => unknown;
    /** Keeps the function alive until `task` settles, after the response. */
    afterResponse: (task: () => Promise<unknown>) => void;
}

const SENTRY_REPORTER: ErrorReporter = {
    capture: Sentry.captureException,
    afterResponse: (task) => {
        try {
            after(task);
        } catch {
            // Outside a request (a script, a test) nothing gets frozen.
        }
    },
};

let reporter: ErrorReporter = SENTRY_REPORTER;

export function reportError(error: unknown, context: ErrorReportContext = {}): void {
    reporter.capture(error, context);
    // A function can be frozen as soon as it responds; send the report first.
    reporter.afterResponse(() => Sentry.flush(2_000));
}

/** Swaps the reporter in tests; null restores Sentry. */
export function setErrorReporterForTests(testReporter: ErrorReporter | null): void {
    reporter = testReporter ?? SENTRY_REPORTER;
}
