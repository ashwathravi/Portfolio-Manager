import postgres from "postgres";

import { backupRunFromEnv, recordBackupRun } from "./backups";

/**
 * Records the nightly backup's run in job_runs, as the workflow's last step
 * (.github/workflows/database-backup.yml):
 *
 *   DATABASE_MIGRATION_URL=… BACKUP_STATUS=succeeded|failed BACKUP_STARTED_AT=<ISO time> \
 *     [BACKUP_RUN_URL=…] node --import tsx scripts/db/record-backup-run.ts
 *
 * /api/health/jobs reads it, so the production monitor notices a backup that
 * failed or stopped running (launch item i71). Reads no .env file.
 */
async function main() {
    const url = process.env.DATABASE_MIGRATION_URL?.trim();
    if (!url) {
        console.error("Usage: DATABASE_MIGRATION_URL=postgres://… BACKUP_STATUS=… BACKUP_STARTED_AT=… node --import tsx scripts/db/record-backup-run.ts");
        process.exit(2);
    }
    const run = backupRunFromEnv(process.env);

    const sql = postgres(url, { max: 1, onnotice: () => {} });
    try {
        await recordBackupRun(sql, run);
        console.log(`✅ Recorded the backup run as ${run.status}.`);
    } finally {
        await sql.end();
    }
}

main().catch((error) => {
    console.error("❌ Could not record the backup run:", error instanceof Error ? error.message : error);
    process.exit(1);
});
