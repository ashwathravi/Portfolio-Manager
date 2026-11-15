import { describe, mock, test } from "node:test";
import assert from "node:assert/strict";

import { SEED_STRATEGIES } from "./seed";
import { loadStrategiesPage } from "./server";

const saved = [{ ...SEED_STRATEGIES[0], id: "00000000-0000-4000-8000-000000000501", example: undefined }];

describe("loadStrategiesPage", () => {
    test("without a database nothing is read: strategies stay in the tab", async () => {
        const load = mock.fn(async () => saved);
        assert.deepEqual(await loadStrategiesPage("user-a", { databaseConfigured: false, load }), {
            strategies: [],
            persisted: false,
            unavailable: false,
        });
        assert.equal(load.mock.callCount(), 0);
    });

    test("with one, the user's saved strategies, for that user", async () => {
        const load = mock.fn(async (userId: string) => (userId === "user-a" ? saved : []));
        assert.deepEqual(await loadStrategiesPage("user-a", { databaseConfigured: true, load }), {
            strategies: saved,
            persisted: true,
            unavailable: false,
        });
        assert.deepEqual(load.mock.calls.map((call) => call.arguments), [["user-a"]]);
    });

    test("regression: a failed read is an outage, never an empty list of strategies", async (t) => {
        const logged = t.mock.method(console, "error", () => {});
        const page = await loadStrategiesPage("user-a", {
            databaseConfigured: true,
            load: async () => {
                throw new Error("connection refused");
            },
        });
        assert.deepEqual(page, { strategies: [], persisted: true, unavailable: true });
        assert.equal(logged.mock.callCount(), 1);
    });
});
