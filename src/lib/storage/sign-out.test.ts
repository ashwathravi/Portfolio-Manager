import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { SETTINGS_STORAGE_KEY } from "@/lib/settings/sync";

import { CLEARED_ON_SIGN_OUT, clearBrowserDataOnSignOut } from "./sign-out";
import { userStorageKey } from "./user-scope";

class FakeStorage {
    readonly store = new Map<string, string>();
    getItem(key: string) { return this.store.get(key) ?? null; }
    setItem(key: string, value: string) { this.store.set(key, value); }
    removeItem(key: string) { this.store.delete(key); }
}

describe("clearBrowserDataOnSignOut", () => {
    test("removes the Ask transcript of the user signing out only", () => {
        const storage = new FakeStorage();
        storage.setItem(userStorageKey("pm-ask-v1", "user-a"), "a's questions");
        storage.setItem(userStorageKey("pm-ask-v1", "user-b"), "b's questions");

        clearBrowserDataOnSignOut(storage, "user-a");

        assert.equal(storage.getItem(userStorageKey("pm-ask-v1", "user-a")), null);
        assert.equal(storage.getItem(userStorageKey("pm-ask-v1", "user-b")), "b's questions");
    });

    test("keeps data this browser holds the only copy of", () => {
        const storage = new FakeStorage();
        for (const base of ["atlas:research:theses", "atlas:research:journal", "atlas:research:watchlist", "atlas-alerts", "pm-weekly-reviews-v1"]) {
            storage.setItem(userStorageKey(base, "user-a"), "kept");
        }

        clearBrowserDataOnSignOut(storage, "user-a");

        assert.equal(storage.store.size, 5);
        assert.deepEqual([...CLEARED_ON_SIGN_OUT], ["pm-ask-v1"]);
    });

    test("removes settings the server has saved; they come back from there", () => {
        const storage = new FakeStorage();
        storage.setItem(userStorageKey(SETTINGS_STORAGE_KEY, "user-a"), JSON.stringify({ state: {}, version: 15, pending: false }));

        clearBrowserDataOnSignOut(storage, "user-a");

        assert.equal(storage.getItem(userStorageKey(SETTINGS_STORAGE_KEY, "user-a")), null);
    });

    test("keeps settings the server hasn't saved, or never had", () => {
        for (const copy of [{ state: {}, version: 15, pending: true }, { state: {}, version: 15 }]) {
            const storage = new FakeStorage();
            storage.setItem(userStorageKey(SETTINGS_STORAGE_KEY, "user-a"), JSON.stringify(copy));

            clearBrowserDataOnSignOut(storage, "user-a");

            assert.notEqual(storage.getItem(userStorageKey(SETTINGS_STORAGE_KEY, "user-a")), null, JSON.stringify(copy));
        }
    });

    test("does nothing without storage", () => {
        assert.doesNotThrow(() => clearBrowserDataOnSignOut(null, "user-a"));
    });
});
