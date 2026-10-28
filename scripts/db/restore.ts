import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
    compareRestore,
    connectionEnv,
    DATA_DUMP,
    describeBackup,
    migrationsToRestore,
    pgToolPath,
    readManifest,
    runPgTool,
    SCHEMA_DUMP,
    sha256File,
    type JournalEntry,
} from "./backups";

/**
 * Restores a decrypted backup (see scripts/db/backup.ts) into an empty
 * database and checks it:
 *
 *   RESTORE_DATABASE_URL=postgres://… node --import tsx scripts/db/restore.ts --from <dir>
 *
 * 1. Refuses a database that already has tables in public or applied
 *    migrations, so it can never write over live data.
 * 2. Checks both dumps against the manifest's hashes.
 * 3. Rebuilds the schema with this checkout's migrations, exactly the ones the
 *    backup had applied (refusing if the checkout doesn't have them), so the
 *    grants, policies and the app_runtime role are what the code expects.
 * 4. Loads the data in one transaction, foreign keys checked.
 * 5. Compares every table's row count and the migrations with the manifest,
 *    and exits 1 on any difference.
 *
 * The nightly workflow runs this into a scratch Postgres after every backup;
 * docs/backups.md has the drill and the steps for a real recovery. Connect as
 * the owner the app's tables should have (postgres on Supabase). Reads no
 * .env file.
 */
async function main() {
    const targetUrl = process.env.RESTORE_DATABASE_URL?.trim();
    const fromIndex = process.argv.indexOf("--from");
    const from = fromIndex === -1 ? undefined : process.argv[fromIndex + 1];
    if (!targetUrl || !from) {
        console.error("Usage: RESTORE_DATABASE_URL=postgres://… node --import tsx scripts/db/restore.ts --from <dir>");
        process.exit(2);
    }

    const manifest = readManifest(from);
    const connection = connectionEnv(targetUrl);
    const pgRestore = pgToolPath("pg_restore");

    for (const file of [DATA_DUMP, SCHEMA_DUMP] as const) {
        if ((await sha256File(join(from, file))) !== manifest.files[file].sha256) {
            throw new Error(`${file} doesn't match the hash in the manifest: the backup is damaged or incomplete.`);
        }
    }

    const journalPath = join("drizzle", "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: JournalEntry[] };
    const sqlOf = (tag: string) => readFileSync(join("drizzle", `${tag}.sql`), "utf8");
    const entries = migrationsToRestore(
        journal.entries,
        (tag) => createHash("sha256").update(sqlOf(tag)).digest("hex"),
        manifest.migrations,
        manifest.commit,
    );

    const sql = postgres(targetUrl, { max: 1, onnotice: () => {} });
    const folder = mkdtempSync(join(tmpdir(), "atlas-restore-migrations-"));
    try {
        const [{ tables, migrated }] = await sql<{ tables: number; migrated: boolean }[]>`
            SELECT (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS tables,
                   to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS migrated
        `;
        if (tables > 0 || migrated) {
            throw new Error("The target database isn't empty (it has tables in public, or applied migrations). Restore into a new database.");
        }

        // What Supabase provides and the migrations expect; a no-op there.
        await sql.unsafe(readFileSync(join("scripts", "db", "init-local.sql"), "utf8")).simple();

        // drizzle applies every migration in a folder, so give it only the
        // backup's: the journal cut to them, and their files.
        mkdirSync(join(folder, "meta"));
        writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
        for (const entry of entries) {
            copyFileSync(join("drizzle", `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
        }
        await migrate(drizzle(sql), { migrationsFolder: folder });

        await runPgTool(
            pgRestore,
            ["--single-transaction", "--exit-on-error", "--no-owner", "--no-privileges", "--no-password", `--dbname=${connection.PGDATABASE}`, join(from, DATA_DUMP)],
            connection,
        );

        const migrations = await sql<{ hash: string; createdAt: string }[]>`
            SELECT hash, created_at::text AS "createdAt" FROM drizzle.__drizzle_migrations ORDER BY created_at, id
        `;
        const names = await sql<{ name: string }[]>`
            SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
        `;
        const restored: Record<string, number> = {};
        for (const { name } of names) {
            const [{ count }] = await sql<{ count: string }[]>`SELECT count(*)::text AS count FROM public.${sql(name)}`;
            restored[name] = Number(count);
        }

        const problems = compareRestore(manifest, {
            migrations: migrations.map((m) => ({ hash: m.hash, createdAt: Number(m.createdAt) })),
            tables: restored,
        });
        if (problems.length > 0) {
            console.error(`❌ The restored database doesn't match the backup from ${manifest.createdAt}:`);
            for (const problem of problems) {
                console.error(`   - ${problem}`);
            }
            process.exitCode = 1;
            return;
        }
        console.log(`✅ Restored the backup from ${manifest.createdAt}: ${describeBackup(manifest)}. Every table matches.`);
    } finally {
        rmSync(folder, { recursive: true, force: true });
        await sql.end();
    }
}

main().catch((error) => {
    console.error("❌ Restore failed:", error instanceof Error ? error.message : error);
    process.exit(1);
});
