
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    // We don't throw error here to allow build process to run without env vars
    console.warn("⚠️ DATABASE_URL not found. Database features will not work.");
}

// Disable prefetch as it is not supported for "Transaction" pool mode
const client = postgres(connectionString || "postgres://localhost:5432/postgres", { prepare: false, ssl: 'require' });
export const db = drizzle(client, { schema });
