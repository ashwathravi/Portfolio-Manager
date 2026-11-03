/**
 * The Strategies page's data, loaded on the server (launch item i55): the
 * user's saved strategies. Without a configured database nothing is
 * queried and strategies stay in the tab; when the database fails,
 * `unavailable` says so.
 */

import { isDatabaseConfigured } from "@/db/connection-options";
import { loggableError } from "@/lib/observability/loggable-error";

import { loadUserStrategies } from "./store";
import type { Strategy } from "./strategy";

export interface StrategiesPageData {
    strategies: Strategy[];
    /** Saved to the user's account (a database is configured). */
    persisted: boolean;
    unavailable: boolean;
}

export async function loadStrategiesPage(
    userId: string,
    { databaseConfigured = isDatabaseConfigured() }: { databaseConfigured?: boolean } = {},
): Promise<StrategiesPageData> {
    if (!databaseConfigured) return { strategies: [], persisted: false, unavailable: false };
    try {
        return { strategies: await loadUserStrategies(userId), persisted: true, unavailable: false };
    } catch (error) {
        console.error("Strategies fetch failed — showing the outage notice.", loggableError(error));
        return { strategies: [], persisted: true, unavailable: true };
    }
}
