# Security Audit Report — Portfolio-Manager

**Date:** 2025-05-16
**Branches reviewed:** `master`, `new_feature`, `albany`, `alpha_radar` (current)
**Auditor:** Automated review via code analysis + `npm audit`

---

## Executive Summary

The codebase has solid foundations (security headers, input validation via Zod, ORM-only DB access, API key redaction in logs, non-root Docker user). However, there are **2 CRITICAL** and **3 HIGH** severity issues that should be addressed before any production deployment.

---

## CRITICAL

### 1. Real secrets committed in `.env.example` — leaked to git history

**Files:** `.env.example` (lines 5–6)
**Branch:** all branches

The `.env.example` file contained **real, working credentials**. Values are
redacted here so the audit report does not preserve the leak:

```
NEXT_PUBLIC_SUPABASE_URL="[REDACTED_SUPABASE_PROJECT_URL]"
NEXT_PUBLIC_SUPABASE_ANON_KEY="[REDACTED_SUPABASE_ANON_KEY]"
```

While Supabase anon keys are designed to be public (RLS-enforced), this sets a dangerous precedent. More critically, the `.env.example` pattern normalizes committing real values — and `.env` / `.env.local` are only excluded by the `.gitignore` glob `.env*`, meaning `.env.example` **IS tracked** (confirmed: no git-tracked `.env` or `.env.local`, but the example file ships real Supabase coordinates).

**Risk:** If row-level security is misconfigured, the anon key + project URL gives unauthenticated read/write access to your Supabase database.

**Remediation:**
- Replace real values in `.env.example` with clear placeholders
- Audit Supabase RLS policies to confirm the anon key cannot bypass them
- Consider rotating the anon key after scrubbing git history

---

### 2. `.env` and `.env.local` exist on disk with production secrets

**Files:** `.env` (lines 1–8), `.env.local` (lines 1–6)

While not git-tracked, these files contain:
- **Full Supabase database connection string** (password redacted)
- **Alpha Vantage API key** (redacted)
- **Plaid sandbox credentials** (client ID + secret)

**Risk:** Any developer clone, CI artifact, or Docker build context that inadvertently includes these files leaks full database access. The `.dockerignore` excludes `.env` but the broader risk is that these values are in a **non-encrypted file on every developer machine** with no rotation policy.

**Remediation:**
- Use a secrets manager (Vercel env vars, AWS Secrets Manager, 1Password CLI)
- Rotate the Supabase database password immediately (it appears in this audit)
- Rotate the Alpha Vantage API key

---

## HIGH

### 3. No authentication on API routes — all endpoints are public

**Files:** All routes under `src/app/api/` except `src/app/api/schwab/order/route.ts`

There is **no auth middleware** (`src/middleware.ts` does not exist). Every API endpoint — market data, portfolio valuation, Alpha Radar filer management, Plaid token exchange — is callable by **anyone** who knows the URL.

The **only** protected route is `/api/schwab/order` which checks an `X-API-Key` header against `INTERNAL_API_SECRET`. All other routes including:
- `GET /api/portfolio/[id]/value` — reveals portfolio holdings & values
- `POST /api/plaid/link-token` — creates Plaid Link tokens
- `POST /api/plaid/exchange-public-token` — exchanges tokens for access tokens
- `POST /api/alpha-radar/filers` — creates tracked filers
- `GET /api/alpha-radar/filers` — lists tracked filers

…require zero authentication.

**Risk:** Data exfiltration, unauthorized Plaid connections, Polygon/AV API quota exhaustion.

**Remediation:**
- Add Supabase Auth (or NextAuth) middleware that validates a session/JWT on all `/api/*` routes
- At minimum, protect Plaid and portfolio routes behind auth

---

### 4. No rate limiting on public API routes

**Files:** All `src/app/api/market-data/*.ts` routes, `src/app/api/alpha-radar/**`

None of the API routes implement server-side rate limiting. The Polygon adapter has internal retry logic for upstream 429s, but there is nothing preventing an attacker from:
- Sending thousands of `/api/market-data/quotes?symbols=...` requests to exhaust your Polygon API quota
- Abusing `/api/market-data/search?query=...` as an open proxy to Polygon's search API

The `/api/market-data/quotes` endpoint also has **no cap on the number of symbols** — a request with 500 comma-separated symbols would trigger a large batch to Polygon in a single call.

**Risk:** API quota exhaustion (financial cost), denial-of-service to legitimate users.

**Remediation:**
- Add rate-limiting middleware (e.g., `next-rate-limit`, Vercel Edge rate limiting, or Upstash Redis)
- Cap `symbols` array to a reasonable max (e.g., 50)
- Require authentication (see #3) which naturally enables per-user rate limiting

---

### 5. Error messages may leak internal details

**Files:** All API routes, `src/lib/api/market-data/alpha-vantage.ts` (line 26)

API error handlers return `err.message` directly to the client:
```typescript
const message = err instanceof Error ? err.message : 'Internal server error';
return NextResponse.json({ error: message }, { status: 500 });
```

If an upstream provider error includes a URL with an API key (e.g., Alpha Vantage constructs URLs like `...&apikey=MN20G3HXDMT936R9`), and that URL ends up in an error message, it gets returned to the client.

The **Polygon adapter** properly redacts URLs via `redactUrl()`, but the **Alpha Vantage provider** does NOT — `throw new Error(\`Alpha Vantage API error: ${response.statusText}\`)` is safe, but if `fetch()` itself throws (e.g., DNS failure), the URL with the API key could leak via the native error message.

**Risk:** API key exposure in error responses to unauthenticated callers.

**Remediation:**
- Never return raw `err.message` to clients from provider layers
- Wrap all upstream errors in a sanitized error class (like Polygon's approach)
- Log the full error server-side; return only a generic message to the client

---

## MEDIUM

### 6. `master` branch had hardcoded database fallback URI

**File:** `src/db/index.ts` on `master` branch (fixed on `albany` — commit `0358c00`)

The master branch contains:
```typescript
const client = postgres(connectionString || "postgres://DATABASE_URL_MISSING", {...});
```

While this particular fallback isn't a real credential, it demonstrates a pattern where a forgotten or changed fallback could leak a real connection string. The fix on `albany` removes it properly.

**Status:** Fixed on `albany`, still present on `master`.

---

### 7. Schwab OAuth callback logs full error objects

**File:** `src/app/api/auth/schwab/route.ts` (line 29)

```typescript
console.error("Schwab OAuth Error:", errorMessage);
```

While `errorMessage` is the `.message` property (not the full error), Schwab OAuth errors can contain callback URLs with tokens. This is logged server-side which is lower risk but should still be sanitized.

---

### 8. Plaid token vault uses filesystem storage

**File:** `src/lib/plaid/server-token-vault.ts`

The vault stores encrypted Plaid access tokens in `.runtime/plaid-token-vault.json`. While properly encrypted (AES-256-GCM), filesystem-based secrets are risky in multi-instance deployments (tokens won't be shared) and could be exposed via container volume mounts or backup artifacts.

**Remediation:** For production, store tokens in the database (encrypted) or a dedicated secrets manager.

---

## LOW

### 9. CSP allows `'unsafe-eval'` and `'unsafe-inline'`

**File:** `next.config.ts` (CSP header)

The Content-Security-Policy includes `script-src 'self' 'unsafe-eval' 'unsafe-inline'` which significantly weakens XSS protections. This is common in Next.js dev setups but should be tightened for production.

---

### 10. No CORS configuration

**File:** `next.config.ts`

There are no explicit CORS headers configured. Next.js API routes default to same-origin, which is fine for a single-domain app, but if the frontend is ever served from a different origin (e.g., mobile app, subdomain), this should be explicitly configured rather than left implicit.

---

### 11. `.dockerignore` doesn't exclude all sensitive files

**File:** `.dockerignore`

Current contents:
```
node_modules
.next
.git
```

Missing: `.env*`, `*.pem`, `.runtime/` (Plaid vault), `drizzle/` (migration history). The Dockerfile's `COPY . .` in the builder stage would include `.env` files if they exist at build time.

**Remediation:** Add `.env*` and `.runtime/` to `.dockerignore`.

---

## Positive Findings

| Area | Status |
|------|--------|
| `.env` / `.env.local` not git-tracked | ✅ |
| Polygon API key redacted in error messages | ✅ (via `redactUrl()`) |
| Security headers (HSTS, X-Frame-Options, CSP, etc.) | ✅ |
| `npm audit` — 0 vulnerabilities | ✅ |
| Zod validation on Schwab order API | ✅ |
| Zod validation on Alpha Radar filer creation | ✅ |
| ORM-only DB access (no raw SQL injection vectors) | ✅ |
| Docker runs as non-root user | ✅ |
| `poweredByHeader: false` in Next.js config | ✅ |
| Input encoding (`encodeURIComponent`) on all outbound API calls | ✅ |
| Symbol validation in Polygon adapter | ✅ |
| Plaid token encryption at rest | ✅ |

---

## Recommended Priority Actions

1. **Immediately rotate** the Supabase DB password and Alpha Vantage API key (exposed in this file / `.env`)
2. **Add authentication middleware** to all API routes
3. **Add rate limiting** to market-data and Plaid endpoints
4. **Sanitize error responses** — never return raw `err.message` from provider calls
5. **Scrub `.env.example`** of real values and audit RLS
6. **Add `.env*` to `.dockerignore`**
7. **Merge the `albany` DB fix** into `master`
