# Alpha Radar Operating Guide

Alpha Radar is the Portfolio Manager 13F research workflow. It tracks selected institutional filers, ingests recent SEC EDGAR 13F metadata, parses information-table XML, computes quarter-over-quarter holding changes, generates deterministic research memos, and surfaces the results in Research, Dashboard, and alert notifications.

## Data Sources

- CI and unit tests use local fixtures only. They must not call live EDGAR.
- While Atlas tracks no filer, Research › Alpha Radar shows example filers, labelled Sample, to a user who shows example data (Settings › Data), and otherwise says no filer is tracked yet. A tracked filer never falls back to the examples: until Atlas has loaded its 13F data, its page says so.
- Live refreshes require Postgres-backed Alpha Radar tables and SEC network access.

## Following and the daily SEC job

Tracked filers are shared by every account, and only admins add, change or refresh them. Each user follows the filers they want from Research › Alpha Radar (`alpha_radar_filer_follows`, launch item i60); Today's Alpha Radar card shows reports from the filers they follow, outside the example section, once Atlas tracks any filer. The follows are exported with the account and deleted with it.

`GET /api/cron/alpha-radar` (Vercel Cron, 11:15 UTC every day) runs the `alpha-radar` job: every enabled filer, the one checked longest ago first, until 240 seconds have gone (`src/lib/alpha-radar/daily-refresh.ts`). SEC requests stop at 270 seconds, so a filer still waiting on SEC can't keep the run from being recorded, and a `Retry-After` longer than 10 seconds (SEC's rate-limit block lasts minutes) fails that request instead of waiting. It parses and reports only filings it hasn't seen. `docs/deployment.md` › Scheduled jobs and `docs/monitoring.md` cover running it by hand and what its failures mean.

## Where a filer's changes meet you

Changes and reports are shared by every account, so the ingest stores them without anyone's overlap. When a user reads a filer's changes (`GET /api/alpha-radar/filers/[filerId]/changes`, session-backed), each change gets theirs (launch item i61, `src/lib/alpha-radar/user-overlap.ts`): held in any account (a position that isn't zero), on the watchlist, or with an active thesis. The examples, edited or not, and removed items don't count. Each change is then scored as the ingest would have scored it with that overlap (12 for a holding, 7 for the watchlist, 7 for a thesis, at most 100) and the list is ranked by it before the `limit` applies: the overlap adds at most 26, so besides the stored top `limit` only the changes scoring within 26 of its last one are read, and only those the user's overlap meets in full (`listAlphaRadarChangesForUser`).

A 13F names a holding by issuer and CUSIP, never by ticker, and the ingest doesn't map CUSIPs to tickers. So a change matches the user's ticker by company name: the issuer ("BANK AMER CORP") and the names the user's records and SEC's ticker file (`symbol_directory`) give the ticker ("BANK OF AMERICA CORP /DE/") reduce to the same key (`src/lib/alpha-radar/issuer-name.ts`: legal forms, state markers, share classes and the common CUSIP abbreviations). Keys must be equal, so Apple Hospitality is not Apple. Matching is by company: a user holding GOOGL overlaps both of Alphabet's share classes. An issuer whose abbreviation the key doesn't know is missed, never mismatched.

A stored report has no overlap section any more, since it would be the same for everyone. Research shows the reader's own ("Your overlap") in its place, and the clone graph, conviction ranking and thesis drafts read the overlap from the changes. Run planning, provider budgets, external overlays and the backtest still have only example inputs, so they show only with the example filers.

## SEC Fair Use

SEC EDGAR requires a descriptive user agent. `SEC_EDGAR_USER_AGENT` is required: without it Atlas makes no SEC request at all (the daily job fails, and a refresh answers 503 `SEC_NOT_CONFIGURED`):

```bash
SEC_EDGAR_USER_AGENT="Portfolio Manager Alpha Radar your-email@example.com"
```

Keep live refreshes conservative:

- Avoid CI calls to EDGAR.
- Prefer fixture-backed parser, diff, memo, and alert tests.
- Respect rate-limit responses and retry later instead of increasing concurrency.
- Treat 13F data as delayed quarter-end holdings. It can omit shorts, non-reportable securities, and intra-quarter changes.

## Local Setup

1. Start local Postgres if you need live persistence.
2. Apply Drizzle migrations, including `drizzle/0003_alpha_radar_domain.sql` and `drizzle/0004_alpha_radar_semantic_memory.sql`.
3. Run seed data:

```bash
node --import tsx scripts/seed.ts
```

4. Configure `DATABASE_URL` and, for live SEC refreshes, `SEC_EDGAR_USER_AGENT`. E2E servers leave it empty, so tests never call SEC.

Without `DATABASE_URL`, Research › Alpha Radar shows the example filers (with example data on) or says no filer is tracked.

## Test Fixtures

Representative v1 fixtures live next to the code they verify:

- `src/lib/sec/fixtures/berkshire-2025q4-information-table.xml`
- `src/lib/sec/fixtures/berkshire-2025q4-parsed-holdings.json`
- `src/lib/alpha-radar/fixtures/berkshire-2025q4-diff-input.json`
- `src/lib/alpha-radar/fixtures/berkshire-2025q4-expected-changes.json`

Use these fixtures for deterministic parser and diff regression tests. Add new fixtures when adding parser support for new SEC XML shapes, amended filings, or materiality edge cases.

## Semantic Memory

Alpha Radar v2 stores searchable evidence in `alpha_radar_semantic_chunks`.

- Each parsed filing's holdings and its report's sections are chunked with source citations and stored by the refresh, replacing what was stored for that filing and report (launch item i62). Reads return the newest quarters first, at most 500 chunks.
- Embeddings are optional: `ALPHA_RADAR_EMBEDDING_MODEL` names an AI Gateway embedding model (`src/lib/alpha-radar/embeddings.ts`). With it, the refresh embeds each filing's chunks and the evidence search embeds its query, ranking keyword matches and the most similar chunks together (reciprocal rank fusion, `searchAlphaRadarMemoryChunks`). Without it, or when the gateway fails, chunks are stored without embeddings and the search is by keyword.
- Embeddings are stored as JSON with each chunk and compared in the app, so semantic memory needs no Postgres extension (the local and CI Postgres have no pgvector). The migration enables pgvector only where it is available.
- Every result should link back to a source filing, report section, or future thesis draft.
- Ask Ledger and the Research Alpha Radar tab both use the same semantic memory shape.

## Scheduled Runs

AR-131 keeps scheduling inside the TypeScript application boundary for now.

- `src/lib/alpha-radar/scheduler.ts` plans weekly, quarterly, and ad hoc refresh jobs.
- Idempotency keys include cadence, schedule ID, scope, window key, and scheduler contract version.
- Weekly jobs run once per ISO week after the configured UTC clock.
- Quarterly jobs use the latest available 13F quarter after the reporting-lag window, not raw quarter-end.
- The approved delivery path is in-app. Email, Slack, and Telegram preferences are captured, but remain dry-run/adapter-gated until provider destinations and cost controls are finalized in AR-133.
- Failure summaries should be one actionable in-app status per schedule window, not one alert per retry attempt.

## Operations And Cost Controls

AR-133 adds deterministic production guardrails before a hosted worker is introduced.

- `src/lib/alpha-radar/operations.ts` owns provider budget decisions, circuit breakers, health summaries, maintenance plans, and deployment requirement lists.
- Provider budgets are enforced in code with `enforceAlphaRadarProviderBudget`. A throttled or circuit-open provider fails closed before the adapter spends requests or tokens.
- Default local budgets are intentionally small: SEC EDGAR 40 requests/day, semantic embeddings 5/day, overlays 5/day, thesis generation 3/day, notification delivery 20/day.
- Preview and production budgets are higher but still bounded. Raise limits only with matching observability and provider cost review.
- Circuit breakers open after repeated provider failures and return a `nextRetryAt` value for operator-facing retry timing.
- Health summaries combine scheduled run history, refresh counts, provider latency, parse failures, memo failures, notification failures, and retry actions.

Deployment requirements:

| Target | Required | Notes |
|--------|----------|-------|
| Local | `DATABASE_URL` for persistence | `SEC_EDGAR_USER_AGENT` is only required for live SEC calls; pgvector can be absent because keyword fallback works. |
| Preview | `DATABASE_URL`, `SEC_EDGAR_USER_AGENT`, scheduler runtime | Provider keys should stay disabled unless preview budgets are configured. |
| Production | `DATABASE_URL`, pgvector, `SEC_EDGAR_USER_AGENT`, provider keys, scheduler runtime, notification destinations | External delivery requires dry-run validation before enabling. |

Maintenance tooling is planned as dry-run first:

- Reprocess filer/period: reload stored source filings and rerun parser, diff, semantic chunking, and memo generation.
- Delete parsed output: remove derived holdings, changes, semantic chunks, and memos while preserving source filing records. Write mode requires a confirmation token.
- Replay memo generation: regenerate deterministic memos from stored changes and citations without re-fetching SEC data.

## Backtesting

AR-132 backtests are exploratory signal-quality checks, not trading recommendations.

- `src/lib/alpha-radar/backtest.ts` runs from Alpha Radar signal records and caller-supplied price series.
- The engine waits for filing acceptance or the configured 13F lag before entering a forward-return window.
- Scenarios include top adds, exits, clone consensus, conviction-ranked ideas, and user-overlap ideas.
- Missing ticker/price/exit windows are skipped with explicit reasons.
- Non-split-adjusted price fixtures are allowed but produce warnings so QA can see methodology risk.
- UI summaries must keep the exploratory label visible whenever results appear in Research or Performance.

## Verification

Required v1 checks:

```bash
npm test
npm run build
npm run test:e2e -- tests/e2e/research.spec.ts
npm run test:e2e -- tests/e2e/dashboard.spec.ts
```

For AR-126 semantic memory changes, run:

```bash
node --import tsx --test src/lib/alpha-radar/memory.test.ts src/lib/ask/run.test.ts
```

For AR-131 scheduler changes, run:

```bash
node --import tsx --test src/lib/alpha-radar/scheduler.test.ts src/lib/stores/settingsStore.test.ts
npm run test:e2e -- tests/e2e/research.spec.ts tests/e2e/settings.spec.ts
```

For AR-132 backtest changes, run:

```bash
node --import tsx --test src/lib/alpha-radar/backtest.test.ts
npm run test:e2e -- tests/e2e/research.spec.ts
```

For AR-133 operations changes, run:

```bash
node --import tsx --test src/lib/alpha-radar/operations.test.ts
npm run test:e2e -- tests/e2e/research.spec.ts
```

`tests/e2e/settings.spec.ts` verifies the Alpha Radar alert preference and rule types. As of AR-124, the Settings spec passes against the built app, while `next dev` can hang before returning `/settings` in this workspace. If that persists, verify Settings against `next start` and track the dev-server hang separately from product behavior.

## Troubleshooting

- `DATABASE_URL not found`: expected for fixture-only unit tests; live persistence and refresh routes require a database.
- `SEC_EDGAR_USER_AGENT is not set` (or `SEC_NOT_CONFIGURED` from a refresh): set `SEC_EDGAR_USER_AGENT` to Atlas's name and a contact.
- SEC `429` or rate-limit response: retry later; do not run bulk refreshes from CI.
- No live reports in UI: confirm migrations ran, seed filers exist, and the refresh route can reach EDGAR.
- No semantic memory results: confirm `alpha_radar_semantic_chunks` has rows for the selected filer/period (filings parsed before launch item i62 have none until parsed again with force). If embeddings are unavailable, keyword fallback should still return report-section matches.
- A filing failed with "SEC lists no information table": neither its header index (`{accession}-index-headers.html`) nor its file list named the table. It is parsed again once SEC lists one; a refresh with force tries it at once.
- Duplicate alerts after refresh: check the stable Alpha Radar trigger ID shape, which includes rule, filer, period, filing, CUSIP, and change type.
- Duplicate scheduled runs: compare `alpha-radar` scheduler idempotency keys for the same schedule/window before queueing downstream work.
- Provider budget blocked: wait until `nextRetryAt` or the window reset before retrying. Do not bypass budgets in preview or production.
- Destructive maintenance blocked: rerun the plan in dry-run mode first, then use the generated confirmation token only after reviewing selected filer/period scope.
