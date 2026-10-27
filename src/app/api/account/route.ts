/**
 * DELETE /api/account
 *
 * Deletes the signed-in user's account and everything Atlas holds for them
 * (launch item i65), ending their linked connections at Plaid first
 * (src/lib/account/delete.ts). The session goes with the account; the
 * browser then clears its copies and signs out.
 *
 * Body:     { confirm: "DELETE" }
 * Response: 204; 400 INVALID_ACCOUNT_DELETION; 409 ACCOUNT_DELETION_BLOCKED
 *           (a connection couldn't be ended at Plaid; nothing deleted);
 *           503 ACCOUNT_DATA_UNAVAILABLE (no database here)
 */

import { isDatabaseConfigured } from "@/db/connection-options";
import { AccountDeletionBlockedError, deleteAccount } from "@/lib/account/delete";
import { readJsonBody } from "@/lib/api/body";
import { apiError, internalServerError, logApiEvent } from "@/lib/api/security";
import { requireSessionApiUserScope } from "@/lib/api/session-security";
import { requestIdFrom } from "@/lib/observability/request-id";
import { plaidAvailability } from "@/lib/plaid/availability";
import { accountDeletionSchema } from "@/lib/validators/account";

export const dynamic = "force-dynamic";
// Each linked connection is ended at Plaid before anything is deleted.
export const maxDuration = 60;

export async function DELETE(request: Request) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;
    if (!isDatabaseConfigured()) {
        return apiError("There's no account data on the server here to delete.", "ACCOUNT_DATA_UNAVAILABLE", 503);
    }

    const body = await readJsonBody(request, 1024);
    const parsed = body.ok ? accountDeletionSchema.safeParse(body.value) : null;
    if (!parsed?.success) return apiError("Type DELETE to confirm", "INVALID_ACCOUNT_DELETION", 400);

    const plaid = plaidAvailability();
    try {
        const deleted = await deleteAccount(auth.context.userId, { plaid: plaid.ok ? plaid.config : null });
        logApiEvent("account_deleted", {
            route: "/api/account",
            requestId: requestIdFrom(request.headers),
            accounts: deleted.accounts,
            connections: deleted.connections,
        });
        return new Response(null, { status: 204 });
    } catch (error) {
        if (error instanceof AccountDeletionBlockedError) {
            return apiError(
                `Atlas couldn't end its access to ${error.institutions.join(", ")} through Plaid, so nothing was deleted. `
                + "Try again in a few minutes, or disconnect it in Connected accounts first.",
                "ACCOUNT_DELETION_BLOCKED",
                409,
            );
        }
        return internalServerError(error, "Unable to delete the account.", "ACCOUNT_DELETION_FAILED");
    }
}
