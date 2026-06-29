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

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { portfolios } from "@/db/schema";
import { internalServerError, requirePortfolioUserScope } from "@/lib/api/security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const auth = requirePortfolioUserScope(request);
    if (!auth.ok) return auth.response;

    try {
        // Count via SQL rather than `findMany` + `.length` — the SELECT COUNT
        // avoids hydrating every row (and every related holding if someone
        // later turns on `with: { holdings: true }` here by mistake).
        const query = db
            .select({ count: sql<number>`count(*)::int` })
            .from(portfolios);

        const [row] = auth.context.userId
            ? await query.where(eq(portfolios.userId, auth.context.userId))
            : await query;

        return NextResponse.json({ count: row?.count ?? 0 });
    } catch (err) {
        return internalServerError(err, "Unable to count portfolios.", "PORTFOLIO_COUNT_FAILED");
    }
}
