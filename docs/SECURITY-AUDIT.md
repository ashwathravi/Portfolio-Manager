# Security review

**Date:** 2026-10-29, launch item i69, before the first beta invites. It replaces the review of 2025-05-16, which is in this file's git history; every finding from it is resolved (see the end).
**Covers:** master at `a50d22a` plus the fixes in the same pull request.
**How:**
- read the code;
- two independent sweeps: tenancy, and injection-class bugs;
- checked the live configuration of Vercel, GitHub and Supabase (names and settings only, never secret values);
- `npm audit`;
- the GitHub CodeQL, Dependabot and secret-scanning alerts;
- Supabase's security advisors.

## Summary

There are no critical or high findings.
- **Fixed in this pull request:** two medium and six low findings (S1 to S8).
- **Owner actions:** four configuration changes in Vercel, GitHub and Supabase (A1 to A4). A1 and A2 need doing before the first invite.
- **Accepted:** six risks, each with its reason (D1 to D6).

| | Area | Severity | Status |
|---|---|---|---|
| S1 | Any signed-in user could change Alpha Radar for everyone and make it call SEC EDGAR at will | Medium | Fixed |
| S2 | CSV exports wrote text a spreadsheet runs as a formula | Medium | Fixed |
| S3 | One filer's Alpha Radar refresh missed the refresh rate limit | Low | Fixed |
| S4 | Plaid Link's metadata was trusted from the browser | Low | Fixed |
| S5 | A weak Plaid token key was accepted | Low | Fixed |
| S6 | Five routes read JSON without a size cap | Low | Fixed |
| S7 | 13F parsing decoded entities twice, and an out-of-range entity failed the filing (CodeQL `js/double-escaping`) | Low | Fixed |
| S8 | Order plans and Plaid accounts weren't tied to their owner's account or connection in the database | Low (hardening) | Fixed |
| A1 | No Alpha Radar admin is named | Setup | Owner |
| A2 | `CRON_SECRET` isn't set: the nightly job has never run in production | Setup | Owner |
| A3 | An unused repository secret, `DATABASE_URL` | Low | Owner |
| A4 | Production's Upstash token is also given to Preview and Development | Low | Owner |

## Fixed in this pull request

**S1. Alpha Radar is managed by admins (tracker issue x13).**
- **The problem:** tracked filers are shared by every user. Any invited user could add, edit or disable them, and could start a forced refresh of every filer, which fetches from SEC EDGAR. Hammering it could get the app's SEC contact blocked.
- **The fix:**
  - Creating, editing and disabling filers, and both refreshes, now need an admin, named in `AUTH_ADMIN_EMAILS` (`requireAdminApiUserScope` in `src/lib/api/session-security.ts`).
  - Anyone else gets 403 `ADMIN_REQUIRED`, and the two Refresh buttons don't show for them.
  - With no admin named, nobody is one. The local developer always is.
  - Reading stays open to every signed-in user.
- **Later:** per-user follows replace this (i60).

**S2. CSV formula injection.**
- **The problem:** account names, transaction notes, imported holding names and names sent by banks reach the Activity, Settings and Performance exports. A value starting with `=`, `+`, `-`, `@`, a tab or a carriage return runs as a formula when the file is opened in Excel or Sheets. The input check could be skipped with a leading space, and a lone carriage return wasn't quoted.
- **The fix:** `exportToCsv` (`src/lib/exportCsv.ts`) writes such text with a leading apostrophe and quotes any line break. Plain numbers, negative ones included, stay numbers.

**S3. The per-filer refresh rate limit.** `/api/alpha-radar/filers/:id/refresh` fell under the default 300 calls a minute. Now both refreshes get the refresh limit: 20 a minute per IP, 30 per user (`src/lib/api/security.ts`).

**S4. Plaid Link metadata.**
- **The problem:** the browser sends Link's metadata with the public token, and the institution name and ID in it were stored as sent. A crafted ID could slip past the duplicate-connection check (i46), a crafted name ended up in account names, and a non-string name caused a 500.
- **The fix:** the metadata is validated (`plaidLinkMetadataSchema`: strings with length caps, at most 100 accounts) and dropped if it doesn't fit. Refusing the request would waste the one-use public token. The institution now comes from Plaid's own `/accounts/get` answer, and the browser's name is kept only when its ID matches Plaid's.

**S5. The Plaid token key.**
- **The problem:** tokens are AES-256-GCM encrypted with a SHA-256 of `PLAID_TOKEN_ENCRYPTION_KEY`, and any string was accepted. A short or guessable phrase would let someone holding the ciphertexts, such as from a backup, guess it offline.
- **The fix:** production now requires at least 32 bytes written as base64 or hex (`openssl rand -base64 32`), and stores no token with a weaker key. Production has no Plaid key yet, so nothing needs re-encrypting.

**S6. Body size caps.** The Plaid token exchange (64 KB) and the four Alpha Radar write routes (16 KB) now read their bodies through `readJsonBody`, like every import route. They answer 413 when a body is too big. A body that isn't JSON now gets a 400 rather than a 500. The Schwab order route still reads without a cap; it is off in production (D4).

**S7. 13F entity decoding.** `&amp;#60;` was decoded twice, to `<`, which the parser refuses, failing the whole filing. `&#99999999;` threw. Entities are now decoded in one pass, and invalid ones are left as written. It could never run script: the text is rendered as text.

**S8. Owner-consistent foreign keys** (migration 0025).
- **The gap:** the database didn't check that an order plan's account, or a Plaid account's connection, belonged to the same user. Only the code kept these consistent, so a future code path that missed it could file one user's row under another user's account.
- **The fix:** a composite foreign key on `(portfolio_id, user_id)` and on `(plaid_item_record_id, user_id)`. Thesis catalysts and evidence already work this way.

## For the owner

**A1. Name the admin.**

```bash
vercel env add AUTH_ADMIN_EMAILS production
```

Until it's set, nobody can refresh Alpha Radar or change its filers in production.

**A2. Set `CRON_SECRET`.**
- **What's wrong:** production's `job_runs` table is empty, so the daily job has never run. Without `CRON_SECRET`, Vercel's call is refused before anything starts.
- **What that misses:** stored closing prices, valuation snapshots, the nightly Plaid sync and the Ask history prune.
- **Supabase pausing:** the free Supabase project pauses after a week without activity, and this job is what keeps it active (tracker issue x20).
- **Market data:** the price step also needs `POLYGON_API_KEY` (i08).

```bash
openssl rand -hex 32 | tr -d '\n' | vercel env add CRON_SECRET production
```

**A3. Delete the repository secret `DATABASE_URL`.**
- No workflow uses it; the deploy and backup jobs read `DATABASE_MIGRATION_URL` from the `production` environment.
- A repository secret is available to workflows on any branch, while the `production` environment admits only master.

```bash
gh secret delete DATABASE_URL --repo ashwathravi/Portfolio-Manager
```

**A4. Upstash in Preview and Development.**
- **The exposure:** the Upstash integration gives `KV_REST_API_TOKEN` and `REDIS_URL`, which can write to production's Redis, to every environment. `vercel env pull` puts them on a laptop.
- **How far it goes:** the app keeps keys apart per environment and per preview branch, and previews are behind Vercel Authentication. So the exposure is a write token for rate-limit counters, not user data.
- **The fix:** in the integration's settings, connect the store to Production only.

**Optional hardening:**
- Turn off Supabase's Data API (i74). It's already closed: row-level security is on every table, `anon` and `authenticated` have no grants, and the advisors report nothing.
- Require actions pinned to full commit SHAs in GitHub's Actions settings; every workflow already pins them.

## Accepted, with reasons

**D1. Backups use the owner connection.**
- The backup and deploy jobs share the `production` environment and its master-only rule, so a separate read-only login wouldn't stop anything a leak of that environment exposes.
- A read-only role would also need to bypass row-level security.
- Revisit with a paid Supabase plan.

**D2. Plaid ciphertexts aren't bound to their row.**
- There is no additional authenticated data, and `key_version` isn't used when decrypting.
- Swapping two rows' tokens needs write access to the database, which already gives more.
- Add both with key rotation.

**D3. The rate limiter lets requests through if Upstash doesn't answer within a second.** The limits are for abuse, and availability comes first.

**D4. The Schwab order route** uses one shared token and the internal secret. It answers 404 in production whatever its flag says (`isSchwabIntegrationEnabled`), and it needs per-user tokens before it's ever turned on.

**D5. Validators check for a leading `=` before trimming.** S2 makes the exports safe whatever is stored.

**D6. Tenancy lives in the application.**
- The app's database role sees every row, and the code scopes each query to the session's user.
- Every route and page was traced to its queries (below), and S8 adds database checks where a row carries its own user ID.
- Row-level security per user would need the user's ID set on every connection; that's not planned for the beta.

## What protects the app

**Sign-in and sessions** (`src/auth.ts`, `src/lib/auth/access.ts`)
- **Accounts:** Google only, with a verified email.
- **Invite list:** production refuses sign-in without one (`AUTH_ALLOWED_EMAILS`), and every session read checks it again. Removing someone ends their access at once.
- **Sessions:** stored in the database, last 7 days, and are renewed daily. The cookie is `httpOnly`, `Secure` and `SameSite=Lax`.
- **Local bypass:** refused in production.

**Every request** (`src/proxy.ts`)
- **Pages:** need a session.
- **API routes:**
  - **User-scoped routes:** `requireSessionApiUserScope` takes the user from the Auth.js session and nothing else: no header, no shared secret.
  - **Cron routes:** need `CRON_SECRET`, compared in constant time.
  - **The Plaid webhook:** needs Plaid's ES256 signature with a known key, issued within 5 minutes, over the exact body.
  - **Open without a session:** only `/api/health` and `/api/health/ready`.
- **`INTERNAL_API_SECRET`:** not set in production, and it never stands for a user.
- **CSRF:** state changes are JSON calls from the app, carried by a `SameSite=Lax` cookie, which browsers don't send on cross-site requests. Auth.js protects its own forms with a token.

**Tenancy.** Every user-scoped route was traced to its queries:
- accounts, transactions, holdings imports, orders, theses, the journal, the watchlist, settings, Plaid, Ask, export and deletion;
- the pages, and the webhook and cron.

Every ID from a URL or body is checked against the session's user, in the WHERE clause or in the same transaction. Every upsert has the user in its conflict target. The E2E specs check, with a database:
- another user's IDs get a 404, for accounts, activity, orders, theses, the journal, the watchlist and holdings imports;
- signed-out callers get a 401.

**Database**
- Row-level security is on for all 29 tables, with a deny-all policy for Supabase's `anon` and `authenticated` roles, which also have no grants (migrations 0007 and 0008). `src/db/schema.test.ts` fails if a table lacks either. Supabase's security advisors report nothing.
- The app connects as `atlas_app`, a least-privilege login (`app_runtime`). Migrations run as the owner, from CI only.

**Secrets**
- In Vercel, the database, sign-in and Sentry values are Sensitive. The database and sign-in values exist in Production only, so a preview can't reach production data.
- In GitHub, the owner connection and the Vercel token live in the `production` environment, which admits only master.
- Secret scanning and push protection are on, with no open alerts.
- Errors reaching Sentry lose cookies, bodies and query strings, and keep only five harmless request headers. Secrets are masked anywhere in an event (`src/lib/observability/sentry-options.ts`).
- API errors answer a fixed message (`internalServerError`).

**Browser**
- **Content-Security-Policy:** a fresh nonce on every response, with `'strict-dynamic'` and no `'unsafe-inline'` for scripts (`content-security-policy.spec.ts`).
- **Other headers:** HSTS with preload, `X-Frame-Options: DENY`, `nosniff`, a strict `Permissions-Policy`, `strict-origin-when-cross-origin`.
- **Rendering:** React escapes all text. The only raw HTML is the pattern feed's `<em>`, which escapes everything first.
- **Links:** thesis evidence links must be http(s).
- **Redirects:** the sign-in callback is checked to stay on the site (`src/lib/auth/callback-url.ts`).

**Outbound calls**
- **Fixed hosts:** Plaid, Massive and SEC EDGAR.
- **Validated input:** symbols, CIKs and accession numbers are checked by regex and URL-encoded. A user can't choose the host.
- **Keys:** the market-data key is redacted from errors.
- **Plaid tokens:** never returned to the browser.

**Rate limits** (`src/lib/api/security.ts`)
- **Where they're kept:** Upstash, shared by every instance and keyed per environment. Signed-in users are limited per user, others per IP (`x-real-ip` on Vercel, which clients can't forge).

| Routes | Per IP | Per user |
|---|---|---|
| Sign-in | 30 a minute | — |
| Cron | 10 a minute | — |
| Plaid and Alpha Radar refreshes | 20 a minute | 30 a minute |
| Search | 30 a minute | 60 a minute |
| Market data | 120 a minute | 240 a minute |
| Everything else | 180 a minute | 300 a minute |

**Delivery**
- **Actions:** every one is pinned to a commit SHA, and the default token is read-only.
- **Triggers:** no `pull_request_target`.
- **Forks:** a first-time contributor's workflows wait for approval, and Vercel doesn't build a fork's pull request until approved. Previews are behind Vercel Authentication.
- **Dependencies:** `npm audit` reports 0 vulnerabilities (production and development) and there are no open Dependabot alerts. Dependabot opens weekly updates, and CodeQL runs on every pull request.

**Backups:** nightly, encrypted to a key CI can't decrypt, and restored and checked in the same run (`docs/backups.md`).

## The 2025 review's findings

| 2025 finding | Now |
|---|---|
| Real Supabase values in `.env.example` | Placeholders only. The unused `NEXT_PUBLIC_SUPABASE_*` lines go with i73. |
| Production secrets in local `.env` files | Local development uses the Docker database (`db:setup` refuses anything else). Production secrets live only in Vercel and GitHub. |
| No authentication on API routes | Every route needs a session, the cron secret or Plaid's signature, except the two health checks. |
| No rate limiting | Shared limits in Upstash, per user and per IP. |
| Raw error messages returned | A fixed message per error, with details sent to Sentry, scrubbed. |
| A database fallback URI | Without a usable `DATABASE_URL` every query fails with `DatabaseNotConfiguredError`. |
| Schwab OAuth logging | The Schwab routes are off in production. |
| A file-based Plaid token vault | Encrypted in Postgres in production. |
| CSP with `'unsafe-inline'` and `'unsafe-eval'` | A nonce with `'strict-dynamic'`. |
| No CORS configuration | Same-origin only. No CORS headers are sent, which is right for a single-domain app. |
| `.dockerignore` missing `.env*` | `.env*` and `.runtime` are excluded. `*.pem` goes with i74. |

## Repeating this review

```bash
npm audit && npm audit --omit=dev
gh api "repos/ashwathravi/Portfolio-Manager/code-scanning/alerts?state=open" --jq length
gh api "repos/ashwathravi/Portfolio-Manager/dependabot/alerts?state=open" --jq length
gh api "repos/ashwathravi/Portfolio-Manager/secret-scanning/alerts?state=open" --jq length
gh secret list --repo ashwathravi/Portfolio-Manager
vercel env ls
```

- Supabase › Advisors › Security should report nothing.
- In the code:
  - every new API route needs `requireSessionApiUserScope` or `requireAdminApiUserScope`, or its own secret or signature check plus an entry in `src/proxy.ts`;
  - every new table needs row-level security and both policies (`src/db/schema.test.ts` enforces it).
