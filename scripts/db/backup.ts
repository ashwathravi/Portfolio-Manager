import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import {
    connectionEnv,
    DATA_DUMP,
    describeBackup,
    MANIFEST,
    manifestSchema,
    pgToolPath,
    runPgTool,
    SCHEMA_DUMP,
    sha256File,
    toolMajorVersion,
    type BackupManifest,
} from "./backups";

/**
 * Backs up the database at BACKUP_SOURCE_URL into a new directory:
 *
 *   BACKUP_SOURCE_URL=postgres://… node --import tsx scripts/db/backup.ts --out <dir>
 *
 * Read-only. One repeatable-read transaction exports its snapshot, counts
 * every table in it, and both pg_dumps run on that snapshot, so the counts are
 * exactly what the dumps hold even while the app keeps writing. The nightly
 * workflow (.github/workflows/database-backup.yml) runs it against production;
 * see docs/backups.md. Reads no .env file: the source is always explicit.
 */
async function main() {
    const sourceUrl = process.env.BACKUP_SOURCE_URL?.trim();
    const outIndex = process.argv.indexOf("--out");
    const out = outIndex === -1 ? undefined : process.argv[outIndex + 1];
    if (!sourceUrl || !out) {
        console.error("Usage: BACKUP_SOURCE_URL=postgres://… node --import tsx scripts/db/backup.ts --out <dir>");
        process.exit(2);
    }
    if (existsSync(out) && readdirSync(out).length > 0) {
        console.error(`❌ ${out} isn't empty; a backup goes into a new directory.`);
        process.exit(2);
    }
    mkdirSync(out, { recursive: true });

    const connection = connectionEnv(sourceUrl);
    const pgDump = pgToolPath("pg_dump");
    const pgDumpVersion = (await runPgTool(pgDump, ["--version"], {})).trim();

    const sql = postgres(sourceUrl, { max: 1, onnotice: () => {} });
    try {
        // One connection holds the snapshot's transaction open until both
        // pg_dumps have imported it. Ending the client rolls it back on failure.
        const tx = await sql.reserve();
        await tx`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`;
        await tx`SET LOCAL idle_in_transaction_session_timeout = 0`;
        const [{ snapshot }] = await tx<{ snapshot: string }[]>`SELECT pg_export_snapshot() AS snapshot`;

        const [{ version, versionNum }] = await tx<{ version: string; versionNum: number }[]>`
            SELECT current_setting('server_version') AS version,
                   current_setting('server_version_num')::int AS "versionNum"
        `;
        const serverMajor = Math.floor(versionNum / 10000);
        if (toolMajorVersion(pgDumpVersion) < serverMajor) {
            throw new Error(`${pgDumpVersion} can't dump a PostgreSQL ${serverMajor} server; use pg_dump ${serverMajor} or newer.`);
        }

        const migrations = await tx<{ hash: string; createdAt: string }[]>`
            SELECT hash, created_at::text AS "createdAt"
            FROM drizzle.__drizzle_migrations
            ORDER BY created_at, id
        `;

        const names = await tx<{ name: string }[]>`
            SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
        `;
        const tables: Record<string, number> = {};
        for (const { name } of names) {
            const [{ count }] = await tx<{ count: string }[]>`SELECT count(*)::text AS count FROM public.${tx(name)}`;
            tables[name] = Number(count);
        }

        const common = ["--format=custom", `--snapshot=${snapshot}`, "--no-password"];
        await runPgTool(pgDump, [...common, "--data-only", "--schema=public", `--file=${join(out, DATA_DUMP)}`], connection);
        await runPgTool(
            pgDump,
            [...common, "--schema-only", "--schema=public", "--schema=drizzle", `--file=${join(out, SCHEMA_DUMP)}`],
            connection,
        );

        const manifest: BackupManifest = {
            format: 1,
            createdAt: new Date().toISOString(),
            commit: process.env.GITHUB_SHA?.trim() || null,
            serverVersion: version,
            pgDumpVersion,
            migrations: migrations.map((m) => ({ hash: m.hash, createdAt: Number(m.createdAt) })),
            tables,
            files: {
                [DATA_DUMP]: { sha256: await sha256File(join(out, DATA_DUMP)), bytes: statSync(join(out, DATA_DUMP)).size },
                [SCHEMA_DUMP]: { sha256: await sha256File(join(out, SCHEMA_DUMP)), bytes: statSync(join(out, SCHEMA_DUMP)).size },
            },
        };
        await tx`COMMIT`;
        tx.release();

        writeFileSync(join(out, MANIFEST), `${JSON.stringify(manifestSchema.parse(manifest), null, 2)}\n`);
        console.log(`✅ Backed up ${describeBackup(manifest)} (PostgreSQL ${manifest.serverVersion}).`);
    } finally {
        await sql.end();
    }
}

main().catch((error) => {
    console.error("❌ Backup failed:", error instanceof Error ? error.message : error);
    process.exit(1);
});
