import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    buildOptionContractsToMarkQuery,
    buildPruneOptionMarksQuery,
    buildSaveOptionMarkQuery,
    optionCloseWindowStart,
} from "./option-marks";

const AAPL_CALL = "O:AAPL270115C00250000";
const SESSION = "2026-10-16";
const AT = new Date("2026-10-16T22:30:00.000Z");

describe("optionCloseWindowStart", () => {
    test("the 30 days up to the session, across a month or a year", () => {
        assert.equal(optionCloseWindowStart("2026-10-16"), "2026-09-16");
        assert.equal(optionCloseWindowStart("2026-01-15"), "2025-12-16");
        assert.equal(optionCloseWindowStart("2028-03-01"), "2028-01-31");
    });
});

describe("contracts to mark", () => {
    test("held, unexpired contracts not asked about this session, the never-asked first", () => {
        const { sql, params } = buildOptionContractsToMarkQuery(SESSION).toSQL();
        assert.match(sql, /^select distinct "option_positions"\."contract", "option_marks"\."checked_at" from "option_positions"/);
        assert.match(sql, /left join "option_marks" on "option_marks"\."contract" = "option_positions"\."contract"/);
        assert.match(sql, /where \("option_positions"\."expiry" >= \$1 and \("option_marks"\."contract" is null or "option_marks"\."checked_session" < \$2\)\)/);
        assert.match(sql, /order by "option_marks"\."checked_at" asc nulls first, "option_positions"\."contract" asc$/);
        assert.deepEqual(params, [SESSION, SESSION]);
    });

    test("not scoped to a user: it returns contracts, never who holds them", () => {
        const { sql } = buildOptionContractsToMarkQuery(SESSION).toSQL();
        assert.doesNotMatch(sql, /user_id|"portfolio_id"/);
    });
});

describe("saving a mark", () => {
    test("a close found: kept unless the stored one is newer; the session is recorded either way", () => {
        const { sql, params } = buildSaveOptionMarkQuery(AAPL_CALL, { date: SESSION, close: 21.4 }, { session: SESSION, at: AT, source: "massive" }).toSQL();
        assert.match(sql, /^insert into "option_marks" \("contract", "close", "close_date", "checked_session", "checked_at", "source"\) values/);
        assert.match(sql, /on conflict \("contract"\) do update set "close" = case when "option_marks"\."close_date" is null or "option_marks"\."close_date" <= \$\d+ then \$\d+::double precision else "option_marks"\."close" end/);
        assert.match(sql, /"close_date" = case when "option_marks"\."close_date" is null or "option_marks"\."close_date" <= \$\d+ then \$\d+::date else "option_marks"\."close_date" end/);
        assert.match(sql, /"checked_session" = \$\d+, "checked_at" = \$\d+, "source" = \$\d+$/);
        assert.deepEqual(params.slice(0, 6), [AAPL_CALL, 21.4, SESSION, SESSION, AT.toISOString(), "massive"]);
    });

    test("no trade: the stored close stays, and the session is recorded so it isn't asked again", () => {
        const { sql, params } = buildSaveOptionMarkQuery(AAPL_CALL, null, { session: SESSION, at: AT, source: "massive" }).toSQL();
        assert.match(sql, /"close" = case when false then \$\d+::double precision else "option_marks"\."close" end/);
        assert.deepEqual(params.slice(0, 6), [AAPL_CALL, null, null, SESSION, AT.toISOString(), "massive"]);
    });
});

describe("pruning marks", () => {
    test("drops only marks of contracts no position holds", () => {
        const { sql, params } = buildPruneOptionMarksQuery().toSQL();
        assert.equal(sql, 'delete from "option_marks" where "option_marks"."contract" not in (select distinct "contract" from "option_positions") returning "contract"');
        assert.deepEqual(params, []);
    });
});
