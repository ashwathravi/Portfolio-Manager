# Test Coverage Analysis

_Last reviewed 2026-10-30, after launch item i72._ How the rules for writing tests work, and what each spec covers, is in `AGENTS.md`; this page is the overall picture and the gaps that are left.

## Current state

| Layer | Size | Runs |
|---|---|---|
| Unit (`node:test` + `tsx`) | 215 files, 2,232 tests in `src/` and `scripts/`, plus the database tests in `scripts/db` that need `SCRIPTS_TEST_DATABASE_URL` | `lint-and-test` on every pull request; the database tests in `e2e-tests` |
| E2E (Playwright, Chromium) | 29 specs, 453 tests; 463 with database sessions, which add the `production-smoke` project | `e2e-tests` on every pull request: a production build on a fresh Postgres, connected as a member of `app_runtime`, plus two outage servers |
| Post-deploy smoke | 10 checks in `tests/production` | `deploy-production`, against the live site after every deploy |

Every route has an E2E spec (`AGENTS.md` › E2E Test Coverage Map). The unit tests cover most of the domain logic in `src/lib`:

- validators;
- the risk policy;
- returns and attribution;
- portfolio import and splits;
- the price ingest and the securities master;
- the Plaid sync;
- Alpha Radar and SEC parsing;
- sign-in rules, rate limits, the proxy and the Content-Security-Policy;
- the job runner and job health;
- the API routes' input checks.

The database tests run the parts that depend on real Postgres behaviour against a real database:

- the local database setup and migration 0019;
- the Plaid sync;
- deleting and exporting an account;
- order plans;
- the backup and its restore;
- job health across time zones.

Tests never call a real service. Massive, SEC EDGAR, Plaid and Google are faked: in unit tests through injected clients, in E2E by stubbing the app's own routes, and with no provider keys at all.

## Gaps

1. **No coverage measurement.** Nothing reports which lines the tests miss, so "every change has a test" is enforced only in review. Node's `--experimental-test-coverage` (or `c8`) on `npm test` would show it, and a CI summary would keep it visible without a threshold that blocks merges.
2. **No component tests.** React components are tested only through E2E. Logic inside components (formatting, conditional rendering, form state) gets a full browser run each time, and a regression shows up as an E2E failure that is slower to pin down. Moving that logic into `src/lib` functions, as most of the app already does, keeps it unit-testable without adding a component test framework.
3. **Real provider responses aren't tested.** Tests use recorded or hand-written shapes. If Massive, SEC EDGAR or Plaid changes a response, production finds out first: the nightly job fails, `job_runs` records the error, and the production monitor opens an issue. A small scheduled contract check against each provider's sandbox or free tier would catch it before users see stale data.
4. **Signed-in production isn't smoke-tested.** The post-deploy suite runs signed out (`docs/deployment.md` › Post-deploy smoke test). Pages behind sign-in are covered by E2E only, so a production-only failure there (a missing grant, a variable set only in Vercel) shows up as Sentry errors rather than a failed deploy. Closing it needs a standing production account whose session token is a CI secret.
5. **No automated accessibility scan.** `dashboard-a11y.spec.ts` and the specs' role-based locators check structure on purpose, but nothing scans pages for contrast, labels or focus order. An axe pass on each main page in E2E would cover what WCAG 2.1 AA asks for (`docs/CLAUDE.md` › Accessibility).
6. **No visual regression tests.** Layout is checked with assertions (no horizontal overflow at 390px, one heading, gutters), not screenshots. A design change that breaks a layout without breaking an assertion goes unnoticed.
7. **Strategies run on example data.** Their tests cover the builder's behaviour, not a backtest engine, because there isn't one yet (launch item i55).
