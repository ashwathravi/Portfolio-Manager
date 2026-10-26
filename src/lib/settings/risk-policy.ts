/**
 * The user's stored risk policy, for the server's evaluation (launch item
 * i52): read the way the store loads settings (older documents migrated,
 * anything the app couldn't have written repaired), the defaults without a
 * stored document.
 */

import type { RiskPolicySettings } from "@/lib/risk-policy/user-policy";
import { defaultPersistedSettings, migrateSettings, normalizeSettings } from "@/lib/stores/settingsStore";

import type { ServerSettingsSnapshot } from "./document";

export function storedRiskPolicy(server: ServerSettingsSnapshot): RiskPolicySettings {
    const defaults = defaultPersistedSettings().riskPolicy;
    if (server.status !== "ok" || !server.document) return defaults;
    // migrateSettings edits what it's given; never the caller's copy.
    const migrated = migrateSettings(structuredClone(server.document.settings), server.document.version);
    return normalizeSettings(migrated).riskPolicy ?? defaults;
}
