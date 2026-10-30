import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { isDatabaseConfigured } from "@/db/connection-options";
import { buildJobHealthQuery, createJobHealthCheck } from "@/lib/health/job-health";

export const dynamic = "force-dynamic";

const checkJobs = createJobHealthCheck({
    isConfigured: () => isDatabaseConfigured(),
    // statement_timeout makes Postgres cancel the query itself, so a slow
    // database frees the connection instead of holding it open.
    load: (jobs) => db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '3s'`);
        return buildJobHealthQuery(jobs, tx);
    }),
});

/**
 * Public: whether every scheduled job (the nightly jobs and the backup) has
 * succeeded since its last run fell due. 200 when all have, 503 otherwise,
 * with each job's status and when it last succeeded, never error details.
 * The production monitor polls it (launch item i71).
 */
export async function GET() {
    const report = await checkJobs();
    return NextResponse.json(report, {
        status: report.status === "ok" ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
    });
}
