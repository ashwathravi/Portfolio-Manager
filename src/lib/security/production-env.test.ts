import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { productionDatabaseCredentialWarnings } from "./production-env";

describe("productionDatabaseCredentialWarnings", () => {
    test("is silent outside production", () => {
        assert.deepEqual(productionDatabaseCredentialWarnings({
            nodeEnv: "development",
            databaseUrl: "postgres://postgres:postgres@localhost:5432/app",
        }), []);
    });

    test("warns on missing production database URL", () => {
        assert.deepEqual(productionDatabaseCredentialWarnings({
            nodeEnv: "production",
            databaseUrl: "",
        }), ["DATABASE_URL is missing in production."]);
    });

    test("warns on local-style production connection strings", () => {
        const warnings = productionDatabaseCredentialWarnings({
            nodeEnv: "production",
            databaseUrl: "postgres://postgres:secret@localhost:5432/app?sslmode=disable",
        });

        assert.ok(warnings.includes("DATABASE_URL points at a local-style host in production."));
        assert.ok(warnings.includes("DATABASE_URL uses a local-style database username in production."));
        assert.ok(warnings.includes("DATABASE_URL disables SSL in production."));
    });

    test("accepts a managed production-looking connection string", () => {
        assert.deepEqual(productionDatabaseCredentialWarnings({
            nodeEnv: "production",
            databaseUrl: "postgres://atlas_app:secret@db.example.com:5432/app?sslmode=require",
        }), []);
    });
});
