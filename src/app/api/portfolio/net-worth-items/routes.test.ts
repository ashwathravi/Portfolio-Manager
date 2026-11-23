import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { resetApiSecurityForTests } from "@/lib/api/security";

import { POST as addItem } from "./route";
import { DELETE as deleteItem, PUT as saveItem } from "./[id]/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "00000000-0000-4000-8000-000000000701";
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
// Never reached: every request below is answered before any query.
const UNREACHABLE_DATABASE_URL = "postgres://atlas_app:pw@db.example.invalid:6543/postgres";

const HOME = { kind: "asset", category: "property", name: "Home", value: 300_000, valueAsOf: "2026-11-01" };

const request = (method: string, path: string, body?: unknown) => new Request(`https://atlas.test${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
});
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const add = (body: unknown) => addItem(request("POST", "/api/portfolio/net-worth-items", body));
const save = (id: string, body: unknown) => saveItem(request("PUT", `/api/portfolio/net-worth-items/${id}`, body), params(id));
const remove = (id: string) => deleteItem(request("DELETE", `/api/portfolio/net-worth-items/${id}`), params(id));

// What is stored, and for whom, is in scripts/db/net-worth-items.test.ts.
describe("other assets and debts routes", () => {
    afterEach(() => {
        delete process.env.AUTH_LOCAL_DEV_BYPASS;
        delete process.env.AUTH_LOCAL_DEV_USER_ID;
        if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
        resetApiSecurityForTests();
    });

    const signedIn = () => {
        process.env.AUTH_LOCAL_DEV_BYPASS = "1";
        process.env.AUTH_LOCAL_DEV_USER_ID = USER_ID;
    };

    test("fail closed when sign-in isn't configured", async () => {
        assert.equal((await add(HOME)).status, 503);
        assert.equal((await save(ITEM_ID, HOME)).status, 503);
        assert.equal((await remove(ITEM_ID)).status, 503);
    });

    test("say they aren't kept without a database", async () => {
        signedIn();
        delete process.env.DATABASE_URL;
        for (const response of [await add(HOME), await save(ITEM_ID, HOME), await remove(ITEM_ID)]) {
            assert.equal(response.status, 503);
            assert.deepEqual(await response.json(), {
                error: "Assets and debts are kept with your account, and this server has no database.",
                code: "NET_WORTH_NOT_STORED",
            });
        }
    });

    test("an item that doesn't validate is refused, naming the problem, before anything is saved", async () => {
        signedIn();
        process.env.DATABASE_URL = UNREACHABLE_DATABASE_URL;

        const mismatched = await add({ ...HOME, category: "mortgage" });
        assert.equal(mismatched.status, 400);
        assert.deepEqual(await mismatched.json(), { error: "Choose a kind of asset", code: "INVALID_NET_WORTH_ITEM" });

        const extra = await add({ ...HOME, userId: "someone-else" });
        assert.equal(extra.status, 400);
        assert.equal((await extra.json()).code, "INVALID_NET_WORTH_ITEM");

        const malformed = await add("{not json");
        assert.equal(malformed.status, 400);
        assert.deepEqual(await malformed.json(), { error: "Invalid asset or debt", code: "INVALID_NET_WORTH_ITEM" });

        const large = await add({ ...HOME, note: "n".repeat(5 * 1024) });
        assert.equal(large.status, 413);
        assert.equal((await large.json()).code, "INVALID_NET_WORTH_ITEM");

        // A day Postgres can't store is the form's 400, never the database's 500.
        const yearZero = await add({ ...HOME, valueAsOf: "0000-12-31" });
        assert.equal(yearZero.status, 400);
        assert.deepEqual(await yearZero.json(), { error: "Enter the date of the value (YYYY-MM-DD)", code: "INVALID_NET_WORTH_ITEM" });

        // An edit is held to the same item.
        const edit = await save(ITEM_ID, { ...HOME, kind: "debt", category: "vehicle" });
        assert.equal(edit.status, 400);
        assert.deepEqual(await edit.json(), { error: "Choose a kind of debt", code: "INVALID_NET_WORTH_ITEM" });
        assert.equal((await save(ITEM_ID, "{not json")).status, 400);
        assert.equal((await save(ITEM_ID, { ...HOME, note: "n".repeat(5 * 1024) })).status, 413);
    });

    test("an ID that can't be an item is a 404 before any query", async () => {
        signedIn();
        process.env.DATABASE_URL = UNREACHABLE_DATABASE_URL;
        for (const response of [await save("not-a-uuid", HOME), await remove("not-a-uuid"), await remove(`${ITEM_ID}x`)]) {
            assert.equal(response.status, 404);
            assert.deepEqual(await response.json(), { error: "Asset or debt not found", code: "NET_WORTH_ITEM_NOT_FOUND" });
        }
    });
});
