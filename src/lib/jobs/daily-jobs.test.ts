import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_BUDGET_MS } from "@/lib/markets/price-ingest";

import { refreshMarketData } from "./daily-jobs";

describe("refreshMarketData", () => {
    test("refreshes the symbol directory first, then prices within what's left of their budget", async () => {
        const order: string[] = [];
        let clock = 1_000;
        let budget: number | undefined;
        const detail = await refreshMarketData({
            now: () => clock,
            directory: async () => {
                order.push("directory");
                clock += 1_500;
                return { entries: 9_900, added: 12, removed: 3 };
            },
            prices: async (options) => {
                order.push("prices");
                budget = options?.budgetMs;
                return { skipped: "Market data is not configured: POLYGON_API_KEY is not set." };
            },
        });

        assert.deepEqual(order, ["directory", "prices"]);
        assert.equal(budget, DEFAULT_BUDGET_MS - 1_500);
        assert.deepEqual(detail, {
            skipped: "Market data is not configured: POLYGON_API_KEY is not set.",
            symbolDirectory: { entries: 9_900, added: 12, removed: 3 },
        });
    });
});
