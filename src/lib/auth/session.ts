import { cache } from "react";
import type { Session } from "next-auth";

import { auth } from "@/auth";

type SessionLoader = () => Promise<Session | null>;

/**
 * Wraps a session loader so every caller in one server render shares one
 * lookup. React's cache only memoizes inside a server render; elsewhere
 * (route handlers, tests) it calls straight through.
 */
export function createRequestSessionLoader(
    load: SessionLoader,
    cacheFn: (fn: SessionLoader) => SessionLoader = cache,
): SessionLoader {
    return cacheFn(() => load());
}

/**
 * The Auth.js session for the current server render, looked up once and
 * shared by the layout and the page. Route handlers call auth() directly.
 */
export const getRequestSession = createRequestSessionLoader(() => auth());
