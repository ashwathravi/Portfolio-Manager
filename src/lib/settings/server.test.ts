import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { db } from "@/db";

import {
    buildLoadUserSettingsQuery,
    buildSaveUserSettingsQuery,
    buildSeedUserSettingsQuery,
    NEW_USER_SETTINGS,
    saveUserSettings,
    seedNewUserSettings,
    serverSettingsFor,
} from "./server";
import { SETTINGS_VERSION } from "./document";
import { normalizeSettings } from "@/lib/stores/settingsStore";

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

    test("save replaces the user's document only if it was made on the stored version, at its version or later", () => {
        const document = { version: 15, settings: { demo: { showSampleData: false } } };
        const base = "2026-10-19T07:00:00.000Z";
        const { sql, params } = buildSaveUserSettingsQuery(USER, document, base, NOW).toSQL();

        assert.match(sql, /insert into "user_settings" \("user_id", "version", "settings", "updated_at"\)/i);
        assert.match(sql, /on conflict \("user_id"\) do update set "version" = \$\d+, "settings" = \$\d+, "updated_at" = \$\d+ where \(date_trunc\('milliseconds', "user_settings"\."updated_at"\) = \$\d+::timestamp and "user_settings"\."version" <= \$\d+\)/i);
        assert.match(sql, /returning "updated_at"/i);
        assert.ok(params.includes(USER));
        assert.ok(params.includes(JSON.stringify(document.settings)));
        assert.ok(params.includes(NOW.toISOString()));
        assert.ok(params.includes(base));
    });

    test("regression: the stored version is compared to the millisecond, as the browser has it", () => {
        // A row stamped by Postgres (now(), microseconds) never equalled the
        // version the browser sent back (a Date: milliseconds), so a new
        // user's every settings change was refused as a conflict and undone.
        const base = "2026-10-25T14:13:12.123Z";
        const { sql, params } = buildSaveUserSettingsQuery(USER, { version: 15, settings: {} }, base, NOW).toSQL();
        assert.match(sql, /date_trunc\('milliseconds', "user_settings"\."updated_at"\) = \$\d+::timestamp/);
        assert.ok(params.includes(base));
    });

    test("a first save never replaces a document someone already stored", () => {
        const { sql } = buildSaveUserSettingsQuery(USER, { version: 15, settings: {} }, null, NOW).toSQL();
        assert.match(sql, /do update set .* where false/i);
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

describe("saveUserSettings", () => {
    /** A database whose upsert returns `saved` rows, and whose read returns `current`. */
    function savingDatabase(saved: unknown[], current: unknown[] = []) {
        const returning = async () => saved;
        const limit = async () => current;
        return {
            insert: () => ({ values: () => ({ onConflictDoUpdate: () => ({ returning }) }) }),
            select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
        } as unknown as typeof db;
    }

    test("reports the new version stamp when the save lands", async () => {
        const result = await saveUserSettings(USER, { version: 15, settings: {} }, null, { database: savingDatabase([{ updatedAt: NOW }]) });
        assert.deepEqual(result, { status: "saved", updatedAt: NOW.toISOString() });
    });

    test("hands back what's stored now when someone saved first", async () => {
        const later = new Date("2026-10-19T09:00:00.000Z");
        const database = savingDatabase([], [{ version: 15, settings: { demo: { showSampleData: false } }, updatedAt: later }]);

        const result = await saveUserSettings(USER, { version: 15, settings: {} }, NOW.toISOString(), { database });

        assert.deepEqual(result, {
            status: "conflict",
            current: { version: 15, settings: { demo: { showSampleData: false } }, updatedAt: later.toISOString() },
        });
    });
});

describe("new users' settings", () => {
    test("example data starts off; nothing else is set", () => {
        assert.deepEqual(NEW_USER_SETTINGS, { version: SETTINGS_VERSION, settings: { demo: { showSampleData: false } } });
        // The stored section is one the store reads back as is.
        assert.deepEqual(normalizeSettings(NEW_USER_SETTINGS.settings).demo, { showSampleData: false });
    });

    test("stored only if the user has none yet, stamped to the millisecond like every save", () => {
        const { sql, params } = buildSeedUserSettingsQuery("user-new", undefined, NOW).toSQL();
        assert.match(sql, /^insert into "user_settings" \("user_id", "version", "settings", "updated_at"\) values \(\$1, \$2, \$3, \$4\) on conflict \("user_id"\) do nothing$/);
        assert.deepEqual(params, ["user-new", SETTINGS_VERSION, JSON.stringify(NEW_USER_SETTINGS.settings), NOW.toISOString()]);
    });

    test("a failure doesn't stop sign-in", async () => {
        const original = console.warn;
        console.warn = () => {};
        try {
            const failing = { insert: () => { throw new Error("connection refused"); } } as never;
            await seedNewUserSettings("user-new", failing);
        } finally {
            console.warn = original;
        }
    });
});
