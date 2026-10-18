/**
 * Browser start-up, before the app hydrates: turns off Zod's eval'd parsers
 * (launch item i26) and starts Sentry where a DSN is configured (i24). Only
 * NEXT_PUBLIC_ variables reach the browser, and Next.js inlines each one only
 * where it is named in full.
 */

import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { browserSentryOptions } from "@/lib/observability/sentry-options";

// The CSP blocks eval. Zod would probe for it (new Function) the first time a
// schema is built, which the browser reports as a violation; jitless skips the
// probe and the eval'd fast path. This runs before any page code.
z.config({ jitless: true });

const options = browserSentryOptions({
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
});
if (options.enabled) Sentry.init(options);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
