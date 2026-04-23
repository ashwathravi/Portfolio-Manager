/**
 * GET /api/portfolios/count
 *
 * Returns just the count of portfolios the user has. Powers the sidebar
 * user footer "Pro · N accounts" line (AR-66) without forcing the client
 * bundle to import the whole portfolios list.
 *
 * Response: `{ count: number }`
 *
 * Linear: AR-66
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { portfolios } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        // Count via SQL rather than `findMany` + `.length` — the SELECT COUNT
        // avoids hydrating every row (and every related holding if someone
        // later turns on `with: { holdings: true }` here by mistake).
        const [row] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(portfolios);

        return NextResponse.json({ count: row?.count ?? 0 });
    } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
