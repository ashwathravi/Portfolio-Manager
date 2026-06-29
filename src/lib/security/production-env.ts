export interface ProductionDatabaseWarningInput {
    nodeEnv?: string;
    databaseUrl?: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres", "db"]);
const LOCAL_USERNAMES = new Set(["postgres", "user", "admin"]);

export function productionDatabaseCredentialWarnings({
    nodeEnv = process.env.NODE_ENV,
    databaseUrl = process.env.DATABASE_URL,
}: ProductionDatabaseWarningInput = {}): string[] {
    if (nodeEnv !== "production") return [];

    const value = databaseUrl?.trim();
    if (!value) {
        return ["DATABASE_URL is missing in production."];
    }

    try {
        const parsed = new URL(value);
        const warnings: string[] = [];
        if (LOCAL_HOSTS.has(parsed.hostname)) {
            warnings.push("DATABASE_URL points at a local-style host in production.");
        }
        if (LOCAL_USERNAMES.has(decodeURIComponent(parsed.username))) {
            warnings.push("DATABASE_URL uses a local-style database username in production.");
        }
        if (parsed.searchParams.get("sslmode") === "disable") {
            warnings.push("DATABASE_URL disables SSL in production.");
        }
        return warnings;
    } catch {
        return ["DATABASE_URL is not a valid connection URL in production."];
    }
}

export function warnIfUnsafeProductionDatabaseUrl(databaseUrl = process.env.DATABASE_URL): void {
    for (const warning of productionDatabaseCredentialWarnings({ databaseUrl })) {
        console.warn(`Production secret configuration warning: ${warning} Use a managed secrets store and a production database credential.`);
    }
}
