import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    adjustHoldingsForSplit,
    buildAdjustHoldingsForSplitQuery,
    describeSplitRatio,
    splitTakesEffectAt,
} from "./split-adjustments";

const NVDA = { symbol: "nvda", executionDate: "2026-10-15", splitFrom: 1, splitTo: 10 };

describe("splitTakesEffectAt", () => {
    test("is the market open on the execution date, Eastern time", () => {
        assert.equal(splitTakesEffectAt("2026-10-15").toISOString(), "2026-10-15T13:30:00.000Z"); // EDT
        assert.equal(splitTakesEffectAt("2026-12-01").toISOString(), "2026-12-01T14:30:00.000Z"); // EST
    });
});

describe("describeSplitRatio", () => {
    test("reads new-for-old", () => {
        assert.equal(describeSplitRatio({ splitFrom: 1, splitTo: 10 }), "10-for-1");
        assert.equal(describeSplitRatio({ splitFrom: 20, splitTo: 1 }), "1-for-20");
    });
});

describe("buildAdjustHoldingsForSplitQuery", () => {
    test("scales quantity up and per-share prices down, only for positions not yet adjusted for this split", () => {
        const { sql, params } = buildAdjustHoldingsForSplitQuery(NVDA).toSQL();
        assert.match(sql, /^update "holdings" set /);
        assert.match(sql, /"quantity" = "holdings"\."quantity" \* \$\d+::numeric \/ \$\d+::numeric/);
        assert.match(sql, /"avg_cost" = "holdings"\."avg_cost" \* \$\d+::numeric \/ \$\d+::numeric/);
        assert.match(sql, /"current_price" = "holdings"\."current_price" \* \$\d+::double precision \/ \$\d+::double precision/);
        assert.match(sql, /where \(upper\("holdings"\."symbol"\) = \$\d+ and "holdings"\."updated_at" < \$\d+\) returning "id"$/);
        // quantity × 10 / 1, avg cost × 1 / 10, last price × 1 / 10.
        assert.deepEqual(params.slice(0, 6), ["10", "1", "1", "10", "1", "10"]);
        assert.ok(params.includes("NVDA"), "the symbol is matched in upper case");
        const effective = "2026-10-15T13:30:00.000Z";
        assert.equal(params.filter((param) => param === effective).length, 2, "updated_at is set to, and compared with, the moment it took effect");
    });
});

describe("adjustHoldingsForSplit", () => {
    test("does nothing for a ratio that would change nothing or isn't positive", async () => {
        const untouchable = new Proxy({}, { get: () => () => assert.fail("the database was used") }) as never;
        for (const ratio of [{ splitFrom: 1, splitTo: 1 }, { splitFrom: 0, splitTo: 10 }, { splitFrom: 1, splitTo: -2 }, { splitFrom: Number.NaN, splitTo: 2 }]) {
            assert.equal(await adjustHoldingsForSplit({ ...NVDA, ...ratio }, untouchable), 0);
        }
    });
});
