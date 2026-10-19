/**
 * What signing out removes from this browser (launch item i39). The Ask
 * transcript goes: questions about your money shouldn't stay on a shared
 * device. Theses, the journal, the watchlist, alerts and review notes stay,
 * under this user's key, because this browser holds the only copy until they
 * move to Postgres (i37, i38); each joins this list once it has a server copy.
 */

import { ASK_STORAGE_KEY } from "@/lib/ask/storage";

import { browserLocalStorage, currentStorageScope, removeUserValue } from "./user-scope";

export const CLEARED_ON_SIGN_OUT = [ASK_STORAGE_KEY] as const;

export function clearBrowserDataOnSignOut(
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = browserLocalStorage(),
    scope: string = currentStorageScope(),
): void {
    for (const base of CLEARED_ON_SIGN_OUT) removeUserValue(storage, base, scope);
}
