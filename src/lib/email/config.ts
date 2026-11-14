/**
 * Email through Resend (launch item i58): what the nightly email job needs
 * to send, read from the environment.
 *
 *   RESEND_API_KEY  Resend's API key; a sending-only key is enough.
 *   EMAIL_FROM      The sender, on a domain verified in Resend, e.g.
 *                   "Atlas Wealth <alerts@mail.example.com>".
 *   APP_URL         The site's address, for the links in each email. When
 *                   unset: AUTH_URL, then the production domain Vercel sets
 *                   (VERCEL_PROJECT_PRODUCTION_URL).
 *
 * Without the key or the sender nothing is sent: the job says so, and
 * Settings says choices are saved but email isn't on yet.
 */

export interface EmailConfig {
    apiKey: string;
    from: string;
    /** The site's origin, without a trailing slash. */
    siteUrl: string;
}

export type EmailSetup = { ok: true; config: EmailConfig } | { ok: false; reason: string };

type Env = Readonly<Record<string, string | undefined>>;

export function emailSetup(env: Env = process.env): EmailSetup {
    const apiKey = env.RESEND_API_KEY?.trim() ?? "";
    const from = env.EMAIL_FROM?.trim() ?? "";
    const missing = [apiKey ? null : "RESEND_API_KEY", from ? null : "EMAIL_FROM"].filter(Boolean);
    if (missing.length > 0) {
        return { ok: false, reason: `Email is not configured: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set.` };
    }
    const siteUrl = siteOrigin(env);
    if (!siteUrl) return { ok: false, reason: "Email is not configured: set APP_URL to the site's address for the links." };
    return { ok: true, config: { apiKey, from, siteUrl } };
}

export function isEmailConfigured(env: Env = process.env): boolean {
    return emailSetup(env).ok;
}

function siteOrigin(env: Env): string | null {
    const production = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
    for (const candidate of [env.APP_URL, env.AUTH_URL, production ? `https://${production}` : undefined]) {
        const value = candidate?.trim();
        if (!value) continue;
        try {
            const url = new URL(value);
            if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
        } catch {
            // Not a URL: try the next.
        }
    }
    return null;
}
