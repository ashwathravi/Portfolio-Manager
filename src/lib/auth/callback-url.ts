/**
 * Where to send someone after they sign in. Only same-site paths are allowed:
 * browsers treat "//host" and "/\host" as links to another site, so those
 * (and anything not starting with "/") fall back to Today.
 */
export function safeCallbackPath(value: string | null | undefined): string {
    if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
    return value;
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
