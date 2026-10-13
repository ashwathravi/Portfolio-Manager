type DatabaseSslMode = false | "require";

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

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
