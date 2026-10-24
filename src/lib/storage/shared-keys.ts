/**
 * Browser storage keys that were shared by every account before they became
 * per user (launch item i39). The watchlist was per user from the start.
 */

import { ASK_STORAGE_KEY } from "@/lib/ask/storage";
import { SNOOZE_STORAGE_KEY } from "@/lib/patterns/snooze";
import { JOURNAL_STORAGE_KEY } from "@/lib/research/journalStorage";
import { THESIS_STORAGE_KEY } from "@/lib/research/storage";
import { REVIEWS_STORAGE_KEY } from "@/lib/reviews/storage";
import { ALERTS_STORAGE_KEY } from "@/lib/stores/alertsStore";

import { adoptSharedValues, browserLocalStorage, currentStorageScope } from "./user-scope";

export const FORMERLY_SHARED_KEYS = [
    THESIS_STORAGE_KEY,
    JOURNAL_STORAGE_KEY,
    ALERTS_STORAGE_KEY,
    REVIEWS_STORAGE_KEY,
    SNOOZE_STORAGE_KEY,
    ASK_STORAGE_KEY,
] as const;

/** Gives this signed-in user whatever this browser saved before keys were per user. */
export function adoptFormerlySharedData(
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = browserLocalStorage(),
    scope: string = currentStorageScope(),
): void {
    adoptSharedValues(storage, FORMERLY_SHARED_KEYS, scope);
}
