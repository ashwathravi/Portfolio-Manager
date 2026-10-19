/**
 * What signing out removes from this browser (launch items i37, i39).
 *
 * - The Ask transcript: questions about your money shouldn't stay on a
 *   shared device.
 * - Settings, once the server has saved them (they come back from there at
 *   the next sign-in). A copy with edits the server hasn't saved, or the only
 *   copy there is (no database), stays.
 *
 * Theses, the journal, the watchlist, alerts and review notes stay under this
 * user's key, because this browser holds the only copy until they move to
 * Postgres (i38); each joins this list once it has a server copy.
 */

import { ASK_STORAGE_KEY } from "@/lib/ask/storage";
import { flushSettings, readBrowserCopy, removeBrowserCopy } from "@/lib/settings/sync";

import { browserLocalStorage, currentStorageScope, removeUserValue } from "./user-scope";

export const CLEARED_ON_SIGN_OUT = [ASK_STORAGE_KEY] as const;

export function clearBrowserDataOnSignOut(
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = browserLocalStorage(),
    scope: string = currentStorageScope(),
): void {
    for (const base of CLEARED_ON_SIGN_OUT) removeUserValue(storage, base, scope);

    const settings = readBrowserCopy(storage, scope);
    if (settings && !settings.pending && !settings.legacy) removeBrowserCopy(storage, scope);
}

/** Saves what's unsaved, then clears this browser; call before signOut(). */
export async function prepareForSignOut(): Promise<void> {
    try {
        await flushSettings();
    } finally {
        clearBrowserDataOnSignOut();
    }
}
