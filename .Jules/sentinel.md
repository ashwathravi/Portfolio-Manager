## 2025-02-27 - Missing Default Security Headers

**Vulnerability:** The application was missing standard HTTP security headers (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy) which left it vulnerable to clickjacking, MIME sniffing, and downgrade attacks.
**Learning:** Next.js does not include these headers by default; they must be explicitly configured in `next.config.ts` or via middleware.
**Prevention:** Always include a standard set of security headers in `next.config.ts` for all Next.js projects.

## 2025-02-27 - Recharts Type Definitions Blocking Build

**Vulnerability:** While not a direct vulnerability, strict TypeScript checks on `recharts` library types (`TooltipProps`) caused the build to fail, potentially blocking security updates.
**Learning:** External library type definitions can be inconsistent. `recharts` specifically has known issues with `TooltipProps`.
**Prevention:** Use `any` or specific suppressions for `recharts` components when types are broken to ensure the build pipeline remains unblocked.

## 2025-02-27 - Content Security Policy & X-Permitted-Cross-Domain-Policies Missing

**Vulnerability:** The application was missing a Content Security Policy (CSP) and X-Permitted-Cross-Domain-Policies, leaving it vulnerable to XSS and cross-domain data loading.
**Learning:** CSP in Next.js needs careful configuration to balance security and functionality (e.g., allowing 'unsafe-inline' for scripts/styles in development or without nonces).
**Prevention:** Include a baseline CSP in `next.config.ts` that restricts object-src to 'none' and base-uri to 'self', even if script-src needs to remain somewhat open for compatibility.

## 2026-02-17 - Content Security Policy (CSP) Configuration

**Vulnerability:** Missing `Content-Security-Policy` header allows potential XSS attacks if an injection vulnerability is introduced.
**Learning:** Next.js requires `'unsafe-inline'` for scripts and styles to function correctly, especially in development. A strict CSP must balance security with framework requirements. Also, `browsing-topics` in `Permissions-Policy` is the modern standard replacing `interest-cohort`.
**Prevention:** Implement a CSP that allows `self`, `unsafe-inline`, `unsafe-eval` (dev), and necessary external sources (images, fonts) while blocking `object-src` and `frame-ancestors`.

## 2026-02-27 - Input Sanitization for User Text

**Vulnerability:** User inputs like names and tags were validated for length but not for content, potentially allowing HTML/XSS injection if rendered improperly.
**Learning:** Zod validation schemas should include explicit checks for dangerous characters (like `<` and `>`) in free-text fields, even if the frontend framework escapes output by default.
**Prevention:** Use a reusable `safeText` validator that rejects HTML tags in all user-facing text inputs.

## 2026-02-27 - Preventing PII Leakage in Zustand Persistence

**Vulnerability:** Sensitive user data (profile, security settings, financial accounts) was being persisted to `localStorage` in plain text by the default `persist` middleware behavior.
**Learning:** Zustand's `persist` middleware stores the entire state by default. This is dangerous for stores containing both UI preferences and sensitive data.
**Prevention:** Always use the `partialize` option in `persist` middleware to explicitly allowlist only non-sensitive slices (e.g., appearance, notifications) for storage.

## 2024-05-22 - [Order Entry Validation]
**Vulnerability:** Critical financial form (Order Entry) lacked input validation, relying solely on HTML5 attributes.
**Learning:** React Hook Form + Zod `superRefine` is essential for complex, interdependent validation logic (e.g., Limit Price required only for Limit orders).
**Prevention:** Enforce Zod schemas for all user inputs, especially those involving financial transactions. Use `valueAsNumber` carefully or preprocess inputs to handle empty strings correctly.

## 2025-02-27 - Input Sanitization for Phone Numbers
**Vulnerability:** The `phone` field in `profileSchema` was validated only for length (10-20 chars), allowing potential XSS payloads (e.g. `<script>1</script>`, `<b onclick=...>`) to be stored.
**Learning:** Length validation alone is insufficient for security. XSS payloads can be very short.
**Prevention:** Always apply `safeText` or strict regex validation to ALL user inputs, even those expected to be numeric or formatted like phone numbers.
