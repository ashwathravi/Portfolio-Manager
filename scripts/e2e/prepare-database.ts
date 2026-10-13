import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { isLocalDatabaseUrl } from "../../src/db/connection-options";
import { buildEnsureAppLoginRoleSql, readDatabaseLogin } from "../../src/db/roles";

/**
 * Builds a disposable E2E database. Used by CI and by `npm run test:e2e:local`.
 *
 *   ADMIN_DATABASE_URL  the table owner: applies migrations and fixtures
 *   APP_DATABASE_URL    the login the app server uses; created here as a
 *                       member of app_runtime, so E2E exercises the same
 *                       grants and RLS policies as production
 *
 * Deliberately reads no .env file, and refuses any non-loopback URL.
 */
async function main() {
    const adminUrl = process.env.ADMIN_DATABASE_URL?.trim();
    const appUrl = process.env.APP_DATABASE_URL?.trim();
    if (!adminUrl || !appUrl || !isLocalDatabaseUrl(adminUrl) || !isLocalDatabaseUrl(appUrl)) {
        console.error("Set ADMIN_DATABASE_URL and APP_DATABASE_URL to a disposable database on localhost.");
        process.exit(1);
    }

    const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
    try {
        // The extension and the Supabase roles that migration 0008 names.
        await admin.unsafe(readFileSync("scripts/db/init-local.sql", "utf8")).simple();

        console.log("⏳ Applying migrations…");
        await migrate(drizzle(admin), { migrationsFolder: "drizzle" });

        const app = readDatabaseLogin(appUrl);
        await admin.unsafe(buildEnsureAppLoginRoleSql(app.user, app.password)).simple();

        console.log("⏳ Loading fixtures…");
        await admin.unsafe(readFileSync("scripts/e2e/fixtures.sql", "utf8")).simple();

        // The seed script must create exactly the owner's three portfolios, and
        // it runs as the app login, so this also proves the runtime grants work.
        await admin`
            INSERT INTO auth_users (id, name, email, email_verified)
            VALUES ('e2e-seed-owner', 'E2E Seed Owner', 'e2e-seed@example.test', now())
        `;
        const seed = spawnSync(process.execPath, ["--import", "tsx", "scripts/seed.ts"], {
            env: { ...process.env, DATABASE_URL: appUrl, SEED_USER_ID: "e2e-seed-owner" },
            stdio: "inherit",
        });
        if (seed.status !== 0) {
            throw new Error("The owner-scoped seed failed when run as the app login.");
        }
        const [{ count }] = await admin<{ count: number }[]>`
            SELECT count(*)::int AS count FROM portfolios WHERE user_id = 'e2e-seed-owner'
        `;
        if (count !== 3) {
            throw new Error(`The owner-scoped seed created ${count} portfolios instead of 3.`);
        }
        await admin`DELETE FROM portfolios WHERE user_id = 'e2e-seed-owner'`;
        await admin`DELETE FROM auth_users WHERE id = 'e2e-seed-owner'`;

        console.log(`✅ E2E database ready; the app connects as ${app.user}`);
    } finally {
        await admin.end();
    }
}

main().catch((error) => {
    console.error("❌ E2E database preparation failed:", error);
    process.exit(1);
});
