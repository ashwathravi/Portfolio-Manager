/**
 * Browser storage per signed-in user (launch item i39). Everything the app
 * keeps in localStorage lives under `<base key>:<user id>`, so on a shared
 * browser one account never loads another's theses, journal, alerts, review
 * notes, pattern snoozes or Ask history.
 *
 * The root layout puts the user's ID on <html> (`data-storage-scope`). The
 * attribute exists before any script runs, so stores that load at import time
 * (the Zustand ones) already see the right user; signing in or out is a full
 * page load, so it always matches the session.
 */

export const STORAGE_SCOPE_ATTRIBUTE = "data-storage-scope";
const ANONYMOUS_SCOPE = "anonymous";

type ReadableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The scope for a user ID, as the layout writes it. */
export function storageScopeFor(userId: string | null | undefined): string {
    return userId?.trim() || ANONYMOUS_SCOPE;
}

/** The signed-in user's scope in the browser; "anonymous" anywhere else. */
export function currentStorageScope(doc: Pick<Document, "documentElement"> | undefined = globalThis.document): string {
    return storageScopeFor(doc?.documentElement?.getAttribute(STORAGE_SCOPE_ATTRIBUTE));
}

export function userStorageKey(base: string, scope: string = currentStorageScope()): string {
    return `${base}:${scope}`;
}

/**
 * This user's value for `base`. A value saved before keys were per user
 * (under `base` itself) moves to the first signed-in user who reads it: on
 * this app's browsers that has only ever been the owner.
 */
export function readUserValue(storage: ReadableStorage | null | undefined, base: string, scope: string = currentStorageScope()): string | null {
    if (!storage) return null;
    try {
        const key = userStorageKey(base, scope);
        const value = storage.getItem(key);
        if (value !== null || scope === ANONYMOUS_SCOPE) return value;

        const legacy = storage.getItem(base);
        if (legacy === null) return null;
        moveValue(storage, base, key, legacy);
        // Even if it couldn't move, the user's data is what they get.
        return legacy;
    } catch {
        // Storage can throw in strict privacy modes; treat it as empty.
        return null;
    }
}

/**
 * Copies `value` from `from` to `to`, then removes `from`. Without room for
 * two copies (a nearly full quota) it removes first and puts the value back
 * if the write still fails, so the value is never lost.
 */
function moveValue(storage: ReadableStorage, from: string, to: string, value: string): void {
    try {
        storage.setItem(to, value);
        storage.removeItem(from);
        return;
    } catch {
        // Fall through: no room for both copies.
    }
    storage.removeItem(from);
    try {
        storage.setItem(to, value);
    } catch {
        storage.setItem(from, value);
    }
}

/**
 * Moves every value still under a shared key in `bases` to this signed-in
 * user, and removes shared values this user already has a copy of. Run on
 * each page load, so nothing saved before keys were per user is left for
 * whichever account opens that feature next.
 */
export function adoptSharedValues(
    storage: ReadableStorage | null | undefined,
    bases: readonly string[],
    scope: string = currentStorageScope(),
): void {
    if (!storage || scope === ANONYMOUS_SCOPE) return;
    for (const base of bases) {
        readUserValue(storage, base, scope);
        try {
            storage.removeItem(base);
        } catch {
            // Nothing to remove.
        }
    }
}

export function writeUserValue(storage: ReadableStorage | null | undefined, base: string, value: string, scope: string = currentStorageScope()): void {
    if (!storage) return;
    try {
        storage.setItem(userStorageKey(base, scope), value);
    } catch {
        // Quota or private mode: the next read falls back to defaults.
    }
}

export function removeUserValue(storage: ReadableStorage | null | undefined, base: string, scope: string = currentStorageScope()): void {
    if (!storage) return;
    try {
        storage.removeItem(userStorageKey(base, scope));
    } catch {
        // Nothing to remove.
    }
}

/**
 * A Zustand `persist` storage that keeps each user's copy apart (the store's
 * `name` is the base key).
 */
export function userScopedStateStorage(getStorage: () => ReadableStorage | null = browserLocalStorage) {
    return {
        getItem: (name: string) => readUserValue(getStorage(), name),
        setItem: (name: string, value: string) => writeUserValue(getStorage(), name, value),
        removeItem: (name: string) => removeUserValue(getStorage(), name),
    };
}

/** window.localStorage, or null on the server or when the browser refuses. */
export function browserLocalStorage(): Storage | null {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}
