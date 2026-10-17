
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { warnIfUnsafeProductionDatabaseUrl } from "@/lib/security/production-env";
import { DATABASE_POOL_OPTIONS, resolveDatabaseSslMode, usableDatabaseUrl } from "./connection-options";

warnIfUnsafeProductionDatabaseUrl(process.env.DATABASE_URL);
const connectionString = usableDatabaseUrl(process.env.DATABASE_URL);

if (!connectionString) {
    // We don't throw here so the build can run without a database URL (or
    // with Vercel's "[SENSITIVE]" placeholder for one).
    console.warn("⚠️ DATABASE_URL is missing or not a URL. Database features will not work.");
}

// Disable prefetch as it is not supported for "Transaction" pool mode
const postgresOptions: postgres.Options<Record<string, never>> = {
    prepare: false,
    ssl: resolveDatabaseSslMode(connectionString),
    connect_timeout: 10,
    ...DATABASE_POOL_OPTIONS,
};

const client = connectionString
    ? postgres(connectionString, postgresOptions)
    : postgres(postgresOptions);
export const db = drizzle(client, { schema });
