/**
 * Browser start-up (launch item i24): starts Sentry before the app hydrates,
 * where a DSN is configured. Only NEXT_PUBLIC_ variables reach the browser,
 * and Next.js inlines each one only where it is named in full.
 */

import * as Sentry from "@sentry/nextjs";

import { browserSentryOptions } from "@/lib/observability/sentry-options";

const options = browserSentryOptions({
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
});
if (options.enabled) Sentry.init(options);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
