import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { sentryBuildOptions } from "./sentry-build";

const VERCEL_BUILD = {
    SENTRY_AUTH_TOKEN: "sntrys_token",
    SENTRY_ORG: "atlas-org",
    SENTRY_PROJECT: "atlas-wealth",
    SENTRY_RELEASE: "ea5efb0",
    CI: "1",
};

describe("sentryBuildOptions", () => {
    test("uploads source maps for the release where the integration's settings are real", () => {
        const options = sentryBuildOptions(VERCEL_BUILD);

        assert.equal(options.authToken, "sntrys_token");
        assert.equal(options.org, "atlas-org");
        assert.equal(options.project, "atlas-wealth");
        assert.deepEqual(options.release, { name: "ea5efb0", create: true });
        assert.deepEqual(options.sourcemaps, { disable: false });
        assert.equal(options.silent, false);
        assert.equal(options.telemetry, false);
    });

    test("skips uploads in local, CI and E2E builds", () => {
        const options = sentryBuildOptions({});

        assert.equal(options.authToken, undefined);
        assert.deepEqual(options.sourcemaps, { disable: true });
        assert.deepEqual(options.release, { name: undefined, create: false });
        assert.equal(options.silent, true);
    });

    test("treats Vercel's placeholders as missing", () => {
        const options = sentryBuildOptions({ ...VERCEL_BUILD, SENTRY_AUTH_TOKEN: "[SENSITIVE]" });

        assert.equal(options.authToken, undefined);
        assert.deepEqual(options.sourcemaps, { disable: true });
    });

    test("needs the org and project too", () => {
        assert.deepEqual(sentryBuildOptions({ ...VERCEL_BUILD, SENTRY_PROJECT: " " }).sourcemaps, { disable: true });
    });
});
