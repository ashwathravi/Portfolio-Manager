
import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from '../src/db';

async function main() {
    console.log('⏳ Running migrations...');
    try {
        // This will look for the 'drizzle' folder (default output of generate)
        await migrate(db, { migrationsFolder: 'drizzle' });
        console.log('✅ Migrations applied successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

main();
