# Architecture

- Next.js App Router application with a shared shell in `src/app/layout.tsx`: fixed sidebar, top bar, theme provider, and global toaster.
- Mixed rendering model:
  - Server-rendered pages read from Postgres through Drizzle (`src/app/page.tsx`, `src/app/portfolios/holdings/page.tsx`).
  - Many other feature pages are client components backed by in-file mock arrays and local React state.
- Persistence layer is small and relational:
  - `portfolios`
  - `holdings`
  - `transactions`
  - Alpha Radar 13F research tables for tracked filers, SEC filings, parsed holdings, quarterly changes, reports, and refresh runs
  - Relations are portfolio -> holdings and portfolio -> transactions.
- Database access is centralized in `src/db/index.ts` using `postgres` + `drizzle-orm`. If `DATABASE_URL` is missing, the app does not fail build, but database-backed features degrade at runtime.
- Market data is routed through `MarketDataEngine`:
  - optional primary provider
  - Alpha Vantage secondary/fallback provider
  - current singleton is instantiated without a primary provider, so runtime uses Alpha Vantage directly.
- Schwab integration is server-side:
  - OAuth callback route exchanges auth code for tokens
  - order route validates an app-level order payload and maps it to Schwab's order format
  - tokens are not persisted yet.
- Client-only durable state is limited to the settings store in Zustand with `persist`; only appearance, notifications, and tags are written to local storage.
- Initial database content is loaded from mock data via `scripts/seed.ts`.
- Alpha Radar v1 stays inside the Next.js application:
  - SEC EDGAR ingestion and 13F parsing live under `src/lib/sec`.
  - Diff, memo, refresh orchestration, repositories, and seed filers live under `src/lib/alpha-radar`.
  - App routes under `src/app/api/alpha-radar` expose filer, filing, holding, change, report, and refresh data.
  - Research, Dashboard, Settings alerts, and notification surfaces reuse existing React/Zustand/TanStack Query patterns rather than a separate service.
- Alpha Radar v2 semantic memory adds `alpha_radar_semantic_chunks` for filing text chunks, memo sections, source citations, keyword metadata, and optional embedding metadata. The portable storage format uses JSONB embeddings plus keyword fallback so local Postgres works even when pgvector is unavailable.

## Alpha Radar v2 Agentic Boundaries

AR-125 keeps v2 contract-first. The first v2 runtime stays in TypeScript inside the existing Next.js/Postgres application and exposes agent boundaries as server-side modules. Long-running or scheduled work can later move to a separate Node worker process, but that worker must implement the same `src/lib/alpha-radar/agent-contracts.ts` interfaces. Do not introduce a Python/FastAPI service boundary for v2 unless a later issue explicitly changes this decision.

Pipeline:

```text
scheduler-agent
  -> ingestion-agent
      -> sec-parser-agent
          -> portfolio-diff-agent
              -> semantic-search-agent
              -> thesis-agent
                  -> notifier-agent
                      -> ui-query-service
```

Contract ownership:

| Boundary | Operation | Initial owner module | v1 adapter |
| --- | --- | --- | --- |
| `scheduler-agent` | `schedule-refresh` | `src/lib/alpha-radar/scheduler` | Manual refresh flow in `src/lib/alpha-radar/refresh.ts` |
| `ingestion-agent` | `refresh-filings` | `src/lib/sec` | `AlphaRadarSecIngestionService` |
| `sec-parser-agent` | `parse-information-table` | `src/lib/sec` | `parseThirteenFInformationTable` |
| `portfolio-diff-agent` | `compute-quarterly-diff` | `src/lib/alpha-radar` | `computeQuarterlyHoldingChanges` |
| `semantic-search-agent` | `semantic-search` | `src/lib/alpha-radar/memory` | No v1 adapter; start with disabled/keyword fallback before pgvector |
| `thesis-agent` | `generate-thesis-draft` | `src/lib/alpha-radar/thesis` | `generateAlphaRadarMemo` |
| `notifier-agent` | `notify-material-change` | `src/lib/alerts` | `evaluateAlphaRadarAlerts` |
| `ui-query-service` | `read-ui-index` | `src/lib/api/alpha-radar` | `src/lib/api/alpha-radar/queries.ts` |

Shared job semantics:

- Every async boundary receives an `AlphaRadarJobEnvelope<TPayload>` with `agent`, `operation`, `contractVersion`, `idempotencyKey`, `attempt`, `retryPolicy`, and optional trace context.
- Idempotency keys are deterministic across equivalent payloads and include contract version, agent, operation, report period, scope, and a payload fingerprint.
- Default retry policy is three attempts with exponential backoff for rate limits, timeouts, provider outages, storage conflicts, and database deadlocks. Invalid input, not found, and parse failures are terminal unless a later boundary explicitly wraps them as retryable.
- Results use a single `AlphaRadarAgentResult<TOutput>` union: `succeeded`, `skipped`, or `failed`. Failures must include a structured error code and `retryable` flag.

Failure handling:

- Scheduler dedupes by idempotency key before enqueueing and records blocked or skipped jobs instead of silently dropping them.
- Ingestion isolates per-filer failures so one SEC or CIK issue does not fail the full refresh.
- Parser errors remain attached to the filing and do not block other filings for the same filer.
- Diff and thesis boundaries run from stored normalized inputs wherever possible; they should be replayable without new SEC calls.
- Semantic memory must support disabled/no-key mode, returning `provider: "disabled"` or `provider: "keyword-fallback"` rather than failing the report workflow.
- Notifier delivery is best-effort per channel and records suppressed rules separately from delivery failures.
- UI query service is read-only and must not trigger ingestion or generation side effects.

Semantic memory:

- `src/lib/alpha-radar/memory.ts` owns chunking, citation construction, disabled embedding behavior, keyword fallback search, and vector scoring helpers.
- `src/lib/alpha-radar/memory-repository.ts` owns persistence and exposes a repository contract with Drizzle and in-memory implementations.
- `alpha_radar_semantic_chunks` stores the source kind/id, tracked filer, filing/report references, report period, title, text body, citation JSON, metadata JSON, keyword JSON, optional embedding JSON, provider/model/dimensions, and content hash.
- Migration `0004_alpha_radar_semantic_memory.sql` enables pgvector only if the extension is available; it does not require pgvector for the table to exist. Keyword and metadata GIN indexes keep fallback search usable in local/dev environments.
- Research renders a small evidence-memory search against live semantic memory when populated and falls back to local report chunks otherwise. Ask Ledger routes Alpha Radar/13F evidence questions to the same deterministic semantic-memory search surface.

Clone tracking:

- `src/lib/alpha-radar/clone-graph.ts` computes graph-ready filer/security/user-signal nodes, edges, and clusters from Alpha Radar holding changes.
- Clusters are grouped by ticker/CUSIP and report period, then scored with materiality, multi-filer overlap, consensus direction, and user portfolio/watchlist/thesis overlap.
- The Research Alpha Radar pane renders a DOM-first clone tracking visualization with fund-style filters. This avoids adding a graph rendering dependency while preserving the graph data shape for later richer visualization.

Conviction scoring:

- `src/lib/alpha-radar/conviction.ts` ranks Alpha Radar ideas with deterministic factor scoring. The model separates raw 13F signal, user relevance, and evidence fit instead of hiding those dimensions in a single opaque number.
- Raw 13F signal factors include v1 materiality, position size, weight movement, rank movement, action type, clone-graph consensus, and optional prior score history.
- User relevance factors include portfolio, watchlist, and active-thesis overlap. Evidence fit can consume semantic memory snippets from AR-126.
- The Research Alpha Radar pane renders top conviction-ranked ideas with component scores and machine-readable factor labels. Persistence uses input/output history contracts for now; no new persistence table is required until recurring score history is needed.

External overlays:

- `src/lib/alpha-radar/overlays.ts` defines provider interfaces for insider activity, earnings transcript sentiment, valuation, and theme exposure overlays.
- Providers return cited `AlphaRadarExternalOverlay` records. Disabled or failed providers produce warnings and do not block core ingestion, parsing, diffing, memo generation, or UI rendering.
- The enrichment layer matches overlays to Alpha Radar ideas by ticker first and issuer fallback second, then exposes overlay-kind and thematic filters such as AI infrastructure or insider corroboration.
- Research renders external overlays in a separate panel from source 13F facts. Current UI wiring uses seeded fixture overlays until live provider configuration is selected.

Thesis drafts:

- `src/lib/alpha-radar/thesis-drafts.ts` turns conviction-ranked Alpha Radar ideas into reviewable “why now?” thesis draft candidates.
- Drafts include hypothesis, why-now, falsify-if, risks, next watch items, confidence, duplicate active-thesis detection, and cited evidence from holding changes, source filings, semantic memory, and external overlays.
- Generated drafts are never promoted into active theses automatically. The Research Alpha Radar pane exposes local edit, accept, and archive states as a human-review workflow before any future persistence/store integration.

Scheduled orchestration and delivery:

- `src/lib/alpha-radar/scheduler.ts` implements the AR-131 scheduler boundary without adding a separate worker stack. It plans weekly, quarterly, and ad hoc Alpha Radar refreshes with deterministic schedule-window idempotency keys.
- The default refresh pipeline queues ingestion, parser, diff, thesis, and notifier operations. Scheduling does not perform SEC calls directly; it only creates downstream job references that a future worker or cron runner can execute through the AR-125 contracts.
- Quarterly windows respect the 13F availability lag instead of assuming quarter-end data is immediately tradable. Run history summaries collapse repeated failures into one actionable in-app status so retries do not spam duplicate alerts.
- Delivery planning supports in-app, email, Slack, and Telegram channel preferences. The approved v2 implementation delivers in-app and leaves external channels adapter-gated until AR-133 locks provider credentials, destinations, and cost controls.
- Settings persist `alphaRadarDelivery` preferences for scheduled updates, failure summaries, channel toggles, and ticker filters. Research renders scheduled run visibility so users can see due jobs, last run status, and delivery mode.

Backtesting:

- `src/lib/alpha-radar/backtest.ts` evaluates 13F-derived hypotheses from stored signal shapes plus supplied price series. It does not fetch live market data during tests or UI rendering.
- Backtest scenarios cover top adds, exits, clone-consensus ideas, conviction-ranked ideas, and user-overlap ideas. Exit signals are modeled as avoid-or-short outcomes so the methodology can test whether following reported exits would have avoided underperformance.
- Entry dates are delay-aware: the engine waits until the later of filing acceptance or the configured 13F reporting lag from the report period end. This prevents same-day quarter-end lookahead bias.
- Results include completed/skipped trades, hit rate, forward signal return, benchmark return, relative return, drawdown, lag days, missing-price skips, and split-adjustment warnings.
- Research renders the backtest as exploratory signal-quality evidence and explicitly states it is not a production trading recommendation.

Operations, observability, and cost controls:

- `src/lib/alpha-radar/operations.ts` defines the AR-133 operator boundary for provider budgets, circuit breakers, run health summaries, deployment requirements, and dry-run maintenance plans.
- Provider adapters get deterministic budget decisions before external calls. Decisions distinguish allowed, warn, throttled, and circuit-open states, and `enforceAlphaRadarProviderBudget` fails closed when a provider is over budget or in cooldown.
- Operational health summaries combine scheduler history, refresh results, provider latency/budget decisions, parser/memo/notifier events, and retry actions into one operator-facing status.
- Maintenance plans cover reprocessing a filer/period, deleting derived parsed output, and replaying memo generation. Destructive delete plans require an explicit confirmation token when dry-run mode is disabled.
- Research renders a compact Run operations panel with last-run status, provider budget health, retry count, and dry-run maintenance readiness.
- Deployment requirements are modeled for local, preview, and production so production setup cannot rely on docs alone for required database, SEC user-agent, provider key, scheduler, pgvector, and notification assumptions.

NOT in scope for AR-125:

- pgvector schema, chunking, embedding providers, or semantic memory write paths. These belong to AR-126.
- Clone graph calculations and graph UI. These belong to AR-127.
- Recurring scheduler storage, external delivery adapters, observability dashboards, and cost controls belong to AR-131 and AR-133.
