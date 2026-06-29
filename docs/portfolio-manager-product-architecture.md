# Portfolio Manager Product Architecture

## Overview

Portfolio Manager is a Next.js App Router application. It combines server-rendered pages, client-heavy interactive workspaces, deterministic TypeScript domain modules, Drizzle/Postgres persistence, provider-backed market data, local Zustand state, and Playwright/Node test coverage.

The current architecture favors a modular monolith. Feature domains live inside the Next.js app instead of separate services. This keeps local development fast, keeps deterministic calculations testable, and leaves clear boundaries for future worker or service extraction.

## High-Level System

```text
Browser UI
  |
  | React components, Zustand stores, TanStack Query, localStorage metadata
  v
Next.js App Router
  |
  | server pages and API routes
  v
Domain modules
  |
  +-- Market data service and provider adapters
  +-- Portfolio valuation
  +-- Alpha Radar ingestion/diff/memo/memory
  +-- Risk Policy Engine
  +-- Ask Ledger planner/tools/renderer
  +-- Research, reviews, alerts, execution helpers
  |
  v
Persistence and providers
  |
  +-- Postgres via Drizzle
  +-- Plaid API
  +-- Schwab API
  +-- Polygon/Massive and Alpha Vantage market data
  +-- SEC EDGAR
```

## Frontend Architecture

### App Shell

Core shell files:

- `src/app/layout.tsx`
- `src/components/layout/AppShell.tsx`
- `src/components/layout/AppSidebar.tsx`
- `src/components/layout/TopBar.tsx`
- `src/components/providers/ThemeProvider.tsx`
- `src/components/providers/QueryProvider.tsx`

The shell provides:

- Sidebar navigation.
- Topbar.
- Theme and density state.
- Global toaster.
- Mobile sidebar behavior.
- Shared market and user footer cards.

Primary navigation:

- Dashboard: `/`
- Performance: `/performance`
- Holdings: `/portfolios/holdings`
- Research: `/research`
- Strategies: `/strategies`
- Execution: `/execution`
- Ask Ledger: `/ask`
- Settings: `/settings`
- Help: `/help`

### Page Model

The app uses a mixed rendering model:

- Server components for pages that need direct database reads or server composition.
- Client components for rich UI workflows, filters, forms, settings, and local interaction state.
- API routes for provider calls, Plaid token exchange, Alpha Radar data, market data, and portfolio values.

Current route files:

- `src/app/page.tsx`
- `src/app/analytics/page.tsx`
- `src/app/ask/page.tsx`
- `src/app/execution/page.tsx`
- `src/app/help/page.tsx`
- `src/app/performance/page.tsx`
- `src/app/portfolios/page.tsx`
- `src/app/portfolios/holdings/page.tsx`
- `src/app/portfolios/trade-log/page.tsx`
- `src/app/research/page.tsx`
- `src/app/research/journal/page.tsx`
- `src/app/settings/page.tsx`
- `src/app/strategies/page.tsx`
- `src/app/strategies/[id]/page.tsx`
- `src/app/strategies/[id]/backtest/page.tsx`
- `src/app/strategies/builder/page.tsx`
- `src/app/strategies/deploy/page.tsx`

## Data Architecture

### Database

Database access is centralized through:

- `src/db/index.ts`
- `src/db/schema.ts`
- `drizzle/*.sql`
- `drizzle/meta/*.json`

The app uses Postgres through `postgres` and `drizzle-orm`. If `DATABASE_URL` is absent, database-backed features degrade and log a warning rather than preventing every local UI surface from rendering.

Supabase posture:

- Portfolio Manager treats Supabase as server-side Postgres, not as a browser-facing Data API.
- Runtime database access goes through `DATABASE_URL` and Drizzle from server pages, API routes, or server-side jobs.
- App tables in `public` enable row-level security defensively and revoke `anon` / `authenticated` table access in `drizzle/0007_supabase_data_api_hardening.sql`.
- New `public` tables must make an explicit choice in the same migration: keep them internal with revokes/RLS, or add intentional `GRANT` statements plus concrete RLS policies for any REST, GraphQL, or `supabase-js` exposure.
- The `vector` extension should live outside `public` when the database permits moving extensions; semantic memory falls back to JSONB/keyword search when pgvector is unavailable.

Core relational domains:

- Portfolios.
- Holdings.
- Transactions.
- Alpha Radar tracked filers.
- SEC filings.
- Filing holdings.
- Holding changes.
- Alpha Radar reports.
- Alpha Radar refresh runs.
- Alpha Radar semantic chunks.

### Local Client State

Zustand stores own client-side settings and app preferences:

- Settings state in `src/lib/stores/settingsStore.ts`.
- UI state in `src/lib/stores/uiStore.ts`.
- Alerts state in `src/lib/stores/alertsStore.ts`.

LocalStorage may store:

- Theme, density, accent, preferences, tags, and notification preferences.
- Risk policy settings.
- Connected account metadata.
- Ask Ledger local conversation history.
- Journal/review helper state.

LocalStorage must not store:

- Plaid access tokens.
- Plaid secret.
- Schwab refresh/access tokens.
- Provider API secrets.

## Domain Modules

### Market Data

Important files:

- `src/lib/api/market-data/index.ts`
- `src/lib/api/market-data/alpha-vantage.ts`
- `src/lib/providers/polygon-massive-adapter.ts`
- `src/lib/services/market-data-service.ts`
- `src/lib/services/portfolio-valuation-engine.ts`
- `src/lib/cache/*`

The design uses provider abstraction:

- API routes call service-level functions.
- Service functions depend on provider interfaces.
- Providers normalize vendor-specific responses.
- Cache wrappers reduce repeated external calls.

Market data routes live under `src/app/api/market-data`.

### Alpha Radar

Important files:

- `src/lib/sec/*`
- `src/lib/alpha-radar/*`
- `src/lib/api/alpha-radar/queries.ts`
- `src/app/api/alpha-radar/*`
- `src/components/research/AlphaRadarResearch.tsx`
- `src/components/dashboard/AlphaRadarDashboardCard.tsx`

Pipeline:

```text
Tracked filer
  -> SEC filing ingestion
  -> 13F information table parse
  -> normalized holdings
  -> quarterly changes
  -> memo/report generation
  -> semantic memory and keyword fallback
  -> conviction, clone graph, overlays, thesis drafts, backtests
  -> Research, Dashboard, Alerts, Ask Ledger
```

Alpha Radar v2 uses contract-like TypeScript boundaries for future worker extraction:

- scheduler-agent.
- ingestion-agent.
- sec-parser-agent.
- portfolio-diff-agent.
- semantic-search-agent.
- thesis-agent.
- notifier-agent.
- ui-query-service.

### Risk Policy Engine

Important files:

- `src/lib/risk-policy/buckets.ts`
- `src/lib/risk-policy/themes.ts`
- `src/lib/risk-policy/dashboard.ts`
- `src/lib/risk-policy/de-risking.ts`
- `src/lib/risk-policy/options.ts`
- `src/lib/risk-policy/cash.ts`
- `src/lib/risk-policy/churn.ts`
- `src/lib/risk-policy/sell-discipline.ts`
- `src/lib/risk-policy/execution.ts`
- `src/lib/risk-policy/stress.ts`
- `src/components/dashboard/RiskPolicyDashboardCard.tsx`
- `src/components/holdings/OptionsRiskLedgerCard.tsx`
- `src/components/settings/cards/*`
- `src/components/execution/FocusVariant.tsx`

Risk policy modules are mostly pure TypeScript. They take holdings, trades, settings, and policy inputs, then return deterministic status objects for UI and Ask Ledger.

### Ask Ledger

Important files:

- `src/lib/ask/planner.ts`
- `src/lib/ask/tools.ts`
- `src/lib/ask/renderer.ts`
- `src/lib/ask/run.ts`
- `src/components/ask/*`

Ask Ledger flow:

1. User submits a question.
2. Planner chooses approved deterministic tools.
3. Tools call domain modules.
4. Renderer creates cited prose, rows, and links.
5. UI renders and stores local conversation state.

### Research And Journal

Important files:

- `src/lib/research/*`
- `src/lib/reviews/*`
- `src/components/research/*`
- `src/components/performance/ReviewsArchiveCard.tsx`
- `src/components/dashboard/WeeklyReviewCard.tsx`

Research tracks theses, evidence, watchlist items, catalysts, journal entries, archive states, and weekly reviews.

### Execution

Important files:

- `src/components/execution/*`
- `src/lib/execution/*`
- `src/lib/validators/execution.ts`
- `src/app/api/schwab/order/route.ts`
- `src/lib/api/schwab/client.ts`

Execution combines order form UX, rationale capture, mood cooldown, adherence checks, risk policy checks, and server-side Schwab order mapping.

### Plaid

Important files:

- `src/components/settings/cards/IntegrationsCard.tsx`
- `src/app/api/plaid/link-token/route.ts`
- `src/app/api/plaid/exchange-public-token/route.ts`
- `src/lib/plaid/link.ts`
- `src/lib/plaid/server-token-vault.ts`
- `src/lib/plaid/types.ts`

Plaid trust boundary:

```text
Client
  -> request link token
Server
  -> Plaid /link/token/create
Client
  -> Plaid Link SDK
Plaid Link
  -> public_token + metadata
Client
  -> POST public_token to server
Server
  -> Plaid /item/public_token/exchange
  -> Plaid /accounts/get
  -> store access_token server-side
  -> return sanitized account metadata
Client
  -> persist selected account metadata only
```

The current vault supports encrypted local file persistence when `PLAID_TOKEN_ENCRYPTION_KEY` or `INTERNAL_API_SECRET` is configured, with a `.runtime/plaid-token-vault.json` default path. If no key is configured, the token cache is process-memory only and connected Plaid accounts must be reconnected after a server restart before provider sync can resume.

Production token-storage decision:

- Use Postgres as the durable token registry, not per-token platform secrets. Plaid access tokens should live in a `plaid_items` table keyed by internal item id and scoped by authenticated `user_id`.
- Encrypt tokens at the application boundary with AES-256-GCM before writing to the database. Store `ciphertext`, `iv`, `auth_tag`, `key_version`, `plaid_item_id`, `institution_id`, `status`, `created_at`, `updated_at`, `last_successful_sync_at`, and `revoked_at`.
- Store the encryption key outside the database in the deployment secrets manager. Use `PLAID_TOKEN_ENCRYPTION_KEY` for local/dev and a managed KMS-backed secret in production. Include a `PLAID_TOKEN_KEY_VERSION` value so rows can be re-encrypted during key rotation.
- Keep account metadata in a separate `plaid_accounts` table keyed by internal account id, `user_id`, and `plaid_item_id`. Store non-secret fields needed for display and duplicate reconciliation: Plaid account id, institution id/name, account name, mask, type/subtype, capabilities, and sync status.
- Server routes and sync jobs resolve tokens by `user_id + internal connected-account id`; client components never receive Plaid access tokens, encrypted token blobs, or public tokens after exchange.
- Reconnect replaces or revokes the old item token for the same user/institution/account fingerprint. Delete/disconnect sets `revoked_at`, clears sync eligibility, and calls Plaid item removal when available.
- Key rotation is an operator workflow: deploy the new key as a new version, decrypt rows with the previous version in a controlled job, re-encrypt with the new version, then disable the old key after verification.
- AR-152 implements the first durable registry path behind `PLAID_TOKEN_STORAGE=postgres`. The local encrypted file vault remains a development bridge and should not be used as the production token source.

## API Surface

Current app API route groups:

- `/api/alpha-radar/*`
- `/api/auth/schwab`
- `/api/market-data/*`
- `/api/plaid/*`
- `/api/portfolio/[id]/value`
- `/api/portfolios/count`
- `/api/schwab/order`

API route rules:

- Validate request inputs with Zod or explicit parsing.
- Keep provider secrets server-side.
- Return clean JSON errors.
- Avoid leaking vendor payload shapes into UI components.
- Keep read routes side-effect free unless explicitly named as refresh/order/exchange.

## Security Architecture

### Secrets

Expected server-only secrets:

- `DATABASE_URL`
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `POLYGON_API_KEY`
- `ALPHA_VANTAGE_API_KEY`
- `SCHWAB_CLIENT_ID`
- `SCHWAB_CLIENT_SECRET`
- `SCHWAB_ACCESS_TOKEN`
- `SCHWAB_ACCOUNT_ID`
- `INTERNAL_API_SECRET`
- `SEC_EDGAR_USER_AGENT`

Expected public env values are limited and should use `NEXT_PUBLIC_` intentionally.

### Sensitive Data Rules

- Plaid access tokens stay server-side.
- Schwab order route requires internal API authentication before using server-side Schwab credentials.
- LocalStorage stores metadata and preferences, not provider credentials.
- Ask Ledger deterministic tools should not send portfolio data to unapproved external services.
- HTML rendering is restricted to controlled detector output in PatternRow; user-provided strings must remain plain text.

### Current Security Gaps

- Plaid token vault falls back to memory-only mode when no encryption key is configured.
- There is no first-class app authentication/authorization layer shown in the current local app.
- Plaid and Alpha Radar API routes are local-first and need auth/rate limits before network-visible deployment.
- CSP still allows inline and eval script behavior for current frontend dependencies; tighten with nonces/hashes and explicit Plaid directives before public release.
- CI actions are tag-pinned rather than SHA-pinned.
- CI depends on lint/build passing; repo-wide lint currently has existing debt.

## Testing Architecture

### Unit Tests

Unit tests use Node's built-in test runner with `tsx`.

Command:

```bash
npm test
```

Coverage areas include:

- Validators.
- Market data.
- Caching.
- Portfolio/performance calculations.
- Alpha Radar.
- Risk Policy Engine.
- Ask Ledger.
- Plaid mapping and sanitization.
- Zustand stores.

### E2E Tests

Playwright tests live in `tests/e2e`.

Command:

```bash
npm run test:e2e
```

Route coverage includes:

- Dashboard.
- Portfolios.
- Holdings.
- Trade log.
- Execution.
- Research.
- Strategies.
- Analytics.
- Performance.
- Settings.
- Help.
- Navigation.
- Critical paths.

### Build And Type Checks

Useful commands:

```bash
npx tsc --noEmit --pretty false --allowImportingTsExtensions
npx next build --webpack
```

`npm run build` currently uses Turbopack by default through Next 16 and can fail inside restricted sandboxes when Turbopack attempts worker operations that require port binding. `npx next build --webpack` is the reliable local verification path observed in this environment.

## Deployment And CI

CI workflow:

- `.github/workflows/docker-build.yml`

Jobs:

- Docker build and optional publish.
- Lint, unit tests, and Next build.
- Playwright E2E after lint/test/build.

CI risk:

- CI currently runs `npm run lint`, so repo-wide lint debt must be resolved before CI can be considered green.

## Extension Points

Recommended future extraction points:

- Alpha Radar scheduler/worker.
- Durable Plaid token vault.
- Broker token lifecycle service.
- Real notification delivery adapters.
- Redis or external cache for market data.
- Auth and user/account tenancy.
- Full provider-backed account sync.
- Portfolio tax-lot and realized gain engine.
