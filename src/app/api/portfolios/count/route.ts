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
import { requireSessionApiUserScope } from "@/lib/api/session-security";
import { internalServerError } from "@/lib/api/security";
import { buildUserPortfolioCountQuery } from "@/lib/portfolio-repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    try {
        // Count via SQL rather than `findMany` + `.length` — the SELECT COUNT
        // avoids hydrating every row (and every related holding if someone
        // later turns on `with: { holdings: true }` here by mistake).
        const [row] = await buildUserPortfolioCountQuery(auth.context.userId);

        return NextResponse.json({ count: row?.count ?? 0 });
    } catch (err) {
        return internalServerError(err, "Unable to count portfolios.", "PORTFOLIO_COUNT_FAILED");
    }
}
