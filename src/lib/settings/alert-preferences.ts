/**
 * Which alerts the user wants, for the nightly alerts job (launch item
 * i57): Settings › Notifications' Price Alerts, Portfolio Updates and Alpha
 * Radar Signals, and the Alpha Radar delivery preferences. Read the way the
 * store loads settings; the defaults without a stored document.
 */

import type { AlertPreferences } from "@/lib/alerts/nightly-plan";
import { defaultPersistedSettings, migrateSettings, normalizeSettings } from "@/lib/stores/settingsStore";

import type { SettingsDocument } from "./document";

export function storedAlertPreferences(document: SettingsDocument | null): AlertPreferences {
    let { notifications, alphaRadarDelivery } = defaultPersistedSettings();
    if (document) {
        // migrateSettings edits what it's given; never the caller's copy.
        const stored = normalizeSettings(migrateSettings(structuredClone(document.settings), document.version));
        notifications = stored.notifications ?? notifications;
        alphaRadarDelivery = stored.alphaRadarDelivery ?? alphaRadarDelivery;
    }
    return {
        priceAlerts: notifications.priceAlerts,
        portfolioUpdates: notifications.portfolioUpdates,
        alphaRadarSignals: notifications.alphaRadarSignals,
        alphaRadar: {
            inApp: alphaRadarDelivery.enabled && alphaRadarDelivery.channels.inApp,
            overlapOnly: alphaRadarDelivery.overlapOnly,
            minMaterialityScore: alphaRadarDelivery.minMaterialityScore,
            tickerFilters: alphaRadarDelivery.tickerFilters.map((ticker) => ticker.toUpperCase()),
            trackedFilerIds: alphaRadarDelivery.trackedFilerIds,
        },
    };
}
