/**
 * What signing out removes from this browser (launch items i37, i39).
 *
 * - The Ask transcript: questions about your money shouldn't stay on a
 *   shared device.
 * - Settings: profile, balances and risk and tax details. Sign-out first
 *   tries to save what the server hasn't got (briefly: a stalled request
 *   never blocks it), then removes the copy either way; the server's
 *   settings come back at the next sign-in.
 * - Anything still under a key that used to be shared by every account.
 *
 * Alerts and review notes stay under this user's key, because this browser
 * holds the only copy; each joins this list once it has a server copy. The
 * watchlist, journal and theses live in the account when the app has a
 * database (i38), and the browser's copy is removed once the account has it;
 * without a database, this browser's copy is the only one, so it stays.
 */

import { ASK_STORAGE_KEY } from "@/lib/ask/storage";
import { flushAccountWrites } from "@/lib/research/accountWrites";
import { flushSettings, haltSettingsSync, removeBrowserCopy } from "@/lib/settings/sync";

import { FORMERLY_SHARED_KEYS, adoptFormerlySharedData } from "./shared-keys";
import { browserLocalStorage, currentStorageScope, removeUserValue } from "./user-scope";

export const CLEARED_ON_SIGN_OUT = [ASK_STORAGE_KEY] as const;

export function clearBrowserDataOnSignOut(
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = browserLocalStorage(),
    scope: string = currentStorageScope(),
): void {
    // Anything still under a key that used to be shared couldn't move to
    // this user for lack of space. One more try; whatever still can't move
    // goes, so the next account to sign in here can't pick it up. First, so
    // what moves is cleared below like the rest of this user's data.
    adoptFormerlySharedData(storage, scope);
    for (const base of FORMERLY_SHARED_KEYS) {
        try {
            storage?.removeItem(base);
        } catch {
            // Nothing to remove.
        }
    }

    for (const base of CLEARED_ON_SIGN_OUT) removeUserValue(storage, base, scope);
    removeBrowserCopy(storage, scope);
}

/**
 * Saves what's unsaved, settings and research edits (watchlist, journal)
 * alike, for up to 3 seconds while the session still lets them through;
 * stops settings sync so a late answer can't write the copy back; then
 * clears this browser. Call before signOut().
 */
export async function prepareForSignOut(
    flushes: ReadonlyArray<(timeoutMs: number) => Promise<void>> = [flushSettings, flushAccountWrites],
): Promise<void> {
    try {
        await Promise.all(flushes.map((flush) => flush(3000)));
    } finally {
        haltSettingsSync();
        clearBrowserDataOnSignOut();
    }
}

/**
 * What deleting the account removes from this browser (launch item i65):
 * everything kept under this user's key, the copies only this browser held
 * (alerts, review notes) included, and what signing out removes.
 */
export function clearBrowserDataOnAccountDeletion(
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> | null = browserLocalStorage(),
    scope: string = currentStorageScope(),
): void {
    clearBrowserDataOnSignOut(storage, scope);
    if (!storage) return;
    const suffix = `:${scope}`;
    const keys: string[] = [];
    try {
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key?.endsWith(suffix)) keys.push(key);
        }
    } catch {
        // Storage unreadable: nothing more to find.
    }
    for (const key of keys) {
        try {
            storage.removeItem(key);
        } catch {
            // Already gone.
        }
    }
}

/**
 * After the account is deleted: nothing unsaved is sent (there's no account
 * to keep it), settings sync stops, and this browser's copies of the
 * user's data go. Call before signOut().
 */
export function prepareForAccountDeletionSignOut(): void {
    haltSettingsSync();
    clearBrowserDataOnAccountDeletion();
}
