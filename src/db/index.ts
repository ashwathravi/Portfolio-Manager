
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { warnIfUnsafeProductionDatabaseUrl } from "@/lib/security/production-env";
import { DATABASE_POOL_OPTIONS, resolveDatabaseSslMode, usableDatabaseUrl } from "./connection-options";
import { unconfiguredDatabaseOptions } from "./unconfigured-client";

warnIfUnsafeProductionDatabaseUrl(process.env.DATABASE_URL);
const connectionString = usableDatabaseUrl(process.env.DATABASE_URL);

if (!connectionString) {
    // We don't throw here so the build can run without a database URL (or
    // with Vercel's "[SENSITIVE]" placeholder for one).
    console.warn("⚠️ DATABASE_URL is missing or not a URL. Database queries will fail without connecting.");
}

// Disable prefetch as it is not supported for "Transaction" pool mode
const postgresOptions: postgres.Options<Record<string, never>> = {
    prepare: false,
    ssl: resolveDatabaseSslMode(connectionString),
    connect_timeout: 10,
    ...DATABASE_POOL_OPTIONS,
};

// Without a URL, never postgres(postgresOptions): it would fall back to
// PGHOST/PGPORT or localhost:5432 and connect to whatever answers there.
const client = connectionString
    ? postgres(connectionString, postgresOptions)
    : postgres({ ...postgresOptions, ...unconfiguredDatabaseOptions() });
export const db = drizzle(client, { schema });
