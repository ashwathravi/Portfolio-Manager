import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { createReadinessCheck } from "@/lib/health/readiness";

export const dynamic = "force-dynamic";

const checkReadiness = createReadinessCheck({
    isConfigured: () => Boolean(process.env.DATABASE_URL?.trim()),
    ping: () => db.execute(sql`select 1`),
});

/**
 * Public readiness check: 200 when the app can reach its database, 503
 * otherwise. /api/health stays a cheap liveness check with no database call.
 */
export async function GET() {
    const result = await checkReadiness();
    return NextResponse.json(result, {
        status: result.status === "ok" ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
    });
}
