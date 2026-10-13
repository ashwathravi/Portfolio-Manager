import { describe, test } from "node:test";
import assert from "node:assert";
import {
    APP_RUNTIME_ROLE,
    buildEnsureAppLoginRoleSql,
    quoteSqlLiteral,
    readDatabaseLogin,
} from "./roles.ts";

describe("quoteSqlLiteral", () => {
    test("wraps the value in single quotes", () => {
        assert.strictEqual(quoteSqlLiteral("secret"), "'secret'");
    });

    test("doubles embedded single quotes", () => {
        assert.strictEqual(quoteSqlLiteral("it's"), "'it''s'");
    });
});

describe("buildEnsureAppLoginRoleSql", () => {
    test("creates the login role, resets its password if it exists, and grants app_runtime", () => {
        const sql = buildEnsureAppLoginRoleSql("atlas_app", "local-only");
        assert.match(sql, /CREATE ROLE atlas_app LOGIN PASSWORD 'local-only';/);
        assert.match(sql, /EXCEPTION WHEN duplicate_object THEN\n {4}ALTER ROLE atlas_app WITH LOGIN PASSWORD 'local-only';/);
        assert.match(sql, new RegExp(`GRANT ${APP_RUNTIME_ROLE} TO atlas_app;$`));
    });

    test("quotes passwords containing single quotes", () => {
        const sql = buildEnsureAppLoginRoleSql("atlas_app", "o'brien");
        assert.match(sql, /PASSWORD 'o''brien';/);
    });

    test("rejects role names that are not plain identifiers", () => {
        assert.throws(() => buildEnsureAppLoginRoleSql("atlas-app", "pw"), /Unsupported role name/);
        assert.throws(() => buildEnsureAppLoginRoleSql("Atlas", "pw"), /Unsupported role name/);
        assert.throws(() => buildEnsureAppLoginRoleSql("x; DROP TABLE portfolios", "pw"), /Unsupported role name/);
        assert.throws(() => buildEnsureAppLoginRoleSql("", "pw"), /Unsupported role name/);
    });

    test("refuses to give app_runtime itself a login", () => {
        assert.throws(() => buildEnsureAppLoginRoleSql(APP_RUNTIME_ROLE, "pw"), /separate login role/);
    });

    test("requires a password without dollar signs", () => {
        assert.throws(() => buildEnsureAppLoginRoleSql("atlas_app", ""), /needs a password/);
        assert.throws(() => buildEnsureAppLoginRoleSql("atlas_app", "pa$$word"), /without '\$'/);
    });
});

describe("readDatabaseLogin", () => {
    test("reads the user and password from a URL", () => {
        assert.deepStrictEqual(
            readDatabaseLogin("postgres://atlas_app:local-only@127.0.0.1:54329/atlas_wealth"),
            { user: "atlas_app", password: "local-only" },
        );
    });

    test("percent-decodes both parts", () => {
        assert.deepStrictEqual(
            readDatabaseLogin("postgres://atlas_app:p%40ss%3Aword@localhost:5432/db"),
            { user: "atlas_app", password: "p@ss:word" },
        );
    });
});
