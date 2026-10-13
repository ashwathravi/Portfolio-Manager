export interface GoogleAuthProfile {
    email?: unknown;
    email_verified?: unknown;
    hd?: unknown;
}

export interface GoogleAccessPolicy {
    allowedEmails?: string;
    allowedDomains?: string;
    /** Deny every sign-in when neither list is set. Defaults to on in production. */
    requireAllowlist?: boolean;
}

export interface AuthEnvironment {
    NODE_ENV?: string;
    AUTH_SECRET?: string;
    AUTH_GOOGLE_ID?: string;
    AUTH_GOOGLE_SECRET?: string;
    AUTH_LOCAL_DEV_BYPASS?: string;
    AUTH_LOCAL_DEV_USER_ID?: string;
    AUTH_ALLOWED_EMAILS?: string;
    AUTH_ALLOWED_DOMAINS?: string;
    INTERNAL_API_SECRET?: string;
}

export type AuthRuntimeMode = "configured" | "local-bypass" | "invalid";

export function isGoogleProfileAllowed(
    profile: GoogleAuthProfile | undefined,
    policy: GoogleAccessPolicy = {
        allowedEmails: process.env.AUTH_ALLOWED_EMAILS,
        allowedDomains: process.env.AUTH_ALLOWED_DOMAINS,
        requireAllowlist: process.env.NODE_ENV === "production",
    },
): boolean {
    const email = typeof profile?.email === "string" ? profile.email.trim().toLowerCase() : "";
    const emailVerified = profile?.email_verified === true;
    if (!email || !emailVerified) return false;

    // When both lists are set, a profile must match both (email AND domain).
    const allowedEmails = parseCsv(policy.allowedEmails).map((entry) => entry.toLowerCase());
    const allowedDomainsConfigured = parseCsv(policy.allowedDomains).length > 0;
    if (policy.requireAllowlist && allowedEmails.length === 0 && !allowedDomainsConfigured) return false;
    if (allowedEmails.length > 0 && !allowedEmails.includes(email)) return false;

    const allowedDomains = parseCsv(policy.allowedDomains).map((entry) => entry.toLowerCase());
    if (allowedDomains.length === 0) return true;

    const hostedDomain = typeof profile?.hd === "string" ? profile.hd.trim().toLowerCase() : "";
    return allowedDomains.includes(hostedDomain);
}

export function authRuntimeMode(env: AuthEnvironment = process.env): AuthRuntimeMode {
    const authValues = [
        env.AUTH_SECRET?.trim(),
        env.AUTH_GOOGLE_ID?.trim(),
        env.AUTH_GOOGLE_SECRET?.trim(),
    ];
    if (authValues.every(Boolean)) {
        // Production never runs with open sign-up: without an invite list any
        // verified Google account could create an account.
        if (env.NODE_ENV === "production" && !hasAccessAllowlist(env)) return "invalid";
        return "configured";
    }

    const authIsAbsent = authValues.every((value) => !value);
    const localBypassEnabled = env.AUTH_LOCAL_DEV_BYPASS?.trim() === "1";
    const localUserId = env.AUTH_LOCAL_DEV_USER_ID?.trim();
    if (
        authIsAbsent
        && env.NODE_ENV !== "production"
        && localBypassEnabled
        && localUserId
    ) {
        return "local-bypass";
    }

    return "invalid";
}

export function hasAccessAllowlist(env: AuthEnvironment = process.env): boolean {
    return parseCsv(env.AUTH_ALLOWED_EMAILS).length > 0 || parseCsv(env.AUTH_ALLOWED_DOMAINS).length > 0;
}

export function isAuthConfigured(env: AuthEnvironment = process.env): boolean {
    return authRuntimeMode(env) === "configured";
}

export function getLocalDevUserId(env: AuthEnvironment = process.env): string | null {
    if (authRuntimeMode(env) !== "local-bypass") return null;
    return env.AUTH_LOCAL_DEV_USER_ID?.trim() || null;
}

function parseCsv(value: string | undefined): string[] {
    return (value ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}
