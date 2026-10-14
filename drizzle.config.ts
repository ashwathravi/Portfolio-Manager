import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

// Same precedence as Next.js: .env.local wins over .env.
dotenv.config({ path: [".env.local", ".env"], quiet: true });

// Migrations need the table owner. The app's DATABASE_URL is a least-privilege
// login role (member of app_runtime) that cannot run DDL, so migrations use
// DATABASE_MIGRATION_URL when it is set.
const migrationUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;

if (!migrationUrl) {
    console.warn("⚠️ Neither DATABASE_MIGRATION_URL nor DATABASE_URL is set");
}

export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
        url: migrationUrl!,
    },
    verbose: true,
    strict: true,
});
