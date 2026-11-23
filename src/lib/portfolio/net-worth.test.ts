import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import { netWorthItems } from "@/db/schema";

import {
    ASSET_CATEGORIES,
    categoriesOf,
    DEBT_CATEGORIES,
    describeNetWorthCounts,
    editedValueAsOf,
    formatAsOf,
    kindOfCategory,
    NET_WORTH_CATEGORIES,
    NET_WORTH_CATEGORY_LABELS,
    NET_WORTH_KINDS,
    netWorthOf,
    outsideForToday,
    summarizeNetWorthItems,
    todayHeadline,
    type NetWorthItemRow,
} from "./net-worth";

const HOME: NetWorthItemRow = {
    id: "00000000-0000-4000-8000-000000000701", kind: "asset", category: "property", name: "Home",
    value: 300_000, valueAsOf: "2026-11-01", note: null, updatedAt: "2026-11-01T15:00:00.000Z",
};
const MORTGAGE: NetWorthItemRow = {
    ...HOME, id: "00000000-0000-4000-8000-000000000702", kind: "debt", category: "mortgage", name: "Mortgage",
    value: 200_000, valueAsOf: "2026-10-15",
};

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

describe("outsideForToday", () => {
    test("the items' totals once there is one; none, or no database, is null; unreadable stays unavailable", () => {
        assert.deepEqual(outsideForToday([HOME, MORTGAGE]), summarizeNetWorthItems([HOME, MORTGAGE]));
        assert.equal(outsideForToday([]), null);
        assert.equal(outsideForToday(null), null);
        assert.equal(outsideForToday("unavailable"), "unavailable");
    });
});

describe("todayHeadline", () => {
    test("with other assets and debts the net worth leads, with their totals and the oldest of their dates", () => {
        const outside = summarizeNetWorthItems([HOME, MORTGAGE]);
        assert.deepEqual(todayHeadline(10_000, outside), {
            label: "Net worth",
            netWorth: { value: 110_000, items: outside, asOf: "the oldest as of Oct 15, 2026" },
            unavailable: null,
        });
    });

    test("values all of one day are as of that day", () => {
        const headline = todayHeadline(10_000, summarizeNetWorthItems([HOME, { ...MORTGAGE, valueAsOf: HOME.valueAsOf }]));
        assert.equal(headline.netWorth?.asOf, "as of Nov 1, 2026");
    });

    test("debts larger than everything else lead with a negative net worth", () => {
        const headline = todayHeadline(10_000, summarizeNetWorthItems([{ ...MORTGAGE, value: 25_000 }]));
        assert.equal(headline.label, "Net worth");
        assert.equal(headline.netWorth?.value, -15_000);
    });

    test("without any, the portfolio value leads, as it did before there were any", () => {
        const none = { label: "Portfolio value", netWorth: null, unavailable: null };
        assert.deepEqual(todayHeadline(10_000, null), none);
        assert.deepEqual(todayHeadline(10_000, summarizeNetWorthItems([])), none);
    });

    test("unreadable, the portfolio value leads, labelled as such, with a line saying so", () => {
        assert.deepEqual(todayHeadline(10_000, "unavailable"), {
            label: "Portfolio value",
            netWorth: null,
            unavailable: "Other assets and debts couldn't be loaded, so this is your portfolio value alone.",
        });
    });
});

describe("describeNetWorthCounts", () => {
    test("counts each kind, leaving out a zero count, in the singular for one", () => {
        assert.equal(describeNetWorthCounts({ assetCount: 1, debtCount: 0 }), "1 asset, at the value and date you gave");
        assert.equal(describeNetWorthCounts({ assetCount: 0, debtCount: 1 }), "1 debt, at the value and date you gave");
        assert.equal(describeNetWorthCounts({ assetCount: 1, debtCount: 1 }), "1 asset and 1 debt, at the values and dates you gave");
        assert.equal(describeNetWorthCounts({ assetCount: 2, debtCount: 1 }), "2 assets and 1 debt, at the values and dates you gave");
        assert.equal(describeNetWorthCounts({ assetCount: 2, debtCount: 3 }), "2 assets and 3 debts, at the values and dates you gave");
        assert.equal(describeNetWorthCounts({ assetCount: 0, debtCount: 3 }), "3 debts, at the values and dates you gave");
    });

    test("none is null: the card says what it's for instead", () => {
        assert.equal(describeNetWorthCounts({ assetCount: 0, debtCount: 0 }), null);
    });
});

describe("editedValueAsOf", () => {
    const TODAY = "2026-11-23";

    test("the value as it was keeps the item's own date, to the cent", () => {
        assert.equal(editedValueAsOf(HOME, 300_000, TODAY), "2026-11-01");
        assert.equal(editedValueAsOf(HOME, 300_000.004, TODAY), "2026-11-01");
        // A date after today, which is allowed, is kept too.
        assert.equal(editedValueAsOf({ value: 20_000, valueAsOf: "2026-12-31" }, 20_000, TODAY), "2026-12-31");
    });

    test("a new value is as of today", () => {
        assert.equal(editedValueAsOf(HOME, 320_000, TODAY), TODAY);
        assert.equal(editedValueAsOf(HOME, 300_000.01, TODAY), TODAY);
    });

    test("no value, or one that isn't a number, is as of today", () => {
        assert.equal(editedValueAsOf(HOME, null, TODAY), TODAY);
        assert.equal(editedValueAsOf(HOME, Number.NaN, TODAY), TODAY);
    });
});

describe("formatAsOf", () => {
    test("a day is that day wherever it's shown", () => {
        assert.equal(formatAsOf("2026-11-01"), "Nov 1, 2026");
        assert.equal(formatAsOf("2026-12-31"), "Dec 31, 2026");
    });
});
