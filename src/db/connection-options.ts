type DatabaseSslMode = false | "require";

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Pool settings for serverless functions behind the Supavisor transaction
 * pooler: a few connections per instance, released after 20s idle so warm
 * instances don't hold pooler slots, and recycled every 30 minutes.
 */
export const DATABASE_POOL_OPTIONS = {
    max: 5,
    idle_timeout: 20,
    max_lifetime: 30 * 60,
} as const;

/**
 * True only for a well-formed URL whose host is the loopback interface.
 * Scripts that create users or wipe data refuse to run unless this holds, so
 * a production URL left in an env file can never be touched by them.
 */
export function isLocalDatabaseUrl(connectionString: string | undefined): boolean {
    if (!connectionString) {
        return false;
    }

    try {
        return LOCAL_DATABASE_HOSTS.has(new URL(connectionString).hostname.toLowerCase());
    } catch {
        return false;
    }
}

/**
 * The connection string to build the client from, or undefined when there is
 * no usable one. A value that isn't a URL counts as missing instead of being
 * thrown on: the deploy pipeline builds the app with variables pulled from
 * Vercel, which hands Sensitive ones over as a "[SENSITIVE]" placeholder (the
 * real value only exists at runtime), and the build loads this module.
 */
export function usableDatabaseUrl(connectionString: string | undefined): string | undefined {
    const value = connectionString?.trim();
    if (!value) {
        return undefined;
    }

    try {
        new URL(value);
        return value;
    } catch {
        return undefined;
    }
}

export function resolveDatabaseSslMode(connectionString: string | undefined): DatabaseSslMode {
    if (!connectionString) {
        return "require";
    }

    try {
        const parsed = new URL(connectionString);
        if (parsed.searchParams.get("sslmode") === "disable") {
            return false;
        }

        if (LOCAL_DATABASE_HOSTS.has(parsed.hostname.toLowerCase())) {
            return false;
        }
    } catch {
        return "require";
    }

    return "require";
}
