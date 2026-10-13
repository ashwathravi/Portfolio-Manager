import "./load-env";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { isLocalDatabaseUrl } from "../src/db/connection-options";
import { buildEnsureAppLoginRoleSql, readDatabaseLogin } from "../src/db/roles";

/**
 * Prepares the local Docker database (`npm run db:up`) for `npm run dev`:
 * applies migrations as the owner, creates the app's login role as a member
 * of app_runtime, and creates the local dev user. `npm run db:setup` then
 * seeds that user's example portfolios.
 *
 * Refuses to run unless both URLs point at the loopback interface, so a
 * production URL left in an env file is never touched.
 */
async function main() {
    const appUrl = process.env.DATABASE_URL?.trim();
    const migrationUrl = process.env.DATABASE_MIGRATION_URL?.trim() || appUrl;
    const devUserId = process.env.AUTH_LOCAL_DEV_USER_ID?.trim();

    if (!appUrl || !migrationUrl || !isLocalDatabaseUrl(appUrl) || !isLocalDatabaseUrl(migrationUrl)) {
        console.error(
            "db:setup only runs against the local Docker database. Set DATABASE_URL and "
            + "DATABASE_MIGRATION_URL in .env.local to the local values in .env.example, then run npm run db:up.",
        );
        process.exit(1);
    }

    const owner = postgres(migrationUrl, { max: 1, onnotice: () => {} });
    try {
        console.log("⏳ Applying migrations…");
        await migrate(drizzle(owner), { migrationsFolder: "drizzle" });

        const app = readDatabaseLogin(appUrl);
        const ownerLogin = readDatabaseLogin(migrationUrl);
        if (app.user === ownerLogin.user) {
            console.warn(
                "⚠️ DATABASE_URL connects as the table owner. Production connects as a member of app_runtime; "
                + "use the separate app login from .env.example to catch missing grants locally.",
            );
        } else {
            await owner.unsafe(buildEnsureAppLoginRoleSql(app.user, app.password)).simple();
            console.log(`✅ ${app.user} can log in and is a member of app_runtime`);
        }

        if (devUserId) {
            await owner`
                INSERT INTO auth_users (id, name, email, email_verified)
                VALUES (${devUserId}, 'Local Dev', ${`local-dev-${devUserId}@example.test`}, now())
                ON CONFLICT (id) DO NOTHING
            `;
            console.log(`✅ Local dev user ${devUserId} exists`);
        } else {
            console.warn("⚠️ AUTH_LOCAL_DEV_USER_ID is not set, so no local dev user was created and the seed step will stop.");
        }
    } finally {
        await owner.end();
    }
}

main().catch((error) => {
    console.error("❌ Local database setup failed:", error);
    process.exit(1);
});
