import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildDeleteExpiredSessionsQuery } from "./expired-sessions";

describe("expired sessions query", () => {
    test("deletes only sessions that expired before now", () => {
        const now = new Date("2026-10-16T22:30:00.000Z");
        const { sql, params } = buildDeleteExpiredSessionsQuery(now).toSQL();

        assert.equal(sql, 'delete from "auth_sessions" where "auth_sessions"."expires" < $1');
        assert.deepEqual(params, ["2026-10-16T22:30:00.000Z"]);
    });

    test("never returns session tokens", () => {
        const { sql } = buildDeleteExpiredSessionsQuery(new Date()).toSQL();
        assert.doesNotMatch(sql, /returning/i);
    });
});
