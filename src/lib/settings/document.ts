/**
 * The settings document (launch item i37, decision D6): the persisted slices
 * of the settings store, as one versioned JSON object. It lives in the user's
 * user_settings row and in this browser's copy. Kept free of the store itself
 * so the server can validate a document without loading client code.
 */

/**
 * The settings store's schema version. Bump it, with a step in
 * `migrateSettings` (src/lib/stores/settingsStore.ts), when the shape of any
 * persisted slice changes.
 *   v1 — pre-Ledger: `appearance = { theme, compactMode, animationsEnabled }`
 *   v2 — AR-64 + AR-65: adds `density` and `accent` as required fields.
 *   v3 — AR-89: adds the `guardrails` slice (approval threshold,
 *        concentration cap, thesis linkage). Existing users
 *        migrate to the defaults — the numbers match what the
 *        Execution surface hardcoded before the slice existed,
 *        so behavior is unchanged.
 *   v4 — AR-109: adds the `execution` slice (`rationaleRequired`).
 *        Existing users migrate to `{ rationaleRequired: true }`
 *        so pre-trade rationale capture turns on transparently
 *        — matches the out-of-the-box JournalPlus UX.
 *   v5 — AR-110: adds `execution.cooldownSeconds`. Existing v4
 *        users had `execution = { rationaleRequired }` only;
 *        the migration fills in `cooldownSeconds: 10` so the
 *        caution-mood nudge turns on without disrupting the
 *        rationale preference they already set.
 *   v6 — AR-123: adds `notifications.alphaRadarSignals`.
 *   v7 — AR-131: adds `alphaRadarDelivery` scheduler and
 *        delivery preferences. Defaults keep the approved in-app
 *        channel on and leave external channels disabled until
 *        provider destinations are configured.
 *   v8 — AR-139/AR-141: adds persisted risk policy bucket targets,
 *        bucket caps, and theme caps for the Risk Policy Engine.
 *   v9 — AR-144: adds cash job classifications and scheduled
 *        cash deployment policy rules.
 *   v10 — AR-143: adds persisted options/LEAPS risk policy caps.
 *   v11 — AR-146: adds sell-discipline trigger rules and audit
 *        state for trim/re-underwrite/no-add policy tasks.
 *   v12 — adds configurable repeated-trading/churn policy
 *        thresholds for the Risk Policy Engine.
 *   v13 — AR-140 adds persisted GOOG/employer-stock de-risking
 *        plan assumptions and schedule state.
 *   v14 — AR-149 persists non-secret Plaid connected-account
 *        metadata. Access tokens stay server-side and are not
 *        part of this persisted client settings slice.
 *   v15 — Design review IA consolidation: remaps landing pages
 *        for retired routes (/analytics, /portfolios) and removes
 *        the seeded example brokerage accounts; adds the `demo`
 *        slice (show/hide example data, default shown).
 *   v16 — launch item i54: adds `riskPolicy.bucketAssignments`, the
 *        bucket the user chose for each ticker. Existing users
 *        migrate to none chosen, so every holding keeps the bucket
 *        its type suggests.
 */
export const SETTINGS_VERSION = 16;

/**
 * The version settings were first saved to the server at. A browser migrates
 * its settings to its own SETTINGS_VERSION before saving them, so no save is
 * older than this.
 */
export const FIRST_SAVED_SETTINGS_VERSION = 15;

/** Persisted slices; API keys and the security slice stay in memory only. */
export const PERSISTED_SETTINGS_SLICES = [
    "profile",
    "appearance",
    "notifications",
    "alphaRadarDelivery",
    "preferences",
    "accounts",
    "tags",
    "guardrails",
    "execution",
    "riskPolicy",
    "demo",
] as const;

export type PersistedSettingsSlice = (typeof PERSISTED_SETTINGS_SLICES)[number];

export interface SettingsDocument {
    version: number;
    settings: Partial<Record<PersistedSettingsSlice, unknown>>;
}

/** A document as stored, with the version stamp saves are checked against. */
export interface StoredSettingsDocument extends SettingsDocument {
    updatedAt: string;
}

/** What the root layout hands the browser about the stored document. */
export type ServerSettingsSnapshot =
    | { status: "ok"; document: StoredSettingsDocument | null }
    // No usable database, or reading it failed: the browser copy is all there is.
    | { status: "unavailable" };
