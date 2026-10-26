/**
 * POST /api/plaid/webhook
 *
 * Plaid's webhooks (launch item i45). No session: Plaid calls it, and every
 * webhook must carry Plaid's signature over its exact body
 * (src/lib/plaid/webhook.ts) before anything is read from it. New holdings
 * or transactions sync the connection after the response; item events
 * change its status (sign in again, consent ending, revoked, repaired).
 *
 * Response: 200 { received: true, action }; 400 INVALID_PLAID_WEBHOOK;
 *           401 PLAID_WEBHOOK_UNVERIFIED; 413; 503 PLAID_NOT_CONFIGURED or
 *           PLAID_CONNECTIONS_NOT_STORED
 */

import { after, NextResponse } from "next/server";

import { readTextBody } from "@/lib/api/body";
import { apiError, internalServerError, logApiEvent } from "@/lib/api/security";
import { plaidAvailability } from "@/lib/plaid/availability";
import { handlePlaidWebhook, webhookKind, type PlaidWebhookBody } from "@/lib/plaid/connections";
import { syncPlaidItem } from "@/lib/plaid/sync";
import { plaidWebhookKeyFetcher, verifyPlaidWebhook } from "@/lib/plaid/webhook";

export const dynamic = "force-dynamic";
// The response goes straight back; a sync it starts runs after, within this.
export const maxDuration = 60;

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
    const plaid = plaidAvailability();
    if (!plaid.ok) return apiError(plaid.message, plaid.code, 503);
    const { config } = plaid;

    const body = await readTextBody(request, MAX_BODY_BYTES);
    if (!body.ok) return apiError("Invalid webhook", "INVALID_PLAID_WEBHOOK", body.reason === "too-large" ? 413 : 400);

    const verified = await verifyPlaidWebhook({
        jwt: request.headers.get("plaid-verification"),
        body: body.text,
        getKey: plaidWebhookKeyFetcher(config),
    });
    if (!verified.ok) {
        logApiEvent("plaid_webhook_refused", { route: "/api/plaid/webhook", reason: verified.reason });
        return apiError("Webhook not verified", "PLAID_WEBHOOK_UNVERIFIED", 401);
    }

    let event: PlaidWebhookBody;
    try {
        event = JSON.parse(body.text) as PlaidWebhookBody;
    } catch {
        return apiError("Invalid webhook", "INVALID_PLAID_WEBHOOK", 400);
    }

    try {
        const result = await handlePlaidWebhook(event, {
            scheduleSync: (userId, itemId) => {
                after(async () => {
                    const synced = await syncPlaidItem(userId, itemId, { config, deadline: Date.now() + (maxDuration - 10) * 1000 })
                        .catch((error: unknown) => ({ status: "failed" as const, error }));
                    if (synced.status !== "synced") console.warn("Plaid webhook sync didn't finish.", synced.status);
                });
            },
        });
        logApiEvent("plaid_webhook_received", { route: "/api/plaid/webhook", kind: webhookKind(event), action: result.action, connections: result.connections });
        return NextResponse.json({ received: true, action: result.action });
    } catch (error) {
        return internalServerError(error, "Unable to handle the webhook.", "PLAID_WEBHOOK_FAILED");
    }
}
