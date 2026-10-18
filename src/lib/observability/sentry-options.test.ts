import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    SENTRY_DATA_COLLECTION,
    browserSentryOptions,
    scrubSentryEvent,
    sentryIngestOrigin,
    serverSentryOptions,
    stripUrlQueries,
    usableSentryDsn,
} from "./sentry-options";

const DSN = "https://abc123publickey@o4501234.ingest.us.sentry.io/4509876";

type ScrubbableEvent = Parameters<typeof scrubSentryEvent>[0];

describe("usableSentryDsn", () => {
    test("accepts a Sentry DSN", () => {
        assert.equal(usableSentryDsn(`  ${DSN}  `), DSN);
    });

    test("rejects a missing value and Vercel's placeholder", () => {
        assert.equal(usableSentryDsn(undefined), undefined);
        assert.equal(usableSentryDsn("   "), undefined);
        assert.equal(usableSentryDsn("[SENSITIVE]"), undefined);
    });

    test("rejects URLs that aren't DSNs", () => {
        assert.equal(usableSentryDsn("http://abc@o1.ingest.sentry.io/123"), undefined, "not https");
        assert.equal(usableSentryDsn("https://o1.ingest.sentry.io/123"), undefined, "no public key");
        assert.equal(usableSentryDsn("https://abc@o1.ingest.sentry.io/"), undefined, "no project id");
    });
});

describe("sentryIngestOrigin", () => {
    test("is the DSN's host without the key", () => {
        assert.equal(sentryIngestOrigin(DSN), "https://o4501234.ingest.us.sentry.io");
    });

    test("is undefined without a usable DSN", () => {
        assert.equal(sentryIngestOrigin("[SENSITIVE]"), undefined);
        assert.equal(sentryIngestOrigin(undefined), undefined);
    });
});

describe("serverSentryOptions and browserSentryOptions", () => {
    test("are off without a DSN", () => {
        assert.equal(serverSentryOptions({}).enabled, false);
        assert.equal(browserSentryOptions({ NEXT_PUBLIC_SENTRY_DSN: "[SENSITIVE]" }).enabled, false);
    });

    test("are on with a DSN, in the Vercel environment", () => {
        const server = serverSentryOptions({ NEXT_PUBLIC_SENTRY_DSN: DSN, VERCEL_ENV: "production" });
        const browser = browserSentryOptions({ NEXT_PUBLIC_SENTRY_DSN: DSN, NEXT_PUBLIC_VERCEL_ENV: "preview" });

        assert.equal(server.enabled, true);
        assert.equal(server.dsn, DSN);
        assert.equal(server.environment, "production");
        assert.equal(browser.environment, "preview");
    });

    test("fall back to NODE_ENV, then development, for the environment", () => {
        assert.equal(browserSentryOptions({ NEXT_PUBLIC_SENTRY_DSN: DSN, NODE_ENV: "production" }).environment, "production");
        assert.equal(serverSentryOptions({ NEXT_PUBLIC_SENTRY_DSN: DSN }).environment, "development");
    });

    test("report errors only: no tracing and no trace headers to other services", () => {
        for (const options of [serverSentryOptions({ NEXT_PUBLIC_SENTRY_DSN: DSN }), browserSentryOptions({ NEXT_PUBLIC_SENTRY_DSN: DSN })]) {
            assert.equal(options.tracesSampleRate, undefined);
            assert.equal(options.tracesSampler, undefined);
            assert.deepEqual(options.tracePropagationTargets, []);
            assert.equal(options.dataCollection, SENTRY_DATA_COLLECTION);
            assert.equal(typeof options.beforeSend, "function");
        }
    });
});

describe("stripUrlQueries", () => {
    test("cuts the query from absolute and root-relative URLs, keeping the fragment and the rest", () => {
        assert.equal(stripUrlQueries("GET https://host.test/a?x=1&y=2 failed"), "GET https://host.test/a failed");
        assert.equal(stripUrlQueries("/api/search?q=AAPL#top and /b?c=d"), "/api/search#top and /b");
        assert.equal(stripUrlQueries('fetch("https://host.test/a?x=1")'), 'fetch("https://host.test/a")');
    });

    test("leaves text without URL queries alone", () => {
        assert.equal(stripUrlQueries("https://host.test/a"), "https://host.test/a");
        assert.equal(stripUrlQueries("Is the provider down? Retry later."), "Is the provider down? Retry later.");
    });
});

describe("browser integrations", () => {
    test("leave out BrowserSession, which would report every page load", () => {
        const options = browserSentryOptions({ NEXT_PUBLIC_SENTRY_DSN: DSN });
        assert.equal(typeof options.integrations, "function");
        const integrations = options.integrations as (defaults: Array<{ name: string }>) => Array<{ name: string }>;

        assert.deepEqual(
            integrations([{ name: "Breadcrumbs" }, { name: "BrowserSession" }, { name: "GlobalHandlers" }]).map((i) => i.name),
            ["Breadcrumbs", "GlobalHandlers"],
        );
    });
});

describe("SENTRY_DATA_COLLECTION", () => {
    test("turns off every kind of user data the SDK collects by default", () => {
        assert.equal(SENTRY_DATA_COLLECTION.userInfo, false);
        assert.equal(SENTRY_DATA_COLLECTION.cookies, false);
        assert.deepEqual(SENTRY_DATA_COLLECTION.httpBodies, []);
        assert.equal(SENTRY_DATA_COLLECTION.urlQueryParams, false);
        assert.equal(SENTRY_DATA_COLLECTION.databaseQueryData, false);
        assert.equal(SENTRY_DATA_COLLECTION.queues, false);
        assert.equal(SENTRY_DATA_COLLECTION.stackFrameVariables, false);
        assert.deepEqual(SENTRY_DATA_COLLECTION.genAI, { inputs: false, outputs: false });
        assert.deepEqual(SENTRY_DATA_COLLECTION.graphQL, { document: false, variables: false });
        assert.equal(SENTRY_DATA_COLLECTION.httpHeaders.response, false);
    });

    test("keeps only request headers that don't identify anyone", () => {
        const allowed = SENTRY_DATA_COLLECTION.httpHeaders.request.allow;
        assert.ok(allowed.includes("x-vercel-id"));
        for (const header of ["cookie", "authorization", "x-api-key", "x-forwarded-for", "x-real-ip", "referer"]) {
            assert.ok(!allowed.includes(header), `${header} is collected`);
        }
    });
});

describe("scrubSentryEvent", () => {
    test("drops cookies, bodies, query strings and sensitive headers", () => {
        const event = scrubSentryEvent({
            type: undefined,
            request: {
                url: "https://atlas.test/api/market-data/search?q=AAPL",
                query_string: "q=AAPL",
                cookies: { "authjs.session-token": "session" },
                data: { rows: [] },
                headers: { "user-agent": "Firefox", cookie: "a=b", authorization: "Bearer x", "x-api-key": "k" },
            },
        } as ScrubbableEvent, {});

        assert.deepEqual(event.request, {
            url: "https://atlas.test/api/market-data/search",
            headers: { "user-agent": "Firefox" },
        });
    });

    test("keeps only the user ID", () => {
        const withId = scrubSentryEvent({
            type: undefined,
            user: { id: "11111111-1111-4111-8111-111111111111", email: "a@example.com", ip_address: "198.51.100.1" },
        } as ScrubbableEvent, {});
        const withoutId = scrubSentryEvent({ type: undefined, user: { ip_address: "198.51.100.1" } } as ScrubbableEvent, {});

        assert.deepEqual(withId.user, { id: "11111111-1111-4111-8111-111111111111" });
        assert.equal(withoutId.user, undefined);
    });

    test("masks secrets in messages, exceptions and breadcrumbs", () => {
        const env = {
            DATABASE_URL: "postgres://atlas_app:supersecretpassword@db.example.com/postgres",
            AUTH_SECRET: "auth-secret-value-xyz",
        };
        const event = scrubSentryEvent({
            type: undefined,
            message: `could not connect to ${env.DATABASE_URL}`,
            exception: { values: [{ type: "Error", value: "GET https://api.example.com/v2?apiKey=live123" }] },
            breadcrumbs: [{ message: "signed with auth-secret-value-xyz", data: { url: "https://u:p@host.test/x" } }],
        } as ScrubbableEvent, env);

        const serialized = JSON.stringify(event);
        assert.ok(!serialized.includes("supersecretpassword"));
        assert.ok(!serialized.includes("auth-secret-value-xyz"));
        assert.ok(!serialized.includes("live123"));
        assert.ok(!serialized.includes("u:p@"));
        assert.equal(event.exception?.values?.[0].value, "GET https://api.example.com/v2");
    });

    test("cuts what the user typed out of a provider error's URL", () => {
        const event = scrubSentryEvent({
            type: undefined,
            exception: { values: [{
                type: "PolygonApiError",
                value: "PolygonMassiveAdapter: HTTP 502 Bad Gateway — https://api.polygon.io/v3/reference/tickers?search=my+private+query&apiKey=live123",
            }] },
            breadcrumbs: [{ category: "fetch", data: { url: "/api/market-data/search?q=my+private+query" } }],
        } as ScrubbableEvent, {});

        const serialized = JSON.stringify(event);
        assert.ok(!serialized.includes("my+private+query"));
        assert.equal(
            event.exception?.values?.[0].value,
            "PolygonMassiveAdapter: HTTP 502 Bad Gateway — https://api.polygon.io/v3/reference/tickers",
        );
        assert.equal(event.breadcrumbs?.[0].data?.url, "/api/market-data/search");
    });

    test("leaves code locations as built, so source maps still resolve", () => {
        const chunk = "app:///_next/static/chunks/main.js?dpl=dpl_123";
        const event = scrubSentryEvent({
            type: undefined,
            exception: { values: [{ type: "Error", value: "boom", stacktrace: { frames: [{ abs_path: chunk }] } }] },
            debug_meta: { images: [{ type: "sourcemap", code_file: chunk, debug_id: "abc" }] },
        } as ScrubbableEvent, {});

        assert.equal(event.exception?.values?.[0].stacktrace?.frames?.[0].abs_path, chunk);
        assert.deepEqual(event.debug_meta?.images?.[0], { type: "sourcemap", code_file: chunk, debug_id: "abc" });
    });

    test("serverSentryOptions scrubs with the server's secrets", async () => {
        const options = serverSentryOptions({ NEXT_PUBLIC_SENTRY_DSN: DSN, CRON_SECRET: "cron-secret-value-123" });
        const event = await options.beforeSend?.({ type: undefined, message: "bad cron-secret-value-123" }, {});

        assert.equal(event?.message, "bad ***");
    });
});
