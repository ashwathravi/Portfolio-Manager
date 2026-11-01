/**
 * What every page asks of search engines during the private beta (launch
 * item i74): leave it out of their results and don't follow its links. Sent
 * as the X-Robots-Tag header on every response (next.config.ts) and as the
 * robots meta tag on every page (src/app/layout.tsx). Revisit when sign-up
 * opens (i77).
 */
export const ROBOTS_DIRECTIVES = "noindex, nofollow";
