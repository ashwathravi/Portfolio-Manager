/**
 * GET /api/account/export
 *
 * Everything Atlas holds for the signed-in user, as JSON (launch item i65):
 * accounts with their holdings, transactions and valuation history,
 * settings, linked connections (no tokens), watchlist, journal and theses.
 * Settings › Data downloads it, and builds the holdings and transactions
 * CSV files from it.
 *
 * Response: 200 AccountExport (attachment); 503 ACCOUNT_DATA_UNAVAILABLE
 */

import { NextResponse } from "next/server";

import { isDatabaseConfigured } from "@/db/connection-options";
import { buildAccountExport } from "@/lib/account/export";
import { apiError, internalServerError } from "@/lib/api/security";
import { requireSessionApiUserScope } from "@/lib/api/session-security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    if (!isDatabaseConfigured()) {
        return apiError("There's no account data on the server here to export.", "ACCOUNT_DATA_UNAVAILABLE", 503);
    }

    try {
        const data = await buildAccountExport(auth.context.userId);
        return NextResponse.json(data, {
            headers: {
                "Content-Disposition": `attachment; filename="atlas-wealth-export-${data.exportedAt.slice(0, 10)}.json"`,
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        return internalServerError(error, "Unable to export the account.", "ACCOUNT_EXPORT_FAILED");
    }
}
