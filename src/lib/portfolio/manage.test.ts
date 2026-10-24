import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildCreatePortfolioQuery, buildDeletePortfolioQuery, buildUpdatePortfolioQuery } from "./manage";

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
        assert.match(sql, /^delete from "portfolios" where \("portfolios"\."id" = \$1 and "portfolios"\."user_id" = \$2\) returning "id"$/i);
        assert.deepEqual(params, [ID, USER]);
    });
});
