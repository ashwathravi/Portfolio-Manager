# Alpha Radar Operating Guide

Alpha Radar is the Portfolio Manager 13F research workflow. It tracks selected institutional filers, ingests recent SEC EDGAR 13F metadata, parses information-table XML, computes quarter-over-quarter holding changes, generates deterministic research memos, and surfaces the results in Research, Dashboard, and alert notifications.

## Data Sources

- CI and unit tests use local fixtures only. They must not call live EDGAR.
- Local development can use seeded Alpha Radar data without a database. The Research tab and Dashboard card show seeded fallback data when live storage or SEC access is unavailable.
- Live refreshes require Postgres-backed Alpha Radar tables and SEC network access.

## SEC Fair Use

SEC EDGAR requires a descriptive user agent. Set `SEC_EDGAR_USER_AGENT` before live refreshes:

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

4. Configure `DATABASE_URL` and, for live SEC refreshes, `SEC_EDGAR_USER_AGENT`.

Without `DATABASE_URL`, Alpha Radar UI surfaces should still render seeded fallback data.

## Test Fixtures

Representative v1 fixtures live next to the code they verify:

- `src/lib/sec/fixtures/berkshire-2025q4-information-table.xml`
- `src/lib/sec/fixtures/berkshire-2025q4-parsed-holdings.json`
- `src/lib/alpha-radar/fixtures/berkshire-2025q4-diff-input.json`
- `src/lib/alpha-radar/fixtures/berkshire-2025q4-expected-changes.json`

Use these fixtures for deterministic parser and diff regression tests. Add new fixtures when adding parser support for new SEC XML shapes, amended filings, or materiality edge cases.

## Semantic Memory

Alpha Radar v2 stores searchable evidence in `alpha_radar_semantic_chunks`.

- Filing text and memo sections are chunked with source citations before search.
- Embeddings are optional. Disabled/no-key environments use keyword fallback instead of failing the workflow.
- The migration enables pgvector only when the extension is available, but semantic memory does not require pgvector to run locally.
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
- `SEC EDGAR user-agent cannot be empty`: set `SEC_EDGAR_USER_AGENT` before live refresh.
- SEC `429` or rate-limit response: retry later; do not run bulk refreshes from CI.
- No live reports in UI: confirm migrations ran, seed filers exist, and the refresh route can reach EDGAR.
- No semantic memory results: confirm `alpha_radar_semantic_chunks` has rows for the selected filer/period. If embeddings are unavailable, keyword fallback should still return report-section matches.
- Duplicate alerts after refresh: check the stable Alpha Radar trigger ID shape, which includes rule, filer, period, filing, CUSIP, and change type.
- Duplicate scheduled runs: compare `alpha-radar` scheduler idempotency keys for the same schedule/window before queueing downstream work.
- Provider budget blocked: wait until `nextRetryAt` or the window reset before retrying. Do not bypass budgets in preview or production.
- Destructive maintenance blocked: rerun the plan in dry-run mode first, then use the generated confirmation token only after reviewing selected filer/period scope.
