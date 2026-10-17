import { describe, test } from "node:test";
import assert from "node:assert";
import { DATABASE_POOL_OPTIONS, isLocalDatabaseUrl, resolveDatabaseSslMode } from "./connection-options.ts";

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
});
