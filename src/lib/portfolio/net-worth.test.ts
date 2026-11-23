import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import { netWorthItems } from "@/db/schema";

import {
    ASSET_CATEGORIES,
    categoriesOf,
    DEBT_CATEGORIES,
    kindOfCategory,
    NET_WORTH_CATEGORIES,
    NET_WORTH_CATEGORY_LABELS,
    NET_WORTH_KINDS,
    netWorthOf,
    summarizeNetWorthItems,
} from "./net-worth";

describe("net worth categories", () => {
    test("every category belongs to exactly one kind, and the form lists assets first", () => {
        for (const category of ASSET_CATEGORIES) assert.equal(kindOfCategory(category), "asset", category);
        for (const category of DEBT_CATEGORIES) assert.equal(kindOfCategory(category), "debt", category);
        assert.deepEqual(NET_WORTH_CATEGORIES, [...ASSET_CATEGORIES, ...DEBT_CATEGORIES]);
        assert.equal(new Set(NET_WORTH_CATEGORIES).size, NET_WORTH_CATEGORIES.length);
        assert.deepEqual(categoriesOf("asset"), ASSET_CATEGORIES);
        assert.deepEqual(categoriesOf("debt"), DEBT_CATEGORIES);
    });

    test("every category has the form's label", () => {
        assert.deepEqual(NET_WORTH_CATEGORIES.map((c) => NET_WORTH_CATEGORY_LABELS[c]), [
            "Home or property", "Vehicle", "Cash in the bank", "Valuables", "Money owed to you", "Other asset",
            "Mortgage", "Auto loan", "Credit card", "Student loan", "Other loan or debt",
        ]);
    });

    // The kinds and categories live twice: here and in the table's checks
    // (migration 0040). Adding one here alone would pass the validator and
    // then fail every save.
    test("the table's checks allow exactly these kinds, each with its own categories", () => {
        const dialect = new PgDialect();
        const checks = new Map(getTableConfig(netWorthItems).checks.map((c) => [c.name, dialect.sqlToQuery(c.value).sql]));
        const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
        assert.equal(checks.get("net_worth_items_kind_check"), `"net_worth_items"."kind" in (${list(NET_WORTH_KINDS)})`);
        assert.equal(
            checks.get("net_worth_items_category_check"),
            `("net_worth_items"."kind" = 'asset' and "net_worth_items"."category" in (${list(ASSET_CATEGORIES)}))`
            + ` or ("net_worth_items"."kind" = 'debt' and "net_worth_items"."category" in (${list(DEBT_CATEGORIES)}))`,
        );
    });
});

describe("summarizeNetWorthItems", () => {
    test("totals assets and debts apart, to the cent, from numbers or numeric strings, with the dates they span", () => {
        const summary = summarizeNetWorthItems([
            { kind: "asset", value: 300_000, valueAsOf: "2026-11-01" },
            { kind: "debt", value: "200000.10", valueAsOf: "2026-10-15" },
            { kind: "asset", value: "1234.56", valueAsOf: "2026-11-20" },
            { kind: "debt", value: 999.9, valueAsOf: "2026-11-02" },
        ]);
        assert.deepEqual(summary, {
            otherAssets: 301_234.56,
            debts: 201_000,
            assetCount: 2,
            debtCount: 2,
            oldestAsOf: "2026-10-15",
            newestAsOf: "2026-11-20",
        });
    });

    test("nothing entered: zeros and no dates", () => {
        assert.deepEqual(summarizeNetWorthItems([]), { otherAssets: 0, debts: 0, assetCount: 0, debtCount: 0, oldestAsOf: null, newestAsOf: null });
    });

    test("cents don't drift: 0.1 and 0.2 are 0.3", () => {
        const summary = summarizeNetWorthItems([
            { kind: "asset", value: 0.1, valueAsOf: "2026-11-01" },
            { kind: "asset", value: 0.2, valueAsOf: "2026-11-01" },
        ]);
        assert.equal(summary.otherAssets, 0.3);
        assert.equal(netWorthOf(0.1, { otherAssets: 0.2, debts: 0 }), 0.3);
    });
});

describe("netWorthOf", () => {
    test("adds the other assets to the portfolio value and takes off the debts", () => {
        assert.equal(netWorthOf(10_000, { otherAssets: 300_000, debts: 200_000 }), 110_000);
    });

    test("debts larger than everything else give a negative net worth, never clamped to zero", () => {
        assert.equal(netWorthOf(10_000, { otherAssets: 0, debts: 25_000 }), -15_000);
    });

    test("exactly nothing left is zero, not minus zero", () => {
        assert.ok(Object.is(netWorthOf(100, { otherAssets: 0, debts: 100 }), 0));
    });
});
