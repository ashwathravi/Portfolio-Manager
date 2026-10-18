/**
 * Server start-up and uncaught server errors (launch item i24). Next.js calls
 * register() once per server instance and onRequestError for every error
 * thrown while rendering a page or running a route handler, server action or
 * the proxy. Sentry only starts where a DSN is configured; see
 * src/lib/observability/sentry-options.ts for what it may collect.
 */

import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";

import { requestIdFrom } from "@/lib/observability/request-id";
import { serverSentryOptions } from "@/lib/observability/sentry-options";

export function register(): void {
    // Nothing in the app runs on the Edge runtime (the proxy runs on Node.js).
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    const options = serverSentryOptions();
    if (!options.enabled) return;
    Sentry.init({
        ...options,
        // The SDK's own Http integration, minus per-request release-health
        // sessions: errors are all this app reports.
        integrations: (defaults) => defaults.map((integration) =>
            integration.name === "Http"
                ? Sentry.httpIntegration({ disableIncomingRequestSpans: true, sessions: false })
                : integration),
    });
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
    Sentry.withScope((scope) => {
        const requestId = requestIdFrom(request.headers);
        if (requestId) scope.setTag("request_id", requestId);
        Sentry.captureRequestError(error, request, context);
    });
};
