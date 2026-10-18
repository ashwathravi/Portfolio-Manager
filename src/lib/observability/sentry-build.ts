/**
 * Build-time Sentry settings for withSentryConfig in next.config.ts: where
 * source maps go. They are uploaded only where the Marketplace integration's
 * SENTRY_AUTH_TOKEN is set (Vercel builds), then deleted from the build, so
 * they are never served. Local, CI and E2E builds skip Sentry entirely.
 */

import type { SentryBuildOptions } from "@sentry/nextjs/config";

/** A trimmed value, or undefined when missing or a Vercel placeholder like "[SENSITIVE]". */
function usableSetting(value: string | undefined): string | undefined {
    const setting = value?.trim();
    if (!setting || /^\[[A-Z_]+\]$/.test(setting)) return undefined;
    return setting;
}

export function sentryBuildOptions(env: Partial<Record<string, string>> = process.env): SentryBuildOptions {
    const authToken = usableSetting(env.SENTRY_AUTH_TOKEN);
    const org = usableSetting(env.SENTRY_ORG);
    const project = usableSetting(env.SENTRY_PROJECT);
    const uploads = Boolean(authToken && org && project);

    return {
        org,
        project,
        authToken,
        // The commit being deployed (CI passes SENTRY_RELEASE); the SDK
        // tags reports with the same value.
        release: { name: usableSetting(env.SENTRY_RELEASE), create: uploads },
        sourcemaps: { disable: !uploads },
        widenClientFileUpload: true,
        silent: !env.CI,
        telemetry: false,
    };
}
