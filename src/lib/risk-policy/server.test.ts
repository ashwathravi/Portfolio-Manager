import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildPolicyThesesQuery, loadPolicyPortfolio, loadPolicyTheses } from "./server";
import { EMPTY_POLICY_PORTFOLIO } from "./user-policy";

describe("risk policy server loads", () => {
    test("the theses query reads the user's own, not the ones they deleted", () => {
        const { sql, params } = buildPolicyThesesQuery("user-a").toSQL();
        assert.match(sql, /where \("theses"."user_id" = \$1 and "theses"."dismissed" = \$2\)/);
        // Newest first, as the research store reads them.
        assert.match(sql, /order by "theses"."created_at" desc, "theses"."id" asc$/);
        assert.deepEqual(params, ["user-a", false]);
        assert.doesNotMatch(sql, /"hypothesis"|"description"/);
    });

    test("the theses the user wrote, without the examples, even edited ones", async () => {
        const rows = [
            { id: "seed-nvda", ticker: "NVDA", status: "active", targetPrice: 900, currentPrice: null, dateUpdated: "2026-01-01", healthScore: 70 },
            { id: "user-1", ticker: "KO", status: "active", targetPrice: 70, currentPrice: null, dateUpdated: "2026-10-01", healthScore: 60 },
        ];
        const database = { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) }) } as never;
        assert.deepEqual(await loadPolicyTheses("user-a", database), [
            { id: "user-1", ticker: "KO", status: "active", targetPrice: 70, currentPrice: undefined, dateUpdated: "2026-10-01", healthScore: 60 },
        ]);
    });

    test("without a configured database nothing is queried and the portfolio is empty", async () => {
        assert.deepEqual(await loadPolicyPortfolio("user-a", { databaseConfigured: false }), {
            portfolio: EMPTY_POLICY_PORTFOLIO,
            unavailable: false,
        });
    });
});
