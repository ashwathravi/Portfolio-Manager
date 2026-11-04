import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { resetApiSecurityForTests } from "@/lib/api/security";

import { POST as createStrategy } from "./route";
import { DELETE as deleteStrategy, PUT as updateStrategy } from "./[id]/route";
import { POST as runBacktest } from "./[id]/backtest/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const STRATEGY_ID = "00000000-0000-4000-8000-000000000501";

const request = (method: string, path: string, body?: unknown) => new Request(`https://atlas.test${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
});
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const valid = {
    name: "Trend",
    definition: {
        rules: [{ id: "r1", field: "Close", op: ">", value: "SMA(50)" }],
        conjunctions: [],
        symbols: ["SPY"],
        guardrails: { maxPositionPct: 0.1, stopLossPct: 0.1, rebalanceDays: 7 },
    },
};

describe("strategy routes", () => {
    afterEach(() => {
        delete process.env.AUTH_LOCAL_DEV_BYPASS;
        delete process.env.AUTH_LOCAL_DEV_USER_ID;
        resetApiSecurityForTests();
    });

    const signedIn = () => {
        process.env.AUTH_LOCAL_DEV_BYPASS = "1";
        process.env.AUTH_LOCAL_DEV_USER_ID = USER_ID;
    };

    test("fail closed when sign-in isn't configured", async () => {
        assert.equal((await createStrategy(request("POST", "/api/strategies", valid))).status, 503);
        assert.equal((await updateStrategy(request("PUT", `/api/strategies/${STRATEGY_ID}`, valid), params(STRATEGY_ID))).status, 503);
        assert.equal((await deleteStrategy(request("DELETE", `/api/strategies/${STRATEGY_ID}`), params(STRATEGY_ID))).status, 503);
        assert.equal((await runBacktest(request("POST", `/api/strategies/${STRATEGY_ID}/backtest`), params(STRATEGY_ID))).status, 503);
    });

    test("a strategy that doesn't validate is refused, naming the field, before anything is saved", async () => {
        signedIn();
        const extra = await createStrategy(request("POST", "/api/strategies", { ...valid, userId: "someone-else" }));
        assert.equal(extra.status, 400);
        assert.equal((await extra.json()).code, "INVALID_STRATEGY");

        const glue = await createStrategy(request("POST", "/api/strategies", {
            ...valid,
            definition: { ...valid.definition, conjunctions: ["AND"] },
        }));
        assert.deepEqual(await glue.json(), { error: "definition.conjunctions: conjunctions must be one fewer than rules", code: "INVALID_STRATEGY" });

        const ticker = await updateStrategy(request("PUT", `/api/strategies/${STRATEGY_ID}`, {
            ...valid,
            definition: { ...valid.definition, symbols: ["spy"] },
        }), params(STRATEGY_ID));
        assert.equal(ticker.status, 400);

        assert.equal((await createStrategy(request("POST", "/api/strategies", "{not json"))).status, 400);
        assert.equal((await createStrategy(request("POST", "/api/strategies", { ...valid, description: "x".repeat(40 * 1024) }))).status, 413);
    });

    test("an ID that can't be a strategy is a 404 on every route", async () => {
        signedIn();
        const missing = await updateStrategy(request("PUT", "/api/strategies/strategy-momentum-value", valid), params("strategy-momentum-value"));
        assert.equal(missing.status, 404);
        assert.deepEqual(await missing.json(), { error: "Strategy not found", code: "STRATEGY_NOT_FOUND" });
        assert.equal((await deleteStrategy(request("DELETE", "/api/strategies/x"), params("x"))).status, 404);
        assert.equal((await runBacktest(request("POST", "/api/strategies/x/backtest"), params("x"))).status, 404);
    });
});
