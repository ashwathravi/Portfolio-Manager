/**
 * The ID that ties a request's log lines and its Sentry report together.
 *
 * Vercel gives every request an `x-vercel-id`, which also appears in its
 * runtime logs. Elsewhere (the Docker image behind a proxy) an upstream
 * `x-request-id` is used. Values that aren't a short token are ignored, so a
 * crafted header can't break a JSON log line.
 */

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

const REQUEST_ID_HEADERS = ["x-vercel-id", "x-request-id"] as const;
const SAFE_REQUEST_ID = /^[A-Za-z0-9:._-]{1,128}$/;

export function requestIdFrom(headers: HeaderSource): string | undefined {
    for (const name of REQUEST_ID_HEADERS) {
        const value = headerValue(headers, name)?.trim();
        if (value && SAFE_REQUEST_ID.test(value)) return value;
    }
    return undefined;
}

function headerValue(headers: HeaderSource, name: string): string | undefined {
    if (headers instanceof Headers) return headers.get(name) ?? undefined;
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
}
