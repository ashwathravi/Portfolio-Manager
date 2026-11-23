/**
 * Masks secrets in text that leaves the app: the job run log, cron responses
 * and error reports sent to Sentry. Libraries sometimes quote a connection
 * string or a request URL in an error message, so every message that goes
 * out passes through {@link redactSecrets} first.
 */

// Environment variables whose values must never leave the app, even if a
// library quotes one in an error message: every key, secret and token the
// app reads (a test checks), and the AI Gateway credentials the AI SDK reads.
export const SECRET_SETTINGS = [
    "AI_GATEWAY_API_KEY",
    "AUTH_GOOGLE_SECRET",
    "AUTH_SECRET",
    "CRON_SECRET",
    "DATABASE_MIGRATION_URL",
    "DATABASE_URL",
    "FINNHUB_API_KEY",
    "INTERNAL_API_SECRET",
    "KV_REST_API_TOKEN",
    "PLAID_SECRET",
    "PLAID_TOKEN_ENCRYPTION_KEY",
    "POLYGON_API_KEY",
    "RESEND_API_KEY",
    "SCHWAB_ACCESS_TOKEN",
    "SCHWAB_CLIENT_SECRET",
    "SENTRY_AUTH_TOKEN",
    "UPSTASH_REDIS_REST_TOKEN",
    "VERCEL_OIDC_TOKEN",
] as const;

/**
 * Replaces the value of every {@link SECRET_SETTINGS} variable, credentials
 * in URLs (`//user:password@`) and `apiKey=` parameters with `***`.
 */
export function redactSecrets(text: string, env: Partial<Record<string, string>> = process.env): string {
    let redacted = text;
    for (const setting of SECRET_SETTINGS) {
        const value = env[setting]?.trim();
        // Short values would mask ordinary words; real secrets are long.
        if (value && value.length >= 8) redacted = redacted.split(value).join("***");
    }
    return redacted
        .replace(/(\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1***@")
        // A value also ends at a double quote or a backslash, so in JSON text,
        // such as the line a route's 500 logs (src/lib/api/security.ts), the
        // mask stays inside its string and the fields after it are kept.
        .replace(/(api_?key=)[^&\s"\\]+/gi, "$1***");
}
