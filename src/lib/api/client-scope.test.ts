import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { clientApiScopeHeaders, resolveClientApiUserId } from "./client-scope";

const USER_ID_A = "11111111-1111-4111-8111-111111111111";
const USER_ID_B = "22222222-2222-4222-8222-222222222222";

describe("client API scope helpers", () => {
    test("reuses an existing scoped user id", () => {
        const storage = memoryStorage({ "atlas.apiUserId": USER_ID_A });

        assert.equal(
            resolveClientApiUserId({
                storage,
                randomUuid: () => USER_ID_B,
            }),
            USER_ID_A,
        );
        assert.equal(storage.getItem("atlas.apiUserId"), USER_ID_A);
    });

    test("generates and stores a user id when none exists", () => {
        const storage = memoryStorage();

        assert.equal(
            resolveClientApiUserId({
                storage,
                randomUuid: () => USER_ID_A,
            }),
            USER_ID_A,
        );
        assert.equal(storage.getItem("atlas.apiUserId"), USER_ID_A);
    });

    test("does not create a scoped header without a valid user id source", () => {
        assert.equal(
            resolveClientApiUserId({
                storage: memoryStorage(),
                randomUuid: () => "not-a-uuid",
            }),
            null,
        );
    });

    test("adds x-user-id without replacing caller-provided headers", () => {
        const headers = clientApiScopeHeaders({
            "Content-Type": "application/json",
            "x-user-id": USER_ID_A,
        });

        assert.equal(headers.get("Content-Type"), "application/json");
        assert.equal(headers.get("x-user-id"), USER_ID_A);
    });
});

function memoryStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
    };
}
