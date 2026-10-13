import './load-env';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

// Migrations run as the table owner (DATABASE_MIGRATION_URL), not as the
// app's least-privilege login in DATABASE_URL, which cannot run DDL.
async function main() {
    const url = process.env.DATABASE_MIGRATION_URL?.trim() || process.env.DATABASE_URL?.trim();
    if (!url) {
        console.error('❌ Set DATABASE_MIGRATION_URL (or DATABASE_URL) to the owner connection.');
        process.exit(1);
    }

    const client = postgres(url, { max: 1, onnotice: () => {} });
    console.log('⏳ Running migrations...');
    try {
        await migrate(drizzle(client), { migrationsFolder: 'drizzle' });
        console.log('✅ Migrations applied successfully!');
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exitCode = 1;
    } finally {
        await client.end();
    }
}

main();
