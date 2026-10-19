/**
 * What signing out removes from this browser (launch items i37, i39).
 *
 * - The Ask transcript: questions about your money shouldn't stay on a
 *   shared device.
 * - Settings: profile, balances and risk and tax details. Sign-out first
 *   tries to save what the server hasn't got (briefly: a stalled request
 *   never blocks it), then removes the copy either way; the server's
 *   settings come back at the next sign-in.
 *
 * Theses, the journal, the watchlist, alerts and review notes stay under this
 * user's key, because this browser holds the only copy until they move to
 * Postgres (i38); each joins this list once it has a server copy.
 */

import { ASK_STORAGE_KEY } from "@/lib/ask/storage";
import { flushSettings, haltSettingsSync, removeBrowserCopy } from "@/lib/settings/sync";

import { browserLocalStorage, currentStorageScope, removeUserValue } from "./user-scope";

export const CLEARED_ON_SIGN_OUT = [ASK_STORAGE_KEY] as const;

export function clearBrowserDataOnSignOut(
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = browserLocalStorage(),
    scope: string = currentStorageScope(),
): void {
    for (const base of CLEARED_ON_SIGN_OUT) {
        removeUserValue(storage, base, scope);
        // And a copy saved before keys were per user, if one is still here.
        try {
            storage?.removeItem(base);
        } catch {
            // Nothing to remove.
        }
    }

    removeBrowserCopy(storage, scope);
}

/**
 * Saves what's unsaved (for up to 3 seconds), stops settings sync so a late
 * answer can't write the copy back, then clears this browser; call before
 * signOut().
 */
export async function prepareForSignOut(): Promise<void> {
    try {
        await flushSettings(3000);
    } finally {
        haltSettingsSync();
        clearBrowserDataOnSignOut();
    }
}
