import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    STORAGE_SCOPE_ATTRIBUTE,
    adoptSharedValues,
    currentStorageScope,
    readUserValue,
    removeUserValue,
    storageScopeFor,
    userScopedStateStorage,
    userStorageKey,
    writeUserValue,
} from "./user-scope";

class FakeStorage {
    readonly store = new Map<string, string>();
    getItem(key: string) { return this.store.get(key) ?? null; }
    setItem(key: string, value: string) { this.store.set(key, value); }
    removeItem(key: string) { this.store.delete(key); }
}

/** Storage that refuses writes past `capacity` characters of keys and values, as a full quota does. */
class QuotaStorage extends FakeStorage {
    constructor(private readonly capacity: number) { super(); }
    override setItem(key: string, value: string) {
        const used = [...this.store.entries()].filter(([k]) => k !== key).reduce((sum, [k, v]) => sum + k.length + v.length, 0);
        if (used + key.length + value.length > this.capacity) throw new Error("QuotaExceededError");
        super.setItem(key, value);
    }
}

function documentWithScope(scope: string | null) {
    return { documentElement: { getAttribute: (name: string) => (name === STORAGE_SCOPE_ATTRIBUTE ? scope : null) } } as unknown as Document;
}

describe("storage scope", () => {
    test("is the user ID, or anonymous without one", () => {
        assert.equal(storageScopeFor(" user-a "), "user-a");
        assert.equal(storageScopeFor(null), "anonymous");
        assert.equal(storageScopeFor(""), "anonymous");
    });

    test("is read from the attribute the layout puts on <html>", () => {
        assert.equal(currentStorageScope(documentWithScope("user-a")), "user-a");
        assert.equal(currentStorageScope(documentWithScope(null)), "anonymous");
        assert.equal(currentStorageScope(undefined), "anonymous");
    });

    test("keys a value by base and scope", () => {
        assert.equal(userStorageKey("pm-ask-v1", "user-a"), "pm-ask-v1:user-a");
    });
});

describe("readUserValue and writeUserValue", () => {
    test("keep each user's value apart", () => {
        const storage = new FakeStorage();
        writeUserValue(storage, "pm-ask-v1", "a's history", "user-a");
        writeUserValue(storage, "pm-ask-v1", "b's history", "user-b");

        assert.equal(readUserValue(storage, "pm-ask-v1", "user-a"), "a's history");
        assert.equal(readUserValue(storage, "pm-ask-v1", "user-b"), "b's history");
        assert.equal(readUserValue(storage, "pm-ask-v1", "user-c"), null);
    });

    test("move a value saved under the shared key to the first signed-in user who reads it", () => {
        const storage = new FakeStorage();
        storage.setItem("pm-ask-v1", "history from before");

        assert.equal(readUserValue(storage, "pm-ask-v1", "user-a"), "history from before");
        assert.equal(storage.getItem("pm-ask-v1"), null);
        assert.equal(storage.getItem("pm-ask-v1:user-a"), "history from before");
        assert.equal(readUserValue(storage, "pm-ask-v1", "user-b"), null);
    });

    test("never hand the shared value to an anonymous reader", () => {
        const storage = new FakeStorage();
        storage.setItem("pm-ask-v1", "history from before");

        assert.equal(readUserValue(storage, "pm-ask-v1", "anonymous"), null);
        assert.equal(storage.getItem("pm-ask-v1"), "history from before");
    });

    test("prefer the user's own value over a leftover shared one", () => {
        const storage = new FakeStorage();
        storage.setItem("pm-ask-v1", "someone else's");
        writeUserValue(storage, "pm-ask-v1", "mine", "user-a");

        assert.equal(readUserValue(storage, "pm-ask-v1", "user-a"), "mine");
    });

    test("regression: move a shared value even when there's no room for two copies", () => {
        // Room for the value under its longer, per-user key, but not twice.
        const storage = new QuotaStorage("atlas:research:theses:user-a".length + 20);
        storage.setItem("atlas:research:theses", "x".repeat(20));

        assert.equal(readUserValue(storage, "atlas:research:theses", "user-a"), "x".repeat(20));
        assert.equal(storage.getItem("atlas:research:theses:user-a"), "x".repeat(20));
        assert.equal(storage.getItem("atlas:research:theses"), null);
    });

    test("keep the shared value where it is when it can't be moved at all", () => {
        // Only room for the value under its shorter, shared key.
        const storage = new QuotaStorage("pm-ask-v1".length + 20);
        storage.setItem("pm-ask-v1", "x".repeat(20));

        // The user still gets their data, and nothing was lost.
        assert.equal(readUserValue(storage, "pm-ask-v1", "user-a"), "x".repeat(20));
        assert.equal(storage.getItem("pm-ask-v1"), "x".repeat(20));
    });

    test("treat missing or failing storage as empty", () => {
        const failing = {
            getItem: () => { throw new Error("SecurityError"); },
            setItem: () => { throw new Error("QuotaExceededError"); },
            removeItem: () => { throw new Error("SecurityError"); },
        };

        assert.equal(readUserValue(null, "pm-ask-v1", "user-a"), null);
        assert.equal(readUserValue(failing, "pm-ask-v1", "user-a"), null);
        assert.doesNotThrow(() => writeUserValue(failing, "pm-ask-v1", "x", "user-a"));
        assert.doesNotThrow(() => removeUserValue(failing, "pm-ask-v1", "user-a"));
    });

    test("removeUserValue removes only that user's value", () => {
        const storage = new FakeStorage();
        writeUserValue(storage, "pm-ask-v1", "a", "user-a");
        writeUserValue(storage, "pm-ask-v1", "b", "user-b");

        removeUserValue(storage, "pm-ask-v1", "user-a");

        assert.equal(storage.getItem("pm-ask-v1:user-a"), null);
        assert.equal(storage.getItem("pm-ask-v1:user-b"), "b");
    });
});

describe("adoptSharedValues", () => {
    test("regression: hands every shared value to the signed-in user at once, not just the one opened", () => {
        const storage = new FakeStorage();
        storage.setItem("pm-ask-v1", "a's questions");
        storage.setItem("atlas:research:theses", "a's theses");

        adoptSharedValues(storage, ["pm-ask-v1", "atlas:research:theses", "pm-pattern-snoozed"], "user-a");

        assert.equal(storage.getItem("pm-ask-v1:user-a"), "a's questions");
        assert.equal(storage.getItem("atlas:research:theses:user-a"), "a's theses");
        assert.equal(storage.getItem("pm-pattern-snoozed:user-a"), null);
        // Nothing is left for the next account to pick up.
        assert.equal(readUserValue(storage, "pm-ask-v1", "user-b"), null);
        assert.equal(readUserValue(storage, "atlas:research:theses", "user-b"), null);
    });

    test("removes a shared value the user already has a copy of", () => {
        const storage = new FakeStorage();
        writeUserValue(storage, "pm-ask-v1", "mine", "user-a");
        storage.setItem("pm-ask-v1", "left behind");

        adoptSharedValues(storage, ["pm-ask-v1"], "user-a");

        assert.equal(storage.getItem("pm-ask-v1:user-a"), "mine");
        assert.equal(storage.getItem("pm-ask-v1"), null);
    });

    test("leaves shared values alone without a signed-in user", () => {
        const storage = new FakeStorage();
        storage.setItem("pm-ask-v1", "someone's");

        adoptSharedValues(storage, ["pm-ask-v1"], "anonymous");
        adoptSharedValues(null, ["pm-ask-v1"], "user-a");

        assert.equal(storage.getItem("pm-ask-v1"), "someone's");
    });
});

describe("userScopedStateStorage", () => {
    test("stores a Zustand store under the current user's key", () => {
        const storage = new FakeStorage();
        const scoped = userScopedStateStorage(() => storage);

        scoped.setItem("atlas-alerts", '{"state":{}}');

        // Outside a browser the scope is anonymous.
        assert.equal(storage.getItem("atlas-alerts:anonymous"), '{"state":{}}');
        assert.equal(scoped.getItem("atlas-alerts"), '{"state":{}}');
        scoped.removeItem("atlas-alerts");
        assert.equal(storage.getItem("atlas-alerts:anonymous"), null);
    });
});
