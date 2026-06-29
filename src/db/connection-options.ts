type DatabaseSslMode = false | "require";

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

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
