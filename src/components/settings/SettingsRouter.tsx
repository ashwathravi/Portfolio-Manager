"use client";

import { SettingsPageClient } from "./SettingsPageClient";

/**
 * Settings entry point. The legacy tabbed layout is gone: `?tab=<slug>`
 * deep links now scroll to the matching section of the single page.
 */
export function SettingsRouter() {
    return <SettingsPageClient />;
}
