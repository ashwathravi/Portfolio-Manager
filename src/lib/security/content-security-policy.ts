/**
 * The Content-Security-Policy header (launch item i26). The proxy builds it
 * for every request with a fresh nonce: Next.js reads the nonce from the
 * request's copy of the header and puts it on every script it renders, and
 * 'strict-dynamic' extends that trust to the scripts those load (page chunks,
 * Plaid Link). No other script runs, inline or not, so an injected <script>
 * tag does nothing.
 *
 * Styles keep 'unsafe-inline': React renders `style` attributes, which a
 * nonce can't cover, and a nonce in style-src would disable 'unsafe-inline'.
 */

import { sentryIngestOrigin } from "@/lib/observability/sentry-options";

export interface ContentSecurityPolicyOptions {
    /** This request's nonce (see {@link createNonce}). */
    nonce: string;
    nodeEnv?: string;
    /** Allows the browser to send error reports to this DSN's ingest host. */
    sentryDsn?: string;
    /** PLAID_ENV: only that environment's API host is allowed. */
    plaidEnv?: string;
}

/** 128 random bits, base64: unguessable and new for every request. */
export function createNonce(): string {
    return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}

export function buildContentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
    const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
    const isProduction = nodeEnv === "production";
    const sentryOrigin = sentryIngestOrigin(
        "sentryDsn" in options ? options.sentryDsn : process.env.NEXT_PUBLIC_SENTRY_DSN,
    );
    const plaidEnv = "plaidEnv" in options ? options.plaidEnv : process.env.PLAID_ENV;

    const scriptSrc = [
        "'self'",
        `'nonce-${options.nonce}'`,
        "'strict-dynamic'",
        // Ignored where 'strict-dynamic' works; browsers without it (Safari
        // before 15.4) still need it to load Plaid Link.
        "https://cdn.plaid.com",
        // React rebuilds server error stacks with eval in development only.
        ...(isProduction ? [] : ["'unsafe-eval'"]),
    ];
    const styleSrc = [
        "'self'",
        // Next/Tailwind style injection and React `style` attributes.
        "'unsafe-inline'",
    ];
    const connectSrc = [
        "'self'",
        "https://cdn.plaid.com",
        plaidApiOrigin(plaidEnv),
        ...(sentryOrigin ? [sentryOrigin] : []),
        ...(isProduction ? [] : ["ws:", "http://localhost:*", "http://127.0.0.1:*"]),
    ];

    return [
        directive("default-src", ["'self'"]),
        directive("script-src", scriptSrc),
        directive("style-src", styleSrc),
        // No remote images: institution logos arrive as data: URLs.
        directive("img-src", ["'self'", "blob:", "data:"]),
        // Fonts are self-hosted (src/styles/fonts).
        directive("font-src", ["'self'", "data:"]),
        directive("connect-src", connectSrc),
        directive("frame-src", ["https://cdn.plaid.com"]),
        directive("worker-src", ["'self'", "blob:"]),
        directive("manifest-src", ["'self'"]),
        directive("object-src", ["'none'"]),
        directive("base-uri", ["'self'"]),
        directive("form-action", ["'self'"]),
        directive("frame-ancestors", ["'none'"]),
        "block-all-mixed-content",
        "upgrade-insecure-requests",
    ].join("; ");
}

/**
 * The Plaid API host for PLAID_ENV, chosen the way resolvePlaidEnvironment
 * (src/lib/plaid/link.ts) chooses the environment: sandbox unless it says
 * production or development.
 */
function plaidApiOrigin(plaidEnv: string | undefined): string {
    const environment = plaidEnv === "production" || plaidEnv === "development" ? plaidEnv : "sandbox";
    return `https://${environment}.plaid.com`;
}

function directive(name: string, sources: string[]): string {
    return `${name} ${sources.join(" ")}`;
}
