# Linear Release Risk Follow-Ups

These are the remaining release-risk Linear issues that need to be created under project `Portfolio-Manager` once Linear write mutations are available.

## 1. Release risk: Add auth, tenancy, and rate limits to provider-backed API routes

Priority: High
State: Backlog
Label: Improvement

Decision / Update:
- Context: Release review found local-first provider routes callable without auth/session boundaries: Plaid link/exchange and Alpha Radar mutation/refresh routes.
- Decision: Track as release-risk follow-up before network-visible deployment.
- Rationale: Local sandbox use is acceptable, but shared deployment needs user scoping, authorization, abuse protection, and provider-call limits.
- Impacted tasks: AR-149 Plaid Link flow, Alpha Radar v1/v2 API routes, future provider sync endpoints.
- Acceptance criteria:
  - Plaid routes require authenticated user/session context.
  - Plaid item/account records are user-scoped; hardcoded local user assumptions are removed.
  - Alpha Radar mutation/refresh routes require authorization.
  - Provider-triggering routes have rate limits and structured server logs.
  - Client errors are generic; sensitive provider/internal messages are not leaked.
  - Tests cover unauthenticated, unauthorized, rate-limited, and authorized success paths.
- Risks / blockers: No first-class app auth layer exists yet.
- Verification needed: API route tests, focused Settings/Plaid and Alpha Radar smoke tests, security review.
- Evidence once complete: Test output, route auth notes, and changed UI screenshots if any.

## 2. Release risk: Finish production Plaid token lifecycle and reconnect state

Priority: High
State: Backlog
Label: Improvement

Decision / Update:
- Context: The current implementation now supports encrypted local token persistence when `PLAID_TOKEN_ENCRYPTION_KEY` or `INTERNAL_API_SECRET` is configured, but production still needs a user-scoped token lifecycle and reconnect semantics.
- Decision: Treat the encrypted local vault as a local-development bridge, not the final production design.
- Rationale: Plaid access tokens are financial credentials. They need encryption, tenancy, rotation/revocation behavior, auditability, and clear UI state when sync is unavailable.
- Impacted tasks: AR-149 Plaid integration, connected accounts settings, future account sync jobs.
- Acceptance criteria:
  - Token storage is durable, encrypted, user-scoped, and not tied to process memory.
  - Token records support revocation, reconnect, provider item status, and last successful sync timestamps.
  - UI distinguishes connected metadata from sync-ready provider credentials.
  - Server restart/cold start does not falsely show accounts as sync-ready if the token cannot be loaded.
  - Tests cover encrypted storage, missing key fallback, restart/reload behavior, reconnect, and no token leakage to localStorage/client JSON.
- Risks / blockers: Requires auth/user model decision and durable persistence target.
- Verification needed: Unit tests, API route tests, local restart smoke, security review.
- Evidence once complete: Test output and provider-token threat-model notes.

## 3. Release risk: Harden Alpha Radar ingestion inputs and SEC 13F attachment discovery

Priority: Medium
State: Backlog
Label: Improvement

Decision / Update:
- Context: Review found weak bounds on Alpha Radar refresh/list/search inputs and a medium-confidence risk that SEC 13F information-table discovery can miss filings where the table is an attachment instead of the primary document.
- Decision: Track as Alpha Radar production-readiness work.
- Rationale: Provider ingestion routes must be bounded to avoid expensive external calls, parser overload, and missed 13F data.
- Impacted tasks: Alpha Radar v1/v2 API routes, SEC EDGAR client, refresh service, semantic memory search.
- Acceptance criteria:
  - All public query/body inputs use schema validation and explicit min/max clamps.
  - SEC fetch and XML parse paths have timeout and size limits.
  - 13F information-table discovery checks filing attachments, not only the primary document.
  - Representative live/fixture SEC filings cover primary-document and attachment-based information tables.
  - Refresh reports surface skipped or unsupported filings with actionable reasons.
- Risks / blockers: Live SEC smoke tests need network access and a compliant `SEC_EDGAR_USER_AGENT`.
- Verification needed: Unit tests with attachment fixtures, integration smoke against representative filers, Alpha Radar E2E smoke.
- Evidence once complete: Test output, fixture links/accessions, and refresh logs.

## 4. Release risk: Repair Drizzle migration metadata and release hygiene artifacts

Priority: Medium
State: Backlog
Label: Bug

Decision / Update:
- Context: Review found `drizzle/meta/_journal.json` references `0004_alpha_radar_semantic_memory`, but `drizzle/meta/0004_snapshot.json` is missing. The workspace also contains release hygiene artifacts such as generated Playwright/test-result files and an untracked `0`.
- Decision: Track migration metadata and workspace hygiene as release-readiness work.
- Rationale: Missing Drizzle snapshots can cause future migration generation to diff from the wrong schema state. Generated artifacts should not land unintentionally.
- Impacted tasks: Alpha Radar migrations, CI/build hygiene, release preparation.
- Acceptance criteria:
  - `0004_snapshot.json` is generated or the migration journal is corrected through the standard Drizzle workflow.
  - Migration apply/rollback or clean-database apply is verified.
  - Generated reports/results are either ignored or intentionally tracked with rationale.
  - Untracked scratch files are removed or documented.
- Risks / blockers: Requires deciding whether existing migration files are canonical.
- Verification needed: Drizzle migration check on a clean database and `git status` release hygiene review.
- Evidence once complete: Migration command output and final clean/expected status notes.

## 5. Release risk: Resolve repo-wide lint debt and restore CI green path

Priority: High
State: Backlog
Label: Bug

Decision / Update:
- Context: `npm run lint` currently fails with repo-wide issues outside the latest closeout slice: React Compiler purity/setState-in-effect findings, legacy `any` usage, no-unescaped-entities, conditional hook usage, and older warnings.
- Decision: Track as a release gate before considering CI green.
- Rationale: CI runs lint before build/E2E. A passing unit suite and webpack build are not sufficient if lint blocks merge/release.
- Impacted tasks: CI, dashboard, execution, settings, research, strategy builder, tests.
- Acceptance criteria:
  - `npm run lint` exits 0.
  - React Compiler purity/setState-in-effect findings are fixed without masking real issues.
  - Legacy `any` usage is replaced or locally justified.
  - Conditional hook and no-unescaped-entities violations are fixed.
  - CI lint/test/build job passes.
- Risks / blockers: Some lint rules may require small behavior-preserving component refactors.
- Verification needed: `npm run lint`, `npm test`, `npx next build --webpack`, CI run.
- Evidence once complete: Command output and CI link.

## 6. Release risk: Tighten CSP and CI supply-chain hardening

Priority: Medium
State: Backlog
Label: Improvement

Decision / Update:
- Context: Security review found CSP allows inline/eval script behavior and CI actions are tag-pinned rather than SHA-pinned. Plaid Link is loaded from Plaid CDN and should be explicitly represented in the policy.
- Decision: Track this as production hardening.
- Rationale: The app handles financial data and provider credentials. Browser and CI trust boundaries should be tightened before public deployment.
- Impacted tasks: `next.config.ts`, Plaid Link loading, GitHub Actions workflow.
- Acceptance criteria:
  - CSP removes unnecessary `unsafe-eval` and `unsafe-inline`, or documents narrowly scoped exceptions.
  - Plaid script/frame/connect directives are explicit.
  - CI actions are pinned to commit SHAs where practical.
  - Workflow permissions are least-privilege by job.
  - Browser smoke verifies Plaid Link still loads under the tightened CSP.
- Risks / blockers: Some Next/dev tooling may need separate development and production CSPs.
- Verification needed: Browser smoke, focused Plaid Link test, CI dry run/security review.
- Evidence once complete: CSP diff, CI workflow diff, and smoke-test output.
