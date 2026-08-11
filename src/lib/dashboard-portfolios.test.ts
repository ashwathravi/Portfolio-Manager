import { describe, test } from "node:test";
import assert from "node:assert";
import { loadDashboardPortfolios } from "./dashboard-portfolios.ts";

describe("loadDashboardPortfolios", () => {
    test("returns portfolios when the query succeeds", async () => {
        const portfolios = await loadDashboardPortfolios(async () => [{ id: "portfolio-1" }]);

        assert.deepStrictEqual(portfolios, [{ id: "portfolio-1" }]);
    });

    test("returns an empty list when persistence is unavailable", async () => {
        const originalWarn = console.warn;
        const warnings: unknown[][] = [];
        console.warn = (...args: unknown[]) => warnings.push(args);

        try {
            const portfolios = await loadDashboardPortfolios(async () => {
                throw new Error("database unavailable");
            });

            assert.deepStrictEqual(portfolios, []);
            assert.strictEqual(warnings.length, 1);
            assert.match(String(warnings[0][0]), /Dashboard portfolio fetch failed/);
        } finally {
            console.warn = originalWarn;
        }
    });
});
