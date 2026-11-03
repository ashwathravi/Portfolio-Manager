import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { drizzle } from "drizzle-orm/postgres-js";

import {
    buildClaimQuery,
    buildRecentClaimsCountQuery,
    buildSaveResultsQuery,
    chooseClaims,
    FINAL_AFTER_CLOSE_MS,
    FINNHUB_CALL_BUDGET,
    INTRADAY_REFRESH_MS,
    needsRefresh,
    NO_QUOTE_RETRY_MS,
    type IntradayRow,
} from "./intraday-quotes";

// Monday 2 November 2026: the session closes at 4:00 PM EST (21:00 UTC).
const session = { closeAt: new Date("2026-11-02T21:00:00Z") };
const at = (iso: string) => new Date(iso);

function row(symbol: string, overrides: Partial<IntradayRow> = {}): IntradayRow {
    return { symbol, price: null, previousClose: null, quotedAt: null, claimedAt: null, fetchedAt: null, ...overrides };
}

const quoted = (claimedAt: string): Partial<IntradayRow> => ({
    price: 100,
    previousClose: 99,
    quotedAt: at(claimedAt),
    claimedAt: at(claimedAt),
    fetchedAt: at(claimedAt),
});

describe("needsRefresh", () => {
    const now = at("2026-11-02T15:42:00Z");

    test("a symbol never claimed is due", () => {
        assert.equal(needsRefresh(row("AAPL"), now, session), true);
    });

    test("a quote is fetched again once it is a minute old", () => {
        assert.equal(needsRefresh(row("AAPL", quoted("2026-11-02T15:41:01Z")), now, session), false);
        assert.equal(needsRefresh(row("AAPL", quoted("2026-11-02T15:41:00Z")), now, session), true);
        assert.equal(INTRADAY_REFRESH_MS, 60_000);
    });

    test("a claim whose fetch never came back is retried after a minute too", () => {
        assert.equal(needsRefresh(row("AAPL", { claimedAt: at("2026-11-02T15:41:30Z") }), now, session), false);
        assert.equal(needsRefresh(row("AAPL", { claimedAt: at("2026-11-02T15:40:59Z") }), now, session), true);
    });

    test("a symbol the provider had no quote for waits ten minutes", () => {
        const none = (iso: string) => row("XYZ", { claimedAt: at(iso), fetchedAt: at(iso) });
        assert.equal(needsRefresh(none("2026-11-02T15:33:00Z"), now, session), false);
        assert.equal(needsRefresh(none("2026-11-02T15:32:00Z"), now, session), true);
        assert.equal(NO_QUOTE_RETRY_MS, 600_000);
    });

    test("after the close, a quote fetched once the closing prints are in is final", () => {
        const evening = at("2026-11-02T23:00:00Z");
        const finalAt = new Date(session.closeAt.getTime() + FINAL_AFTER_CLOSE_MS).toISOString();
        assert.equal(needsRefresh(row("AAPL", quoted(finalAt)), evening, session), false);
        // One fetched just after the bell is fetched once more.
        assert.equal(needsRefresh(row("AAPL", quoted("2026-11-02T21:01:00Z")), evening, session), true);
        // Yesterday's final quote is no help today.
        assert.equal(needsRefresh(row("AAPL", quoted("2026-10-30T21:10:00Z")), now, session), true);
    });
});

describe("chooseClaims", () => {
    const now = at("2026-11-02T15:42:00Z");

    test("takes the due symbols, never-claimed first, then the longest waiting", () => {
        const rows = [
            row("MSFT", quoted("2026-11-02T15:39:00Z")),
            row("AAPL", quoted("2026-11-02T15:41:30Z")), // fresh
            row("NVDA"),
            row("IBM", quoted("2026-11-02T15:30:00Z")),
        ];
        assert.deepEqual(chooseClaims(rows, 10, now, session), ["NVDA", "IBM", "MSFT"]);
    });

    test("stops at the room left in the budget", () => {
        const rows = [row("A"), row("B"), row("C")];
        assert.deepEqual(chooseClaims(rows, 2, now, session), ["A", "B"]);
        assert.deepEqual(chooseClaims(rows, 0, now, session), []);
        assert.deepEqual(chooseClaims(rows, -3, now, session), []);
    });

    test("the budget stays under Finnhub's 60 calls a minute", () => {
        assert.ok(FINNHUB_CALL_BUDGET.limit < 60);
        assert.ok(FINNHUB_CALL_BUDGET.windowMs > 60_000);
    });
});

describe("intraday quote queries", () => {
    // Builds SQL only; nothing connects.
    const database = drizzle.mock();

    test("counts the claims of the window across every row", () => {
        const { sql, params } = buildRecentClaimsCountQuery(at("2026-11-02T15:41:00Z"), database).toSQL();
        assert.match(sql, /count\(\*\)::int/);
        assert.match(sql, /"claimed_at" > \$1/);
        assert.equal(params.length, 1);
    });

    test("a claim stamps only claimed_at on an existing row", () => {
        const { sql } = buildClaimQuery(["AAPL"], at("2026-11-02T15:42:00Z"), "finnhub", database).toSQL();
        assert.match(sql, /on conflict \("symbol"\) do update set "claimed_at" = \$\d+$/);
    });

    test("a fetch's result is saved only onto the claim that made it", () => {
        const claimedAt = at("2026-11-02T15:42:00Z");
        const { sql, params } = buildSaveResultsQuery(
            [{ symbol: "AAPL", quote: { price: 231.5, previousClose: 230, quotedAt: at("2026-11-02T15:41:58Z") } }, { symbol: "XYZ", quote: null }],
            claimedAt,
            at("2026-11-02T15:42:01Z"),
            "finnhub",
            database,
        ).toSQL();
        assert.match(sql, /do update set "price" = excluded\.price, "previous_close" = excluded\.previous_close/);
        assert.match(sql, /where "intraday_quotes"\."claimed_at" = \$\d+$/);
        // The symbol with no quote is written with no price.
        assert.deepEqual(params.slice(7, 10), ["XYZ", null, null]);
    });
});
