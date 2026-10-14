import { describe, test } from "node:test";
import assert from "node:assert";
import { loadDashboardPortfolios } from "./dashboard-portfolios.ts";

function silence(method: "warn" | "error") {
    const original = console[method];
    const calls: unknown[][] = [];
    console[method] = (...args: unknown[]) => calls.push(args);
    return { calls, restore: () => { console[method] = original; } };
}

describe("loadDashboardPortfolios", () => {
    test("passes the required user scope to the query", async () => {
        const seenUserIds: string[] = [];
        const result = await loadDashboardPortfolios("user-a", async (userId) => {
            seenUserIds.push(userId);
            return [{ id: "portfolio-1" }];
        }, { databaseConfigured: true });

        assert.deepStrictEqual(result, { portfolios: [{ id: "portfolio-1" }], unavailable: false });
        assert.deepStrictEqual(seenUserIds, ["user-a"]);
    });

    test("reports an outage when a configured database fails", async () => {
        const errors = silence("error");
        try {
            const result = await loadDashboardPortfolios("user-a", async () => {
                throw new Error("database unavailable");
            }, { databaseConfigured: true });

            assert.deepStrictEqual(result, { portfolios: [], unavailable: true });
            assert.strictEqual(errors.calls.length, 1);
            assert.match(String(errors.calls[0][0]), /outage notice/);
        } finally {
            errors.restore();
        }
    });

    test("degrades to an empty list when no database is configured", async () => {
        const warnings = silence("warn");
        try {
            const result = await loadDashboardPortfolios("user-a", async () => {
                throw new Error("no database");
            }, { databaseConfigured: false });

            assert.deepStrictEqual(result, { portfolios: [], unavailable: false });
            assert.strictEqual(warnings.calls.length, 1);
            assert.match(String(warnings.calls[0][0]), /without a configured database/);
        } finally {
            warnings.restore();
        }
    });
});
