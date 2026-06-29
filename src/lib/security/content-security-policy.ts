export interface ContentSecurityPolicyOptions {
    nodeEnv?: string;
}

export function buildContentSecurityPolicy(options: ContentSecurityPolicyOptions = {}): string {
    const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
    const isProduction = nodeEnv === "production";

    const scriptSrc = [
        "'self'",
        "https://cdn.plaid.com",
        // Next.js still emits inline bootstrap scripts; moving to nonce-based CSP is a separate app-shell change.
        "'unsafe-inline'",
        ...(isProduction ? [] : ["'unsafe-eval'"]),
    ];
    const styleSrc = [
        "'self'",
        // Required for Next/Tailwind style injection and component-level inline CSS variables.
        "'unsafe-inline'",
    ];
    const connectSrc = [
        "'self'",
        "https://cdn.plaid.com",
        "https://sandbox.plaid.com",
        "https://development.plaid.com",
        "https://production.plaid.com",
        ...(isProduction ? [] : ["ws:", "http://localhost:*", "http://127.0.0.1:*"]),
    ];

    return [
        directive("default-src", ["'self'"]),
        directive("script-src", scriptSrc),
        directive("style-src", styleSrc),
        directive("img-src", ["'self'", "blob:", "data:", "https:"]),
        directive("font-src", ["'self'", "https:", "data:"]),
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

function directive(name: string, sources: string[]): string {
    return `${name} ${sources.join(" ")}`;
}
