import type { MetadataRoute } from "next";

/**
 * Crawlers may fetch every page, which is how they read the noindex each one
 * carries (src/lib/security/search-engines.ts). A page robots.txt disallows is
 * never fetched, so its noindex is never seen, and a search engine can still
 * list its address from links elsewhere.
 */
export default function robots(): MetadataRoute.Robots {
    return { rules: { userAgent: "*", allow: "/" } };
}
