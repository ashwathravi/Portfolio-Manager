import { describe, test } from "node:test";
import assert from "node:assert";
import { loadDashboardPortfolios } from "./dashboard-portfolios.ts";

describe("loadDashboardPortfolios", () => {
    test("passes the required user scope to the query", async () => {
        const seenUserIds: string[] = [];
        const portfolios = await loadDashboardPortfolios("user-a", async (userId) => {
            seenUserIds.push(userId);
            return [{ id: "portfolio-1" }];
        });

        assert.deepStrictEqual(portfolios, [{ id: "portfolio-1" }]);
        assert.deepStrictEqual(seenUserIds, ["user-a"]);
    });

    test("returns an empty list when persistence is unavailable", async () => {
        const originalWarn = console.warn;
        const warnings: unknown[][] = [];
        console.warn = (...args: unknown[]) => warnings.push(args);

        try {
            const portfolios = await loadDashboardPortfolios("user-a", async () => {
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
