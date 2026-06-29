export interface GoogleAuthProfile {
    email?: unknown;
    email_verified?: unknown;
    hd?: unknown;
}

export interface GoogleAccessPolicy {
    allowedEmails?: string;
    allowedDomains?: string;
}

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

export function isAuthConfigured(): boolean {
    return Boolean(
        process.env.AUTH_SECRET?.trim()
        && process.env.AUTH_GOOGLE_ID?.trim()
        && process.env.AUTH_GOOGLE_SECRET?.trim(),
    );
}

function parseCsv(value: string | undefined): string[] {
    return (value ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}
