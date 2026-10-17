// A placeholder origin: callbacks are resolved against it the way a browser
// would, and only results that stay on it are kept.
const SAME_SITE = "https://same-site.invalid";

/**
 * Where to send someone after they sign in. The value is resolved as a URL,
 * the way a browser will, and kept only if it stays on this site; that
 * catches "//host", "/\host" and "/<tab>/host" (browsers drop tabs and
 * newlines). Anything else falls back to Today. Returns the normalized path.
 */
export function safeCallbackPath(value: string | null | undefined): string {
    if (!value || !value.startsWith("/")) return "/";
    let url: URL;
    try {
        url = new URL(value, SAME_SITE);
    } catch {
        return "/";
    }
    if (url.origin !== SAME_SITE) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * `path` carrying the sign-in callback, so a detour (such as reading the
 * privacy policy) still lands on the page that was asked for. The default
 * callback ("/") is left off.
 */
export function withCallback(path: string, callbackUrl: string | null | undefined): string {
    const safe = safeCallbackPath(callbackUrl);
    return safe === "/" ? path : `${path}?callbackUrl=${encodeURIComponent(safe)}`;
}
