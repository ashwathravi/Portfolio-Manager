import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    adjustHoldingsForSplit,
    buildAdjustHoldingsForSplitQuery,
    buildHeldSinceQuery,
    combineSameDaySplits,
    describeSplitRatio,
    reconcileHoldingSplits,
    splitTakesEffectAt,
} from "./split-adjustments";

const NVDA = { symbol: "nvda", executionDate: "2026-10-15", splitFrom: 1, splitTo: 10 };

describe("splitTakesEffectAt", () => {
    test("is the start of the execution date, Eastern time, before any pre-market trading", () => {
        assert.equal(splitTakesEffectAt("2026-10-15").toISOString(), "2026-10-15T04:00:00.000Z"); // EDT
        assert.equal(splitTakesEffectAt("2026-12-01").toISOString(), "2026-12-01T05:00:00.000Z"); // EST
    });
});

describe("combineSameDaySplits", () => {
    const day = { symbol: "NVDA", executionDate: "2026-10-15" };

    test("applies every action that day as one ratio", () => {
        // A 2-for-1 split and a 3-for-2 the same day: 3 new shares for each old one.
        assert.deepEqual(combineSameDaySplits([
            { ...day, splitFrom: 1, splitTo: 2, id: "A" },
            { ...day, splitFrom: 2, splitTo: 3, id: "B" },
        ]), { ...day, splitFrom: 2, splitTo: 6 });
    });

    test("counts the same action once when it is listed twice", () => {
        assert.deepEqual(combineSameDaySplits([
            { ...day, splitFrom: 1, splitTo: 10, id: "A" },
            { ...day, splitFrom: 1, splitTo: 10, id: "A" },
        ]), { ...day, splitFrom: 1, splitTo: 10 });
    });

    test("regression: several actions of which one has no id are ambiguous, never guessed", () => {
        // Equal ratios don't prove two rows are the same action.
        assert.equal(combineSameDaySplits([{ ...day, splitFrom: 1, splitTo: 10 }, { ...day, splitFrom: 1, splitTo: 10 }]), undefined);
        assert.equal(combineSameDaySplits([{ ...day, splitFrom: 1, splitTo: 2, id: "A" }, { ...day, splitFrom: 1, splitTo: 2 }]), undefined);
        // A single action needs no id.
        assert.deepEqual(combineSameDaySplits([{ ...day, splitFrom: 1, splitTo: 10 }]), { ...day, splitFrom: 1, splitTo: 10 });
    });

    test("gives up when any action that day has no ratio, rather than applying part of it", () => {
        assert.equal(combineSameDaySplits([{ ...day, splitFrom: 1, splitTo: 2, id: "A" }, { ...day, id: "B" }]), undefined);
        assert.equal(combineSameDaySplits([]), undefined);
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
        const effective = "2026-10-15T04:00:00.000Z";
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

describe("buildHeldSinceQuery", () => {
    test("groups positions by upper-case symbol with their oldest update", () => {
        const { sql } = buildHeldSinceQuery().toSQL();
        assert.equal(sql, 'select upper("symbol"), min("updated_at") from "holdings" group by upper("holdings"."symbol")');
    });
});

describe("reconcileHoldingSplits", () => {
    test("one update per stock and day, oldest first; other stocks ignored", async () => {
        const seen: string[] = [];
        const outcome = await reconcileHoldingSplits(
            [
                { symbol: "NVDA", executionDate: "2026-10-16", splitFrom: 1, splitTo: 2, id: "B" },
                { symbol: "NVDA", executionDate: "2026-09-15", splitFrom: 1, splitTo: 10, id: "A" },
                { symbol: "TSLA", executionDate: "2026-09-01", splitFrom: 1, splitTo: 3, id: "T" },
            ],
            new Set(["NVDA"]),
            async (split) => {
                seen.push(`${split.executionDate} ${split.splitTo}:${split.splitFrom}`);
                return 1;
            },
        );
        assert.deepEqual(seen, ["2026-09-15 10:1", "2026-10-16 2:1"]);
        assert.deepEqual(outcome.unadjusted, []);
        assert.equal(outcome.adjusted.length, 2);
    });
});
