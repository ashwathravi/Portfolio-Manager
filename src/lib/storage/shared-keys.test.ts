import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { FORMERLY_SHARED_KEYS, adoptFormerlySharedData } from "./shared-keys";
import { userStorageKey } from "./user-scope";

class FakeStorage {
    readonly store = new Map<string, string>();
    getItem(key: string) { return this.store.get(key) ?? null; }
    setItem(key: string, value: string) { this.store.set(key, value); }
    removeItem(key: string) { this.store.delete(key); }
}

describe("adoptFormerlySharedData", () => {
    test("covers every key that used to be shared", () => {
        assert.deepEqual([...FORMERLY_SHARED_KEYS].sort(), [
            "atlas-alerts",
            "atlas-settings",
            "atlas:research:journal",
            "atlas:research:theses",
            "pm-ask-v1",
            "pm-pattern-snoozed",
            "pm-weekly-reviews-v1",
        ]);
    });

    test("moves each of them to the signed-in user", () => {
        const storage = new FakeStorage();
        for (const key of FORMERLY_SHARED_KEYS) storage.setItem(key, `old ${key}`);

        adoptFormerlySharedData(storage, "user-a");

        for (const key of FORMERLY_SHARED_KEYS) {
            assert.equal(storage.getItem(key), null, key);
            assert.equal(storage.getItem(userStorageKey(key, "user-a")), `old ${key}`, key);
        }
    });
});
