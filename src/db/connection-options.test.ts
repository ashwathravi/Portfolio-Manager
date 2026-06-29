import { describe, test } from "node:test";
import assert from "node:assert";
import { resolveDatabaseSslMode } from "./connection-options.ts";

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
