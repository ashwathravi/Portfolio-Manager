/**
 * GET /api/plaid/connections
 *
 * The signed-in user's linked connections and their accounts, from the
 * database (launch item i46): what Settings lists, with each account's
 * pick and the account it syncs into.
 *
 * Response: 200 { data: [{ itemId, institutionName, status, lastSuccessfulSyncAt, accounts }] };
 *           503 PLAID_NOT_CONFIGURED or PLAID_CONNECTIONS_NOT_STORED
 */

import { NextResponse } from "next/server";

import { apiError, internalServerError } from "@/lib/api/security";
import { requireSessionApiUserScope } from "@/lib/api/session-security";
import { plaidAvailability } from "@/lib/plaid/availability";
import { listPlaidConnections } from "@/lib/plaid/connections";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const plaid = plaidAvailability();
    if (!plaid.ok) return apiError(plaid.message, plaid.code, 503);

    try {
        return NextResponse.json({ data: await listPlaidConnections(auth.context.userId) });
    } catch (error) {
        return internalServerError(error, "Unable to load the linked accounts.", "PLAID_CONNECTIONS_FAILED");
    }
}
