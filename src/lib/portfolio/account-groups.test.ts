import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { groupAccounts, NOT_SET, type AccountGroup } from "./account-groups";
import { buildAccountRows, summarizeAccounts } from "./accounts";

type Row = Parameters<typeof groupAccounts>[0][number];

const row = (name: string, totalUsd: number, fields: Partial<Pick<Row, "taxTreatment" | "ownership">> = {}): Row => ({
    name, totalUsd, taxTreatment: null, ownership: null, ...fields,
});

/** [key, label, total, share, accounts] for each group, for compact assertions. */
const brief = (groups: AccountGroup<string>[]) => groups.map((g) => [g.key, g.label, g.totalUsd, g.sharePct, g.accountNames]);

describe("the accounts' value by tax treatment and by ownership", () => {
    test("with no account saying either, there are no groups, so the page shows no split", () => {
        assert.deepEqual(groupAccounts([row("A", 2500), row("B", 6000)]), { byTaxTreatment: [], byOwnership: [] });
        assert.deepEqual(groupAccounts([]), { byTaxTreatment: [], byOwnership: [] });
    });

    test("each account counts whole in its tax treatment's group, in the list's order with Not set last", () => {
        const { byTaxTreatment } = groupAccounts([
            row("A", 2500, { taxTreatment: "taxable" }),
            row("B", 6000, { taxTreatment: "tax_deferred" }),
            row("C", 1000),
            row("D", 500, { taxTreatment: "taxable" }),
        ]);
        // Tax-free has no account, so it's left out.
        assert.deepEqual(brief(byTaxTreatment), [
            ["taxable", "Taxable", 3000, 30, ["A", "D"]],
            ["tax_deferred", "Tax-deferred", 6000, 60, ["B"]],
            [NOT_SET, "Not set", 1000, 10, ["C"]],
        ]);
        // The groups add up to all the accounts' value.
        assert.equal(byTaxTreatment.reduce((sum, g) => sum + g.totalUsd, 0), 10_000);
    });

    test("ownership groups apart from tax treatment, with its own labels", () => {
        const { byTaxTreatment, byOwnership } = groupAccounts([
            row("A", 2500, { ownership: "joint" }),
            row("B", 6000, { ownership: "individual", taxTreatment: "tax_free" }),
            row("C", 1000, { ownership: "dependent" }),
            row("D", 500),
        ]);
        assert.deepEqual(brief(byOwnership), [
            ["individual", "Individual", 6000, 60, ["B"]],
            ["joint", "Joint", 2500, 25, ["A"]],
            ["dependent", "For a dependent", 1000, 10, ["C"]],
            [NOT_SET, "Not set", 500, 5, ["D"]],
        ]);
        assert.deepEqual(brief(byTaxTreatment), [
            ["tax_free", "Tax-free", 6000, 60, ["B"]],
            [NOT_SET, "Not set", 4000, 40, ["A", "C", "D"]],
        ]);
    });

    test("one account saying is enough: the rest are Not set", () => {
        const { byOwnership } = groupAccounts([row("A", 100), row("B", 300, { ownership: "business" }), row("C", 600)]);
        assert.deepEqual(brief(byOwnership), [
            ["business", "Business", 300, 30, ["B"]],
            [NOT_SET, "Not set", 700, 70, ["A", "C"]],
        ]);
    });

    test("a value that isn't on the list counts as Not set, never as a group of its own", () => {
        assert.deepEqual(groupAccounts([row("A", 100, { taxTreatment: "exempt", ownership: "partner" })]), { byTaxTreatment: [], byOwnership: [] });
        const { byTaxTreatment, byOwnership } = groupAccounts([
            row("A", 100, { taxTreatment: "exempt", ownership: "Joint" }),
            row("B", 300, { taxTreatment: "taxable", ownership: "joint" }),
        ]);
        assert.deepEqual(byTaxTreatment.map((g) => [g.key, g.accountNames]), [["taxable", ["B"]], [NOT_SET, ["A"]]]);
        assert.deepEqual(byOwnership.map((g) => [g.key, g.accountNames]), [["joint", ["B"]], [NOT_SET, ["A"]]]);
    });

    test("with all the accounts worth nothing or less there are no shares; a negative group is shown as it is", () => {
        const none = groupAccounts([row("A", 0, { taxTreatment: "taxable" }), row("B", 0)]);
        assert.deepEqual(brief(none.byTaxTreatment), [["taxable", "Taxable", 0, null, ["A"]], [NOT_SET, "Not set", 0, null, ["B"]]]);
        const owing = groupAccounts([row("Margin", -500, { taxTreatment: "taxable" }), row("IRA", 200, { taxTreatment: "tax_deferred" })]);
        assert.deepEqual(owing.byTaxTreatment.map((g) => [g.totalUsd, g.sharePct]), [[-500, null], [200, null]]);
        // A margin balance in one account: its group is negative, and the others' shares pass 100%.
        const margin = groupAccounts([row("IRA", 1000, { taxTreatment: "tax_deferred" }), row("Margin", -200, { taxTreatment: "taxable" })]);
        assert.deepEqual(margin.byTaxTreatment.map((g) => [g.key, g.totalUsd, g.sharePct]), [["taxable", -200, -25], ["tax_deferred", 1000, 125]]);
    });

    test("cents add up exactly, and each group keeps the rows' order", () => {
        const { byTaxTreatment } = groupAccounts([
            row("First", 0.2, { taxTreatment: "taxable" }),
            row("Second", 0.1, { taxTreatment: "taxable" }),
            row("Third", 0.1),
        ]);
        assert.deepEqual(byTaxTreatment.map((g) => [g.totalUsd, g.accountNames]), [[0.3, ["First", "Second"]], [0.1, ["Third"]]]);
        assert.deepEqual(byTaxTreatment.map((g) => g.sharePct), [75, 25]);
    });

    test("from the page's rows: holdings valued by hand and cash included, adding up to the total value", () => {
        const rows = buildAccountRows([
            { id: "k", name: "401(k)", taxTreatment: "tax_deferred", ownership: "individual", cashBalance: 250, holdings: [], manualHoldings: [{ value: 10_000 }] },
            { id: "b", name: "Brokerage", taxTreatment: "taxable", cashBalance: 1000, holdings: [{ symbol: "VTI", quantity: 2, avgCost: 200, currentPrice: 250 }] },
        ]);
        const { byTaxTreatment, byOwnership } = groupAccounts(rows);
        assert.deepEqual(byTaxTreatment.map((g) => [g.key, g.totalUsd]), [["taxable", 1500], ["tax_deferred", 10_250]]);
        assert.deepEqual(byOwnership.map((g) => [g.key, g.totalUsd, g.accountNames]), [["individual", 10_250, ["401(k)"]], [NOT_SET, 1500, ["Brokerage"]]]);
        const total = summarizeAccounts(rows).totalUsd;
        for (const split of [byTaxTreatment, byOwnership]) assert.equal(split.reduce((sum, g) => sum + g.totalUsd, 0), total);
    });
});
