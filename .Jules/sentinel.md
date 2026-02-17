## 2025-02-27 - Missing Default Security Headers
**Vulnerability:** The application was missing standard HTTP security headers (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) which left it vulnerable to clickjacking, MIME sniffing, and downgrade attacks.
**Learning:** Next.js does not include these headers by default; they must be explicitly configured in `next.config.ts` or via middleware.
**Prevention:** Always include a standard set of security headers in `next.config.ts` for all Next.js projects.

## 2025-02-27 - Recharts Type Definitions Blocking Build
**Vulnerability:** While not a direct vulnerability, strict TypeScript checks on `recharts` library types (`TooltipProps`) caused the build to fail, potentially blocking security updates.
**Learning:** External library type definitions can be inconsistent. `recharts` specifically has known issues with `TooltipProps`.
**Prevention:** Use `any` or specific suppressions for `recharts` components when types are broken to ensure the build pipeline remains unblocked.
