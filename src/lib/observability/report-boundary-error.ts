/**
 * Sends errors caught by error.tsx and global-error.tsx to Sentry, tagged
 * with the boundary that caught them. React doesn't rethrow an error a
 * boundary caught, so the SDK's global handlers never see it.
 */

import * as Sentry from "@sentry/nextjs";

type Capture = (error: unknown, context?: { tags?: Record<string, string> }) => unknown;

/**
 * An error with a digest was thrown while rendering on the server, where
 * onRequestError already reported it with the full stack trace; the browser
 * only gets a redacted copy, so it is skipped here.
 */
export function reportBoundaryError(
    error: Error & { digest?: string },
    boundary: string,
    capture: Capture = Sentry.captureException,
): void {
    if (error.digest) return;
    capture(error, { tags: { boundary } });
}
