import { describe, test } from "node:test";
import assert from "node:assert";
import postgres from "postgres";
import {
    DATABASE_POOL_OPTIONS,
    MAX_RECONNECT_BACKOFF_SECONDS,
    databaseReconnectBackoff,
    isDatabaseConfigured,
    isLocalDatabaseUrl,
    resolveDatabaseSslMode,
    usableDatabaseUrl,
} from "./connection-options.ts";

describe("resolveDatabaseSslMode", () => {
    test("requires SSL when no database URL is configured", () => {
        assert.strictEqual(resolveDatabaseSslMode(undefined), "require");
    });

    test("requires SSL for hosted database URLs", () => {
        assert.strictEqual(
            resolveDatabaseSslMode("postgres://atlas_app:secret@db.example.com:5432/app?sslmode=require"),
            "require",
        );
    });

    test("disables SSL for explicit local test database URLs", () => {
        assert.strictEqual(
            resolveDatabaseSslMode("postgres://postgres:postgres@localhost:5432/app?sslmode=disable"),
            false,
        );
    });

    test("disables SSL for loopback hosts even without sslmode", () => {
        assert.strictEqual(
            resolveDatabaseSslMode("postgres://postgres:postgres@127.0.0.1:5432/app"),
            false,
        );
    });
});

describe("usableDatabaseUrl", () => {
    test("keeps a connection URL", () => {
        const url = "postgres://atlas_app.ref:secret@aws-0-us-west-2.pooler.supabase.com:6543/postgres?sslmode=require";
        assert.strictEqual(usableDatabaseUrl(url), url);
        assert.strictEqual(usableDatabaseUrl(` ${url} `), url);
    });

    // Regression: the production build pulled DATABASE_URL from Vercel as
    // "[SENSITIVE]" and the client constructor threw "Invalid URL".
    test("treats Vercel's sensitive placeholder and other non-URLs as missing", () => {
        for (const value of ["[SENSITIVE]", "not a url", "", "   ", undefined]) {
            assert.strictEqual(usableDatabaseUrl(value), undefined, String(value));
        }
    });
});

describe("isDatabaseConfigured", () => {
    test("is true only for a usable connection URL", () => {
        assert.strictEqual(isDatabaseConfigured({ DATABASE_URL: "postgres://atlas_app:pw@127.0.0.1:54329/atlas_wealth" }), true);
    });

    // Regression: readiness, the outage notice and Plaid storage counted
    // Vercel's "[SENSITIVE]" placeholder as a configured database.
    test("is false for a missing value or Vercel's sensitive placeholder", () => {
        assert.strictEqual(isDatabaseConfigured({}), false);
        assert.strictEqual(isDatabaseConfigured({ DATABASE_URL: "   " }), false);
        assert.strictEqual(isDatabaseConfigured({ DATABASE_URL: "[SENSITIVE]" }), false);
    });
});

describe("isLocalDatabaseUrl", () => {
    test("accepts loopback hosts", () => {
        assert.strictEqual(isLocalDatabaseUrl("postgres://atlas:pw@127.0.0.1:54329/atlas_wealth"), true);
        assert.strictEqual(isLocalDatabaseUrl("postgres://atlas:pw@localhost:54329/atlas_wealth"), true);
        assert.strictEqual(isLocalDatabaseUrl("postgres://atlas:pw@[::1]:54329/atlas_wealth"), true);
    });

    test("rejects hosted databases, including the Supabase pooler", () => {
        assert.strictEqual(
            isLocalDatabaseUrl("postgres://postgres.ref:pw@aws-0-us-west-2.pooler.supabase.com:6543/postgres"),
            false,
        );
        assert.strictEqual(isLocalDatabaseUrl("postgres://atlas:pw@db.example.com:5432/app"), false);
    });

    test("rejects hosts that only look local", () => {
        assert.strictEqual(isLocalDatabaseUrl("postgres://atlas:pw@localhost.example.com:5432/app"), false);
        assert.strictEqual(isLocalDatabaseUrl("postgres://atlas:pw@127.0.0.1.nip.io:5432/app"), false);
    });

    test("rejects missing or malformed URLs", () => {
        assert.strictEqual(isLocalDatabaseUrl(undefined), false);
        assert.strictEqual(isLocalDatabaseUrl(""), false);
        assert.strictEqual(isLocalDatabaseUrl("not a url"), false);
    });
});

describe("DATABASE_POOL_OPTIONS", () => {
    test("keeps a small pool that releases idle connections", () => {
        assert.ok(DATABASE_POOL_OPTIONS.max > 0 && DATABASE_POOL_OPTIONS.max <= 10);
        assert.ok(DATABASE_POOL_OPTIONS.idle_timeout > 0 && DATABASE_POOL_OPTIONS.idle_timeout <= 60);
        assert.ok(DATABASE_POOL_OPTIONS.max_lifetime >= DATABASE_POOL_OPTIONS.idle_timeout);
    });

    // With postgres.js's own backoff the eleventh query against an unreachable
    // database waited about 5 s, and later ones up to 20 s (E2E outage pages
    // timed out after a few renders).
    test("keeps failing fast while the database is unreachable", async () => {
        // Nothing listens on port 9, as for the E2E "database down" server.
        const sql = postgres("postgres://outage:outage@127.0.0.1:9/outage", {
            ...DATABASE_POOL_OPTIONS,
            ssl: false,
            connect_timeout: 10,
        });
        try {
            for (let attempt = 1; attempt <= 12; attempt++) {
                const started = performance.now();
                await assert.rejects(sql`select 1`);
                const elapsed = performance.now() - started;
                assert.ok(elapsed < 1_500, `attempt ${attempt} took ${Math.round(elapsed)} ms`);
            }
        } finally {
            await sql.end({ timeout: 0 });
        }
    });
});

describe("databaseReconnectBackoff", () => {
    test("starts on postgres.js's curve", () => {
        assert.strictEqual(databaseReconnectBackoff(1, () => 1), 0.03);
        assert.strictEqual(databaseReconnectBackoff(2, () => 0), 0.045);
    });

    test("never waits more than a second, however many connects have failed", () => {
        for (let retries = 0; retries <= 100; retries++) {
            assert.ok(databaseReconnectBackoff(retries, () => 1) <= MAX_RECONNECT_BACKOFF_SECONDS);
        }
        assert.strictEqual(databaseReconnectBackoff(100, () => 1), 1);
        assert.strictEqual(databaseReconnectBackoff(100, () => 0), 0.5);
    });
});
