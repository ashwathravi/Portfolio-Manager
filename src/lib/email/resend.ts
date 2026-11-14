/**
 * Sending one email through Resend (launch item i58).
 *
 *   POST https://api.resend.com/emails
 *   Authorization: Bearer RESEND_API_KEY
 *   Idempotency-Key: <key>   Resend sends a key's email once within 24 hours.
 *   → 200 { id }             also for a key it has sent the same email under:
 *                            that email's ID, sent no second time
 *   → 409 invalid_idempotent_request    the key was used for a different
 *                                       email, which Resend sent
 *   → 409 concurrent_idempotent_requests  the key's first request is still
 *                                         going
 *
 * No SDK: it's one call. The key goes in a header, and an error says only
 * Resend's status and error name, never its message, which can quote the
 * address.
 */

import type { EmailConfig } from "./config";

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";
/** An email that hasn't been accepted by then is given up, and sent again on a later run. */
export const RESEND_TIMEOUT_MS = 10_000;

export interface OutgoingEmail {
    to: string;
    subject: string;
    html: string;
    text: string;
    /** List-Unsubscribe and List-Unsubscribe-Post. */
    headers: Record<string, string>;
    /** Sends a retried email once. */
    idempotencyKey: string;
    /** Which email it is, for Resend's logs: "alerts" or "weekly_review". */
    category: string;
}

export class EmailSendError extends Error {
    constructor(
        message: string,
        readonly status: number | null,
        /** Resend's error name, such as "invalid_idempotent_request". */
        readonly code: string | null = null,
    ) {
        super(message);
        this.name = "EmailSendError";
    }
}

/**
 * What a send that threw means for its email:
 *
 *   - "refused": Resend answered that it won't send it (a 4xx), so it didn't go;
 *   - "already-sent": the key was used for an email Resend sent in the last
 *     24 hours, with other content (a cleared alert left out, say), so the
 *     email went then;
 *   - "unknown": no answer, a server error, or the key's first request still
 *     going. It may have gone, so it's sent again only under the same key.
 */
export type SendFailure = "refused" | "already-sent" | "unknown";

export function classifySendFailure(error: unknown): SendFailure {
    if (!(error instanceof EmailSendError) || error.status === null || error.status < 400 || error.status >= 500) return "unknown";
    if (error.status === 409) return error.code === "invalid_idempotent_request" ? "already-sent" : "unknown";
    return "refused";
}

/** Sends one email, answering Resend's ID for it; throws {@link EmailSendError}. */
export type SendEmail = (email: OutgoingEmail) => Promise<{ id: string }>;

export function resendSender(
    config: Pick<EmailConfig, "apiKey" | "from">,
    fetchImpl: typeof fetch = (...args) => fetch(...args),
    timeoutMs: number = RESEND_TIMEOUT_MS,
): SendEmail {
    return async (email) => {
        let response: Response;
        try {
            response = await fetchImpl(RESEND_EMAILS_URL, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    "Content-Type": "application/json",
                    "Idempotency-Key": email.idempotencyKey,
                },
                body: JSON.stringify({
                    from: config.from,
                    to: [email.to],
                    subject: email.subject,
                    html: email.html,
                    text: email.text,
                    headers: email.headers,
                    tags: [{ name: "category", value: email.category }],
                }),
                cache: "no-store",
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (error) {
            const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "couldn't be reached";
            throw new EmailSendError(`Resend ${reason}.`, null);
        }
        const body = (await response.json().catch(() => null)) as { id?: unknown; name?: unknown } | null;
        if (!response.ok) {
            const code = typeof body?.name === "string" && /^[a-z_]{1,64}$/.test(body.name) ? body.name : null;
            throw new EmailSendError(`Resend refused the email (HTTP ${response.status}${code ? `, ${code}` : ""}).`, response.status, code);
        }
        if (typeof body?.id !== "string" || body.id.length === 0) {
            throw new EmailSendError("Resend's answer had no email ID.", response.status);
        }
        return { id: body.id };
    };
}
