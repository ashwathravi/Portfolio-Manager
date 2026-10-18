import "../load-env";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { isLocalDatabaseUrl } from "../../src/db/connection-options";

/**
 * Runs before `npm run db:migrate`. On a local database, applies
 * scripts/db/init-local.sql, which migrations expect and Supabase provides:
 * the pgcrypto extension and the anon/authenticated roles. The Docker
 * container no longer does this when its volume is created (see
 * docker-compose.yml), so a fresh volume needs it here.
 *
 * Any other database is left alone. Uses the same URL as drizzle.config.ts.
 */
async function main() {
    const url = process.env.DATABASE_MIGRATION_URL?.trim() || process.env.DATABASE_URL?.trim();
    if (!url || !isLocalDatabaseUrl(url)) {
        return;
    }

    const owner = postgres(url, { max: 1, onnotice: () => {} });
    try {
        await owner.unsafe(readFileSync("scripts/db/init-local.sql", "utf8")).simple();
    } finally {
        await owner.end();
    }
}

main().catch((error) => {
    console.error("❌ Could not prepare the local database for migrations:", error);
    process.exit(1);
});
