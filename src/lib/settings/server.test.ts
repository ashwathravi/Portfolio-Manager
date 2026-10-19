import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";

import { buildLoadUserSettingsQuery, buildSaveUserSettingsQuery, serverSettingsFor } from "./server";

const USER = "00000000-0000-4000-8000-00000000a001";
const NOW = new Date("2026-10-19T08:00:00.000Z");
const CONFIGURED = { DATABASE_URL: "postgres://atlas_app:pw@db.example.com:6543/postgres" };

/** A database whose settings query answers `rows`, or throws `error`. */
function fakeDatabase({ rows = [], error }: { rows?: unknown[]; error?: Error } = {}) {
    const limit = async () => {
        if (error) throw error;
        return rows;
    };
    return { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) } as unknown as typeof db;
}

describe("user settings queries", () => {
    test("load reads one user's row only", () => {
        const { sql, params } = buildLoadUserSettingsQuery(USER).toSQL();
        assert.match(sql, /select "version", "settings", "updated_at" from "user_settings" where "user_settings"\."user_id" = \$1 limit \$2/i);
        assert.deepEqual(params, [USER, 1]);
    });

    test("save replaces the user's document in one statement", () => {
        const document = { version: 15, settings: { demo: { showSampleData: false } } };
        const { sql, params } = buildSaveUserSettingsQuery(USER, document, NOW).toSQL();

        assert.match(sql, /insert into "user_settings" \("user_id", "version", "settings", "updated_at"\)/i);
        assert.match(sql, /on conflict \("user_id"\) do update set "version" = \$\d+, "settings" = \$\d+, "updated_at" = \$\d+/i);
        assert.match(sql, /returning "updated_at"/i);
        assert.ok(params.includes(USER));
        assert.ok(params.includes(JSON.stringify(document.settings)));
        assert.ok(params.includes(NOW.toISOString()));
    });
});

describe("serverSettingsFor", () => {
    test("is unavailable without a user or a usable database", async () => {
        assert.deepEqual(await serverSettingsFor(null, { env: CONFIGURED, database: fakeDatabase() }), { status: "unavailable" });
        assert.deepEqual(await serverSettingsFor(USER, { env: {}, database: fakeDatabase() }), { status: "unavailable" });
        assert.deepEqual(
            await serverSettingsFor(USER, { env: { DATABASE_URL: "[SENSITIVE]" }, database: fakeDatabase() }),
            { status: "unavailable" },
        );
    });

    test("says the user has nothing stored yet", async () => {
        assert.deepEqual(await serverSettingsFor(USER, { env: CONFIGURED, database: fakeDatabase() }), { status: "ok", document: null });
    });

    test("hands back the stored document", async () => {
        const row = { version: 14, settings: { demo: { showSampleData: false } }, updatedAt: NOW };

        assert.deepEqual(await serverSettingsFor(USER, { env: CONFIGURED, database: fakeDatabase({ rows: [row] }) }), {
            status: "ok",
            document: { version: 14, settings: { demo: { showSampleData: false } }, updatedAt: NOW.toISOString() },
        });
    });

    test("is unavailable, not an error, when the database can't be read", async (t) => {
        t.mock.method(console, "warn", () => {});
        const database = fakeDatabase({ error: new Error("connect ECONNREFUSED 127.0.0.1:9") });

        assert.deepEqual(await serverSettingsFor(USER, { env: CONFIGURED, database }), { status: "unavailable" });
    });
});
