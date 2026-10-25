import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
    accountNameCheck,
    buildCreatePortfolioQuery,
    buildDeletePortfolioQuery,
    buildExcludeLinkedAccountQuery,
    deletePortfolio,
    buildLockUserAccountsQuery,
    buildUpdatePortfolioQuery,
    buildUserAccountNamesQuery,
    MAX_ACCOUNTS_PER_USER,
    sameAccountName,
} from "./manage";

const USER = "00000000-0000-4000-8000-00000000a001";
const ID = "0b9d3c1e-6a3c-4c7e-9f3a-2f4d8a1b2c3d";
const NOW = new Date("2026-10-24T08:00:00.000Z");

describe("account queries", () => {
    test("create adds an account for the user, its total value its cash", () => {
        const { sql, params } = buildCreatePortfolioQuery(USER, { name: "Roth IRA", description: "Fidelity", cashBalance: 2500 }).toSQL();
        assert.match(sql, /^insert into "portfolios" \(.*"user_id".*\) values .* returning "id", "name", "description", "cash_balance"$/i);
        assert.ok(params.includes(USER));
        assert.ok(params.includes("Roth IRA"));
        assert.equal(params.filter((p) => p === 2500).length, 2);
    });

    test("create without a description or cash stores none and zero", () => {
        const { params } = buildCreatePortfolioQuery(USER, { name: "Brokerage" }).toSQL();
        assert.ok(params.includes(null));
        assert.equal(params.filter((p) => p === 0).length, 2);
    });

    test("update changes only what it was given, only on the user's own account", () => {
        const { sql, params } = buildUpdatePortfolioQuery(USER, ID, { cashBalance: 10 }, NOW).toSQL();
        assert.match(sql, /^update "portfolios" set "cash_balance" = \$1, "updated_at" = case when .* end where \("portfolios"\."id" = \$\d+ and "portfolios"\."user_id" = \$\d+\) returning/i);
        assert.equal(params[0], 10);
        assert.ok(params.includes(ID));
        assert.ok(params.includes(USER));

        const renamed = buildUpdatePortfolioQuery(USER, ID, { name: "Renamed", description: "" }, NOW).toSQL();
        assert.match(renamed.sql, /set "name" = \$1, "description" = \$2 where/i);
        // An empty description clears it.
        assert.equal(renamed.params[1], null);
    });

    test("regression: only a change of cash moves the account's last-change time", () => {
        // The Codex finding on PR #153: a rename after the close moved it,
        // and that day's valuation snapshot was skipped for good.
        const renamed = buildUpdatePortfolioQuery(USER, ID, { name: "Renamed" }, NOW).toSQL();
        assert.doesNotMatch(renamed.sql, /updated_at/);
        // Cash given: moved only if it differs from what's stored.
        const cash = buildUpdatePortfolioQuery(USER, ID, { name: "Renamed", cashBalance: 10 }, NOW).toSQL();
        assert.match(cash.sql, /"updated_at" = case when "portfolios"\."cash_balance" is distinct from \$\d+ then \$\d+::timestamp else "portfolios"\."updated_at" end/i);
        assert.ok(cash.params.includes(NOW.toISOString()));
    });

    test("delete removes only the user's own account and says whether it did", () => {
        const { sql, params } = buildDeletePortfolioQuery(USER, ID).toSQL();
        assert.match(sql, /^delete from "portfolios" where \("portfolios"\."id" = \$1 and "portfolios"\."user_id" = \$2\) returning "id", "source", "external_account_id"$/i);
        assert.deepEqual(params, [ID, USER]);
    });

    test("regression: a deleted linked account's Plaid account stops syncing, the user's own only", () => {
        // Otherwise the next sync (launch item i44) would bring it back.
        const { sql, params } = buildExcludeLinkedAccountQuery(USER, "plaid-acct-1", NOW).toSQL();
        assert.match(sql, /^update "plaid_accounts" set "sync_status" = \$1, "updated_at" = \$2 where \("plaid_accounts"\."user_id" = \$3 and "plaid_accounts"\."plaid_account_id" = \$4\)$/i);
        assert.deepEqual(params, ["excluded", NOW.toISOString(), USER, "plaid-acct-1"]);
    });

    test("delete excludes the Plaid account only for a linked account", async () => {
        const run = async (deleted: Record<string, unknown> | undefined) => {
            const statements: string[] = [];
            const tx = {
                delete: () => ({ where: () => ({ returning: async () => { statements.push("delete"); return deleted ? [deleted] : []; } }) }),
                update: () => ({ set: () => ({ where: async () => { statements.push("exclude"); } }) }),
            };
            const database = { transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as Parameters<typeof deletePortfolio>[2];
            return { result: await deletePortfolio(USER, ID, database, NOW), statements };
        };
        assert.deepEqual(await run({ id: ID, source: "plaid", externalAccountId: "plaid-acct-1" }), { result: true, statements: ["delete", "exclude"] });
        assert.deepEqual(await run({ id: ID, source: "manual", externalAccountId: null }), { result: true, statements: ["delete"] });
        assert.deepEqual(await run(undefined), { result: false, statements: ["delete"] });
    });
});

describe("account names and the account limit", () => {
    const accounts = [
        { id: "p-main", name: "Main Portfolio" },
        { id: "p-ira", name: "Roth IRA" },
    ];

    test("names compare without case or surrounding spaces", () => {
        assert.equal(sameAccountName("Brokerage", " brokerage "), true);
        assert.equal(sameAccountName("Roth IRA", "ROTH IRA"), true);
        assert.equal(sameAccountName("Roth IRA", "Roth  IRA"), false);
    });

    test("a new account can't take a name in use, in any case", () => {
        assert.equal(accountNameCheck(accounts, "Joint", null), "ok");
        assert.equal(accountNameCheck(accounts, "  roth ira ", null), "duplicate");
    });

    test("a rename can't take another account's name, but can keep or recase its own", () => {
        assert.equal(accountNameCheck(accounts, "Roth IRA", "p-main"), "duplicate");
        assert.equal(accountNameCheck(accounts, "Main Portfolio", "p-main"), "ok");
        assert.equal(accountNameCheck(accounts, "MAIN portfolio", "p-main"), "ok");
        assert.equal(accountNameCheck(accounts, "Taxable", "p-main"), "ok");
    });

    test("regression: an account that already shares a name can still be edited", () => {
        // Names weren't checked before this, so two accounts may share one;
        // the edit form sends the name with every change of cash.
        const twins = [{ id: "a", name: "Brokerage" }, { id: "b", name: "brokerage" }];
        assert.equal(accountNameCheck(twins, "Brokerage", "a"), "ok");
        assert.equal(accountNameCheck(twins, "Brokerage", "b"), "ok");
    });

    test("an account that isn't the user's is not found, whatever the name", () => {
        assert.equal(accountNameCheck(accounts, "Roth IRA", "someone-elses"), "not-found");
    });

    test("a new account past the limit is refused; renames don't count", () => {
        const full = Array.from({ length: MAX_ACCOUNTS_PER_USER }, (_, i) => ({ id: `p${i}`, name: `Account ${i}` }));
        assert.equal(accountNameCheck(full, "One more", null), "limit");
        assert.equal(accountNameCheck(full.slice(1), "One more", null), "ok");
        assert.equal(accountNameCheck(full, "Renamed", "p0"), "ok");
    });

    test("the lock and the names are the user's own", () => {
        const names = buildUserAccountNamesQuery(USER).toSQL();
        assert.match(names.sql, /^select "id", "name" from "portfolios" where "portfolios"\."user_id" = \$1 order by/);
        assert.deepEqual(names.params, [USER]);

        // The lock is taken on the transaction it's given, keyed by the user.
        const taken: SQL[] = [];
        void buildLockUserAccountsQuery(USER, { execute: (query: SQL) => (taken.push(query), Promise.resolve()) } as never);
        assert.equal(taken.length, 1);
        const lock = new PgDialect().sqlToQuery(taken[0]);
        assert.equal(lock.sql, "select pg_advisory_xact_lock(hashtext($1))");
        assert.deepEqual(lock.params, [`atlas:accounts:${USER}`]);
    });
});
