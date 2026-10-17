import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

import * as schema from "./schema";

const tables = (Object.values(schema) as unknown[]).filter((value): value is PgTable => value instanceof PgTable);

describe("schema access control", () => {
    test("finds the tables", () => {
        assert.ok(tables.length >= 18, `expected at least 18 tables, found ${tables.length}`);
    });

    // Every table, including ones added later, must keep Supabase's anon and
    // authenticated roles out and let only app_runtime in (migrations 0008, 0010).
    for (const table of tables) {
        const config = getTableConfig(table);

        test(`${config.name} has RLS and both access policies`, () => {
            assert.equal(config.enableRLS, true, "RLS is not enabled");
            const policies = new Map(config.policies.map((policy) => [policy.name, policy]));

            const denyClients = policies.get("server_only_no_client_access");
            assert.ok(denyClients, "missing server_only_no_client_access");
            assert.equal(denyClients.as, "restrictive");
            assert.deepEqual(denyClients.to, ["anon", "authenticated"]);

            const appRuntime = policies.get("app_runtime_access");
            assert.ok(appRuntime, "missing app_runtime_access");
            assert.equal(appRuntime.to, "app_runtime");
        });
    }
});
