
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    // We don't throw error here to allow build process to run without env vars
    console.warn("⚠️ DATABASE_URL not found. Database features will not work.");
}

// Disable prefetch as it is not supported for "Transaction" pool mode
const postgresOptions: postgres.Options<{}> = {
    prepare: false,
    ssl: 'require',
    connect_timeout: 10,
};

const client = connectionString
    ? postgres(connectionString, postgresOptions)
    : postgres(postgresOptions);
export const db = drizzle(client, { schema });
