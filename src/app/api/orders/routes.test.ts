import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { resetApiSecurityForTests } from "@/lib/api/security";

import { POST as createOrder } from "./route";
import { PATCH as changeOrder } from "./[id]/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "00000000-0000-4000-8000-000000000301";

const post = (body: unknown) => new Request("https://atlas.test/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
});
const patch = (body: unknown) => new Request(`https://atlas.test/api/orders/${ORDER_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("order plan routes", () => {
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
        assert.equal((await createOrder(post({}))).status, 503);
        assert.equal((await changeOrder(patch({ status: "cancelled" }), params(ORDER_ID))).status, 503);
    });

    test("a plan that doesn't validate is refused, naming the field, before anything is saved", async () => {
        signedIn();
        const response = await createOrder(post({
            portfolioId: "00000000-0000-4000-8000-000000000001",
            instrumentType: "equity",
            ticker: "IBM",
            side: "buy",
            type: "limit",
            quantity: 3,
            timeInForce: "day",
            needsApproval: false,
        }));
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: "limitPrice: A limit order needs a limit price", code: "INVALID_ORDER" });

        const garbled = await createOrder(post("{not json"));
        assert.equal(garbled.status, 400);
        assert.equal((await garbled.json()).code, "INVALID_ORDER");

        const huge = await createOrder(post({ pad: "x".repeat(40 * 1024) }));
        assert.equal(huge.status, 413);
    });

    test("a status change needs a plan ID and a status the blotter can ask for", async () => {
        signedIn();
        const unknown = await changeOrder(patch({ status: "cancelled" }), params("o-1001"));
        assert.equal(unknown.status, 404);
        assert.deepEqual(await unknown.json(), { error: "Order not found", code: "ORDER_NOT_FOUND" });

        for (const body of [{ status: "filled" }, { status: "pending_approval" }, {}]) {
            const response = await changeOrder(patch(body), params(ORDER_ID));
            assert.equal(response.status, 400, JSON.stringify(body));
            assert.equal((await response.json()).code, "INVALID_ORDER_STATUS");
        }
    });
});
