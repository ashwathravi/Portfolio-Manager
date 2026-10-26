/**
 * DELETE /api/plaid/connections/[itemId]
 *
 * Disconnects one of the signed-in user's linked connections (launch item
 * i45): removed at Plaid, which ends Atlas's access at the institution, then
 * revoked here, its token wiped and its accounts no longer synced. The
 * accounts already brought in stay until the user deletes them.
 *
 * Response: 204; 400 INVALID_PLAID_ITEM; 404 PLAID_ITEM_NOT_FOUND;
 *           502 PLAID_DISCONNECT_FAILED; 503 PLAID_NOT_CONFIGURED,
 *           PLAID_CONNECTIONS_NOT_STORED or PLAID_TOKEN_UNAVAILABLE
 */

import { apiError, internalServerError, logApiEvent } from "@/lib/api/security";
import { requireSessionApiUserScope } from "@/lib/api/session-security";
import { requestIdFrom } from "@/lib/observability/request-id";
import { plaidAvailability } from "@/lib/plaid/availability";
import { PlaidTokenUnavailableError, disconnectPlaidItem } from "@/lib/plaid/connections";
import { PlaidApiError } from "@/lib/plaid/link";
import { PlaidItemNotFoundError } from "@/lib/plaid/sync";
import { plaidIdSchema } from "@/lib/validators/plaid-sync";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ itemId: string }> };

export async function DELETE(request: Request, { params }: Params) {
    const auth = await requireSessionApiUserScope(request);
    if (!auth.ok) return auth.response;

    const plaid = plaidAvailability();
    if (!plaid.ok) return apiError(plaid.message, plaid.code, 503);

    const itemId = plaidIdSchema.safeParse((await params).itemId);
    if (!itemId.success) return apiError("Invalid connection", "INVALID_PLAID_ITEM", 400);

    try {
        await disconnectPlaidItem(auth.context.userId, itemId.data, { config: plaid.config });
        logApiEvent("plaid_connection_disconnected", { route: "/api/plaid/connections/[itemId]", requestId: requestIdFrom(request.headers), userScoped: true });
        return new Response(null, { status: 204 });
    } catch (error) {
        if (error instanceof PlaidItemNotFoundError) return apiError("Plaid connection not found", "PLAID_ITEM_NOT_FOUND", 404);
        if (error instanceof PlaidTokenUnavailableError) {
            console.warn("Plaid disconnect refused: the connection's token can't be read.");
            return apiError(
                "Atlas can't read this connection's access right now, so it can't end it at Plaid. Nothing changed; try again later, or remove Atlas Wealth at my.plaid.com.",
                "PLAID_TOKEN_UNAVAILABLE",
                503,
            );
        }
        if (error instanceof PlaidApiError) {
            console.warn("Plaid disconnect failed.", error.errorCode);
            return apiError("Plaid couldn't be reached to disconnect. Nothing changed; try again later.", "PLAID_DISCONNECT_FAILED", 502);
        }
        return internalServerError(error, "Unable to disconnect the linked accounts.", "PLAID_DISCONNECT_FAILED");
    }
}
