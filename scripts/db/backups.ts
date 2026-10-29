import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";

/**
 * Shared by the nightly backup (scripts/db/backup.ts) and the restore
 * (scripts/db/restore.ts); see docs/backups.md (launch item i68).
 *
 * A backup is a directory holding:
 *   data.dump      pg_dump --data-only of the public schema (custom format):
 *                  what a restore loads, in foreign-key order
 *   schema.dump    pg_dump --schema-only of public and drizzle: the schema as
 *                  the database really had it, grants and policies included,
 *                  for reference if it ever differs from the migrations
 *   manifest.json  the migrations applied and every table's exact row count,
 *                  read in the same snapshot as both dumps
 */

export const DATA_DUMP = "data.dump";
export const SCHEMA_DUMP = "schema.dump";
export const MANIFEST = "manifest.json";

const fileEntry = z.strictObject({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int().nonnegative(),
});

const migrationEntry = z.strictObject({
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    createdAt: z.number().int().positive(),
});

export const manifestSchema = z.strictObject({
    format: z.literal(1),
    createdAt: z.iso.datetime(),
    /** The commit that ran the backup; its migrations folder restores it. */
    commit: z.string().nullable(),
    serverVersion: z.string(),
    pgDumpVersion: z.string(),
    /** drizzle.__drizzle_migrations, oldest first. */
    migrations: z.array(migrationEntry).min(1),
    /** Exact row count of every table in the public schema. */
    tables: z.record(z.string(), z.number().int().nonnegative()),
    files: z.strictObject({
        [DATA_DUMP]: fileEntry,
        [SCHEMA_DUMP]: fileEntry,
    }),
});

export type BackupManifest = z.infer<typeof manifestSchema>;
export type AppliedMigration = z.infer<typeof migrationEntry>;

export function readManifest(dir: string): BackupManifest {
    const path = join(dir, MANIFEST);
    if (!existsSync(path)) {
        throw new Error(`No ${MANIFEST} in ${dir}: is this a decrypted backup?`);
    }
    return manifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** libpq's environment for a connection string, so no password is ever an argument. */
const QUERY_ENV: Record<string, string> = {
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    connect_timeout: "PGCONNECT_TIMEOUT",
    application_name: "PGAPPNAME",
};

export function connectionEnv(connectionString: string): Record<string, string> {
    let url: URL;
    try {
        url = new URL(connectionString);
    } catch {
        throw new Error("The connection string isn't a URL.");
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
        throw new Error("The connection string must start with postgres:// or postgresql://.");
    }
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!url.hostname || !url.username || !database) {
        throw new Error("The connection string needs a host, a user and a database.");
    }

    const env: Record<string, string> = {
        PGHOST: url.hostname.replace(/^\[(.*)\]$/, "$1"),
        PGPORT: url.port || "5432",
        PGUSER: decodeURIComponent(url.username),
        PGDATABASE: database,
    };
    if (url.password) {
        env.PGPASSWORD = decodeURIComponent(url.password);
    }
    for (const [key, value] of url.searchParams) {
        const name = QUERY_ENV[key];
        if (!name) {
            throw new Error(`The connection string has a parameter the backup scripts don't pass on: ${key}.`);
        }
        env[name] = value;
    }
    return env;
}

/** The major version in `pg_dump --version` output, e.g. "pg_dump (PostgreSQL) 17.6 (Ubuntu 17.6-1)". */
export function toolMajorVersion(output: string): number {
    const match = /\(PostgreSQL\)\s+(\d+)/.exec(output);
    if (!match) {
        throw new Error(`Couldn't read a PostgreSQL version from: ${output.trim()}`);
    }
    return Number(match[1]);
}

/**
 * Where pg_dump and pg_restore are: PG_BIN_DIR when set, else the PATH, else
 * Homebrew's libpq, which is keg-only and not on the PATH (`brew install libpq`).
 */
export function pgToolPath(
    tool: "pg_dump" | "pg_restore",
    env: Record<string, string | undefined> = process.env,
    kegs: string[] = ["/opt/homebrew/opt/libpq/bin", "/usr/local/opt/libpq/bin"],
): string {
    const dir = env.PG_BIN_DIR?.trim();
    if (dir) {
        return join(dir, tool);
    }
    for (const entry of (env.PATH ?? "").split(":")) {
        if (entry && existsSync(join(entry, tool))) {
            return join(entry, tool);
        }
    }
    for (const keg of kegs) {
        if (existsSync(join(keg, tool))) {
            return join(keg, tool);
        }
    }
    throw new Error(`${tool} not found. Install the PostgreSQL client (brew install libpq) or set PG_BIN_DIR.`);
}

/** Runs a PostgreSQL client tool, rejecting with its stderr when it fails. */
export function runPgTool(
    path: string,
    args: string[],
    connection: Record<string, string>,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(path, args, {
            env: { ...process.env, ...connection },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                const tool = path.split("/").pop();
                reject(new Error(`${tool} exited with ${code}${stderr.trim() ? `:\n${stderr.trim()}` : ""}`));
            }
        });
    });
}

export function sha256File(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash("sha256");
        createReadStream(path)
            .on("data", (chunk) => hash.update(chunk))
            .on("error", reject)
            .on("end", () => resolve(hash.digest("hex")));
    });
}

export interface JournalEntry {
    idx: number;
    when: number;
    tag: string;
    [key: string]: unknown;
}

/**
 * The checkout's migrations that rebuild the backup's schema: the first
 * `applied.length` journal entries, each with the timestamp and the SQL hash
 * the database recorded when it ran them (drizzle hashes the whole file).
 * Throws when the checkout can't: a migration it doesn't have, or one whose
 * file has changed since.
 */
export function migrationsToRestore(
    journal: JournalEntry[],
    hashOf: (tag: string) => string,
    applied: AppliedMigration[],
    commit: string | null,
): JournalEntry[] {
    const checkout = commit ? ` Check out ${commit}, the commit that made the backup, and restore from there.` : "";
    if (applied.length > journal.length) {
        throw new Error(
            `The backup has ${applied.length} migrations applied and this checkout only has ${journal.length}.${checkout}`,
        );
    }
    applied.forEach((migration, index) => {
        const entry = journal[index];
        if (entry.when !== migration.createdAt || hashOf(entry.tag) !== migration.hash) {
            throw new Error(
                `Migration ${index + 1} in the backup (recorded at ${migration.createdAt}) isn't ${entry.tag} as this checkout has it.${checkout}`,
            );
        }
    });
    return journal.slice(0, applied.length);
}

export interface RestoredState {
    migrations: AppliedMigration[];
    tables: Record<string, number>;
}

/** Every way the restored database differs from the backup, or none. */
export function compareRestore(manifest: BackupManifest, restored: RestoredState): string[] {
    const problems: string[] = [];

    const expected = manifest.migrations.map((m) => `${m.createdAt}:${m.hash}`).join(",");
    const actual = restored.migrations.map((m) => `${m.createdAt}:${m.hash}`).join(",");
    if (expected !== actual) {
        problems.push(
            `Migrations: the backup has ${manifest.migrations.length} and the restored database has ${restored.migrations.length}, or they differ.`,
        );
    }

    const names = [...new Set([...Object.keys(manifest.tables), ...Object.keys(restored.tables)])].sort();
    for (const name of names) {
        const want = manifest.tables[name];
        const got = restored.tables[name];
        if (want === undefined) {
            problems.push(`Table ${name} is in the restored database but not in the backup.`);
        } else if (got === undefined) {
            problems.push(`Table ${name} is in the backup but not in the restored database.`);
        } else if (want !== got) {
            problems.push(`Table ${name}: ${want} rows in the backup, ${got} restored.`);
        }
    }
    return problems;
}

/**
 * One line for logs. Totals only: the workflow's logs are public, and so is
 * which tables hold how many rows.
 */
export function describeBackup(manifest: Pick<BackupManifest, "tables" | "migrations">): string {
    const tables = Object.keys(manifest.tables).length;
    const rows = Object.values(manifest.tables).reduce((sum, count) => sum + count, 0);
    return `${tables} tables, ${rows.toLocaleString("en-US")} rows, ${manifest.migrations.length} migrations`;
}
