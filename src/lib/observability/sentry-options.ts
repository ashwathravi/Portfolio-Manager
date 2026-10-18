/**
 * Sentry error monitoring (launch item i24): the options the server and the
 * browser SDKs share.
 *
 * Sentry is on only where a DSN is configured: the Vercel Marketplace
 * integration sets NEXT_PUBLIC_SENTRY_DSN for production and preview. Local
 * runs and E2E have none, so the SDK is never even started there.
 *
 * Reports carry the error, its stack trace, the route, the release and a
 * request ID. Version 11 of the SDK also collects cookies, headers, request
 * and response bodies, query strings, database query parameters and local
 * variables by default; {@link SENTRY_DATA_COLLECTION} turns all of that off,
 * and {@link scrubSentryEvent} strips whatever still gets through before an
 * event leaves the app.
 */

import type { BrowserOptions, NodeOptions } from "@sentry/nextjs";

import { redactSecrets } from "@/lib/security/redact-secrets";

type SentryEvent = Parameters<NonNullable<NodeOptions["beforeSend"]>>[0];
type DataCollection = NonNullable<NodeOptions["dataCollection"]>;

export interface SentryEnv {
    NEXT_PUBLIC_SENTRY_DSN?: string;
    NEXT_PUBLIC_VERCEL_ENV?: string;
    VERCEL_ENV?: string;
    NODE_ENV?: string;
}

/** Request headers worth keeping on a report: none identify the user. */
const REPORTED_REQUEST_HEADERS = ["accept", "content-type", "user-agent", "x-request-id", "x-vercel-id"];

export const SENTRY_DATA_COLLECTION = {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: { allow: REPORTED_REQUEST_HEADERS }, response: false },
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
} satisfies DataCollection;

const SENSITIVE_HEADER = /authorization|cookie|token|secret|api[-_]?key/i;
const MAX_SCRUB_DEPTH = 12;
// The query of an absolute or root-relative URL, up to whitespace, a quote or
// a fragment: "https://host/path?search=AAPL" keeps "https://host/path".
const URL_QUERY = /((?:https?:\/\/|\/)[^\s?#"'<>]*)\?[^\s#"'<>]*/g;
// Code locations: their URLs must stay as built for source maps to resolve.
const CODE_LOCATION_KEYS = new Set(["stacktrace", "debug_meta"]);

/**
 * The DSN, or undefined when it is missing or not a Sentry DSN (an https URL
 * with a public key and a numeric project ID), such as Vercel's
 * "[SENSITIVE]" placeholder.
 */
export function usableSentryDsn(value: string | undefined): string | undefined {
    const dsn = value?.trim();
    if (!dsn) return undefined;
    try {
        const url = new URL(dsn);
        if (url.protocol !== "https:" || !url.username || !/\/\d+$/.test(url.pathname)) return undefined;
        return dsn;
    } catch {
        return undefined;
    }
}

/** Where the browser sends reports, for the CSP's connect-src. */
export function sentryIngestOrigin(value: string | undefined): string | undefined {
    const dsn = usableSentryDsn(value);
    return dsn ? new URL(dsn).origin : undefined;
}

function sharedOptions(env: SentryEnv) {
    const dsn = usableSentryDsn(env.NEXT_PUBLIC_SENTRY_DSN);
    return {
        dsn,
        enabled: dsn !== undefined,
        environment: env.VERCEL_ENV?.trim() || env.NEXT_PUBLIC_VERCEL_ENV?.trim() || env.NODE_ENV?.trim() || "development",
        dataCollection: SENTRY_DATA_COLLECTION,
        // Errors only. No tracesSampleRate, so no performance tracing, and no
        // trace headers on requests to Plaid, market data or SEC EDGAR.
        tracePropagationTargets: [],
    };
}

/** Options for Sentry.init on the server; secrets come from `env`. */
export function serverSentryOptions(env: SentryEnv & Partial<Record<string, string>> = process.env): NodeOptions {
    return {
        ...sharedOptions(env),
        beforeSend: (event) => scrubSentryEvent(event, env),
    };
}

/**
 * Options for Sentry.init in the browser. Only NEXT_PUBLIC_ variables exist
 * there, so the caller passes each one by name for Next.js to inline.
 */
export function browserSentryOptions(env: SentryEnv): BrowserOptions {
    return {
        ...sharedOptions(env),
        // Errors only: BrowserSession would report every page load.
        integrations: (defaults) => defaults.filter((integration) => integration.name !== "BrowserSession"),
        beforeSend: (event) => scrubSentryEvent(event, {}),
    };
}

/**
 * The last check before an event leaves the app: drops cookies, bodies,
 * query strings, sensitive headers and user details other than the ID, and
 * masks secret values anywhere in the event (see {@link redactSecrets}).
 * URL queries are cut from every message too: a provider's error quotes its
 * request URL, and that can hold what the user typed into ticker search.
 */
export function scrubSentryEvent<T extends SentryEvent>(event: T, env: Partial<Record<string, string>>): T {
    const scrubbed = redactStrings(event, env, 0, true) as T;

    if (scrubbed.request) {
        delete scrubbed.request.cookies;
        delete scrubbed.request.data;
        delete scrubbed.request.query_string;
        if (scrubbed.request.url) scrubbed.request.url = scrubbed.request.url.split("?")[0];
        if (scrubbed.request.headers) {
            scrubbed.request.headers = Object.fromEntries(
                Object.entries(scrubbed.request.headers).filter(([name]) => !SENSITIVE_HEADER.test(name)),
            );
        }
    }
    if (scrubbed.user) {
        if (scrubbed.user.id === undefined) delete scrubbed.user;
        else scrubbed.user = { id: scrubbed.user.id };
    }
    return scrubbed;
}

/** Removes the query from every absolute or root-relative URL in `text`. */
export function stripUrlQueries(text: string): string {
    return text.replace(URL_QUERY, "$1");
}

function redactStrings(
    value: unknown,
    env: Partial<Record<string, string>>,
    depth: number,
    stripQueries: boolean,
): unknown {
    if (typeof value === "string") {
        const redacted = redactSecrets(value, env);
        return stripQueries ? stripUrlQueries(redacted) : redacted;
    }
    if (depth >= MAX_SCRUB_DEPTH || value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => redactStrings(item, env, depth + 1, stripQueries));
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
            key,
            redactStrings(item, env, depth + 1, stripQueries && !CODE_LOCATION_KEYS.has(key)),
        ]),
    );
}
