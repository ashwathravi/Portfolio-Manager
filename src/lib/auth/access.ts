export interface GoogleAuthProfile {
    email?: unknown;
    email_verified?: unknown;
    hd?: unknown;
}

export interface GoogleAccessPolicy {
    allowedEmails?: string;
    allowedDomains?: string;
}

export interface AuthEnvironment {
    NODE_ENV?: string;
    AUTH_SECRET?: string;
    AUTH_GOOGLE_ID?: string;
    AUTH_GOOGLE_SECRET?: string;
    AUTH_LOCAL_DEV_BYPASS?: string;
    AUTH_LOCAL_DEV_USER_ID?: string;
    INTERNAL_API_SECRET?: string;
}

export type AuthRuntimeMode = "configured" | "local-bypass" | "invalid";

export function isGoogleProfileAllowed(
    profile: GoogleAuthProfile | undefined,
    policy: GoogleAccessPolicy = {
        allowedEmails: process.env.AUTH_ALLOWED_EMAILS,
        allowedDomains: process.env.AUTH_ALLOWED_DOMAINS,
    },
): boolean {
    const email = typeof profile?.email === "string" ? profile.email.trim().toLowerCase() : "";
    const emailVerified = profile?.email_verified === true;
    if (!email || !emailVerified) return false;

    const allowedEmails = parseCsv(policy.allowedEmails).map((entry) => entry.toLowerCase());
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
    if (authValues.every(Boolean)) return "configured";

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
