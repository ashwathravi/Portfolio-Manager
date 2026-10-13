import { cache } from "react";

import { auth } from "@/auth";

/**
 * The Auth.js session for the current server render, looked up once and
 * shared by the layout and the page. Route handlers call auth() directly.
 */
export const getRequestSession = cache(() => auth());
