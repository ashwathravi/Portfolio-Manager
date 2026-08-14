import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    buildDashboardPortfoliosQuery,
    buildOwnedPortfolioQuery,
    buildOwnedPortfolioHoldingsQuery,
    buildUserHoldingPositionsQuery,
    buildUserHoldingsQuery,
    buildUserPortfolioCountQuery,
    buildUserTransactionsQuery,
} from "./portfolio-repository";

const USER_A = "user-a";
const USER_B = "user-b";

function assertScoped(
    query: { toSQL(): { sql: string; params: unknown[] } },
    userId: string,
) {
    const compiled = query.toSQL();
    assert.match(
        compiled.sql,
        /\bwhere\b[\s\S]*"portfolios"\."user_id"\s*=\s*\$\d+/i,
        `query does not enforce portfolio ownership in its WHERE clause: ${compiled.sql}`,
    );
    assert.ok(compiled.params.includes(userId), `missing ${userId} in ${JSON.stringify(compiled.params)}`);
    return compiled;
}

describe("portfolio tenant query boundaries", () => {
    test("scopes dashboard, holding, transaction, count, and ownership queries", () => {
        assertScoped(buildDashboardPortfoliosQuery(USER_A), USER_A);
        assertScoped(buildUserHoldingsQuery(USER_A), USER_A);
        assertScoped(buildUserHoldingPositionsQuery(USER_A, "aapl"), USER_A);
        assertScoped(buildUserTransactionsQuery(USER_A), USER_A);
        assertScoped(buildUserPortfolioCountQuery(USER_A), USER_A);
        assertScoped(buildOwnedPortfolioQuery(USER_A, "00000000-0000-4000-8000-000000000001"), USER_A);
        assertScoped(buildOwnedPortfolioHoldingsQuery(USER_A, "00000000-0000-4000-8000-000000000001"), USER_A);
    });

    test("binds different users as different query principals", () => {
        const userAQuery = assertScoped(buildUserHoldingsQuery(USER_A), USER_A);
        const userBQuery = assertScoped(buildUserHoldingsQuery(USER_B), USER_B);

        assert.notDeepEqual(userAQuery.params, userBQuery.params);
        assert.ok(!userAQuery.params.includes(USER_B));
        assert.ok(!userBQuery.params.includes(USER_A));
    });
});
