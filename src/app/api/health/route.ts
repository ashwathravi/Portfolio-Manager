import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public liveness check, with no database call. `release` is the commit this
 * deployment was built from (the deploy job passes it as SENTRY_RELEASE), so
 * the post-deploy smoke test (tests/production) knows production serves it.
 */
export function GET() {
    return NextResponse.json({ status: "ok", release: process.env.SENTRY_RELEASE?.trim() || null });
}
