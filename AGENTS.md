# AGENTS.md — Testing & Quality Guidelines

## Overview

Atlas Wealth uses two layers of automated testing:

| Layer | Tool | Directory | Command |
|-------|------|-----------|---------|
| **Unit tests** | Node.js built-in test runner + `tsx` | `src/**/*.test.ts`, `scripts/**/*.test.ts` | `npm test` |
| **E2E tests** | Playwright (Chromium) | `tests/e2e/*.spec.ts` | `npm run test:e2e` |

Both layers run in CI via `.github/workflows/docker-build.yml`. Unit tests run in the `lint-and-test` job; E2E tests run in a separate `e2e-tests` job that depends on the unit tests passing first.

---

## Running Tests Locally

### Unit tests

```bash
npm test
```

Unit tests use the Node.js built-in `node:test` runner with `tsx` for TypeScript support. No additional test framework (Jest, Vitest) is needed.

### E2E tests

```bash
# Install Playwright browsers (first time only)
npx playwright install chromium

# Run all E2E tests like CI: a fresh database in the Docker Postgres,
# database sessions, and the app connected as a member of app_runtime
npm run test:e2e:local
npm run test:e2e:local -- tests/e2e/holdings.spec.ts   # one spec

# Run without a database (local auth bypass, DB-backed pages show empty states)
npm run test:e2e

# Run with interactive UI
npm run test:e2e:ui
```

`test:e2e:local` (`scripts/e2e/run-local.sh`) recreates `atlas_wealth_e2e` in the Docker container, applies migrations and the fixtures in `scripts/e2e/fixtures.sql` through `scripts/e2e/prepare-database.ts` (the same script CI runs), then starts Playwright. It refuses to start if anything is listening on port 3000 or 3100.

Every checkout, git worktrees under `.claude/worktrees/` included, shares one container: `docker-compose.yml` pins the Compose project to `portfolio-manager` (container `atlas-wealth-db`, volume `portfolio-manager_atlas-wealth-db`). Runs from different checkouts take turns through a Postgres advisory lock (`scripts/e2e/run-lock.mjs`): a second run prints which checkout holds the lock and waits up to `E2E_LOCK_WAIT_SECONDS` (default 1800) before exiting 75. The lock is released when the holding run exits, however it exits. `test:e2e:local` starts the container if needed but never recreates it; `npm run db:up` applies changes to `docker-compose.yml`. The lock's own tests need a database: `E2E_LOCK_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth npm test` (CI's e2e job runs them).

Playwright starts two web servers: the main one on port 3000, and a "database down" one on port 3100 (its own build directory via `NEXT_DIST_DIR`, a `DATABASE_URL` nothing answers, local auth bypass) used only by `outage.spec.ts`.

The Playwright config (`playwright.config.ts`) starts its own servers (`npm run dev` on 3000, the database-down server on 3100) and never reuses a running one: if either port is busy, the run fails. Stop your dev server first.

**E2E never touches real services.** A server Playwright starts gets `DATABASE_URL=""` unless the shell exports one, and empty Upstash variables, so neither `.env.local`'s database nor the shared Redis is used.

### Local database

Local development uses the Postgres container in `docker-compose.yml`, never the Supabase project (that is production):

```bash
cp .env.example .env.local   # first time only
npm run db:up                # start Postgres on 127.0.0.1:54329
npm run db:setup             # migrate, create the app login and local dev user, seed examples
npm run dev
```

`DATABASE_URL` is the app's least-privilege login (a member of `app_runtime`, migration 0010); `DATABASE_MIGRATION_URL` is the table owner, used only by `db:migrate` and `db:setup`. `db:setup` refuses to run against anything but localhost. It also applies `scripts/db/init-local.sql` (the pgcrypto extension and the Supabase roles migrations expect); the container has no bind mounts, so its config is the same from every checkout and one checkout's `db:up` never restarts Postgres under another.

---

## Test Coverage Requirements

### When to write tests

**Every source code change must have corresponding test coverage.** Specifically:

1. **New utility functions or modules** (`src/lib/`) — add unit tests in a sibling `.test.ts` file.
2. **New or modified Zod schemas** (`src/lib/validators/`) — add unit tests covering valid input, each validation rule, and boundary values.
3. **New or modified Zustand store actions** (`src/lib/stores/`) — add unit tests exercising every action, including edge cases (empty lists, unknown IDs, reset).
4. **New pages or routes** — add an E2E spec file in `tests/e2e/` that verifies the page renders, key elements are visible, and primary interactions work.
5. **Modified component behaviour** — if a component's rendering logic changes (conditional rendering, calculations, formatting), update the E2E tests that cover that component's page.
6. **Bug fixes** — add a test that reproduces the bug before fixing it, so the fix can be verified and the regression is pinned.

### When to update existing tests

- If you change a Zod schema's validation rules (e.g. changing min length), update the corresponding test assertions.
- If you rename or restructure pages/routes, update the E2E test URLs and selectors.
- If you modify store defaults (e.g. default tags, default accounts), update the store test expectations.
- If you change a utility function's return format, update the unit test expected values.

**Tests are not optional.** PRs that change source code without updating corresponding tests should not be merged.

---

## E2E Test Coverage Map

Every page in the application must have a corresponding E2E spec. The current mapping:

| Route | E2E Spec File | Key assertions |
|-------|--------------|----------------|
| `/` (Today) | `dashboard.spec.ts` | Single "Today" header with greeting/market state, money-first hero (or connect-account empty state), ranked "Needs your attention", policy strip + disclosure, example section labelled and hideable, no fabricated deltas |
| `/portfolios/holdings` | `holdings.spec.ts` | Portfolio title + Holdings tab, one heading, table or single empty state, LEAPS ledger only with holdings and tagged Sample, sparklines never invented, Import CSV (preview, issues, exact payload, errors; API 400/cross-tenant 404/unchanged in DB mode), page gutter |
| `/portfolios/accounts` | `accounts.spec.ts` | Accounts tab, real accounts or empty state (never seeded balances) |
| `/portfolios/activity` | `activity.spec.ts` | Activity tab, real transactions or empty state, side filters |
| `/portfolios/detail/[symbol]` | `position-detail.spec.ts` | Symbol title, draft-order prefill link, thesis link, Add to watchlist toggle, not-held state is not a dead end |
| `/execution` (Trade) | `execution.spec.ts` | Single ticket (no variant switcher), Buy/Sell, sticky summary, blotter newest-first, `?symbol=` prefill, keyboard mode (B/S/M/L/T/Q, ⌘↵ respects gates), phone fit, rationale/cooldown/adherence flows |
| `/research` | `research.spec.ts` | One header, one-row tabs, delete in overflow menu, Sample-tagged recent seed theses, saved watchlist (add/refuse duplicates/edit/remove, survives reload), watchlist and journal detail panes, labelled illustrative price strip, Alpha Radar workflows |
| `/research/thesis/[ticker]` | `thesis.spec.ts` | Memo layout, explained thesis check (no opaque health score), links to position and draft order, not-found state |
| `/strategies` | `strategies.spec.ts` | "Strategies" title, compact switcher, Duplicate works, stale-backtest flag, legacy `/strategies/[id]` redirects |
| `/performance`, `/performance/attribution`, `/performance/behaviour` | `performance.spec.ts` | Returns: three cards, one heading, Sample notice, CSV export. Attribution: plain-language verdict, BHB bars, full table with sector/asset-class switch. Behaviour: one continuous trading calendar, mood, P&L density, reviews archive |
| `/ask` + ⌘K | `ask.spec.ts` | Command palette (top-bar search + ⌘K), page/ticker/question routing, Ask overlay and page history |
| `/settings` | `settings.spec.ts` | One column + section rail, legacy `?tab=` links scroll to sections, honest sign-in card, no seeded accounts, example-data toggle |
| `/help` (Settings › Help) | `help.spec.ts` | Getting started (5 steps), glossary, Alpha Radar notes, single h1 |
| `/login` | `login.spec.ts` | Google sign-in without app chrome, shared brand mark, no raw setup text |
| 404 | `not-found.spec.ts` | Search button opens the palette, link back to Today |
| Sidebar + IA | `navigation.spec.ts` | Exactly eight sidebar destinations (Help is a Settings tab), section tabs, legacy redirects, identity footer |
| Database outage | `outage.spec.ts` | Runs against the second web server (port 3100, database configured but unreachable): `/api/health/ready` is 503 `unavailable`; Today, Holdings and Accounts show the outage notice inside their page container, never an empty state |
| Cross-cutting | `smoke.spec.ts` | Fonts loaded, hydration clean in another timezone, no horizontal overflow at 390px |

### Adding E2E tests for a new page

1. Create `tests/e2e/<page-name>.spec.ts`.
2. Add a `test.describe` block with `test.beforeEach` that navigates to the route.
3. Write tests for:
   - **Page renders** — heading, description, and key structural elements are visible.
   - **Data display** — tables, cards, or lists show expected data.
   - **Interactions** — buttons, tabs, filters, and navigation links work correctly.
   - **Conditional rendering** — elements that appear/disappear based on state are tested in both states.
4. Update the table above in this file.

---

## Unit Test Patterns

### Validators (Zod schemas)

```typescript
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { mySchema } from './myValidator.ts';

describe('mySchema', () => {
    test('should accept valid input', () => {
        const result = mySchema.safeParse({ /* valid data */ });
        assert.strictEqual(result.success, true);
    });

    test('should reject invalid input with correct message', () => {
        const result = mySchema.safeParse({ /* invalid data */ });
        assert.strictEqual(result.success, false);
        if (!result.success) {
            assert.strictEqual(result.error.issues[0].message, 'Expected error message');
        }
    });
});
```

### Zustand stores

```typescript
import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert';

// Mock localStorage before importing the store (Zustand persist needs it)
const kvStore = new Map<string, string>();
// @ts-expect-error — intentional minimal mock
globalThis.localStorage = {
    getItem: (key: string) => kvStore.get(key) ?? null,
    setItem: (key: string, value: string) => { kvStore.set(key, value); },
    removeItem: (key: string) => { kvStore.delete(key); },
};

// NOTE: Use dynamic import inside a before() hook — not top-level await.
// tsx does not support top-level await in CJS output mode.
let useMyStore: any;

describe('myStore', () => {
    before(async () => {
        const mod = await import('./myStore.ts');
        useMyStore = mod.useMyStore;
    });

    beforeEach(() => {
        useMyStore.getState().reset();
    });

    test('action should update state correctly', () => {
        useMyStore.getState().someAction('value');
        assert.strictEqual(useMyStore.getState().someField, 'value');
    });
});
```

### Pure utility functions

```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import { myFunction } from './myUtil.ts';

test('myFunction - describes the scenario', () => {
    assert.strictEqual(myFunction(input), expectedOutput);
});
```

---

## CI Pipeline

The GitHub Actions workflow (`.github/workflows/docker-build.yml`) runs these jobs:

1. **`build`** — Builds the Docker image (never pushes).
2. **`lint-and-test`** — Audits production dependencies (`npm audit --omit=dev --audit-level=high`), lints (`npm run lint`), runs unit tests (`npm test`), and builds Next.js (`npm run build`).
3. **`e2e-tests`** — Installs Playwright browsers, prepares a Postgres service with `scripts/e2e/prepare-database.ts`, runs the local run lock's tests against it, starts the dev server connected as a member of `app_runtime`, and runs all E2E tests. Only runs after `lint-and-test` passes. Uploads the Playwright HTML report as a build artifact.
4. **`publish-image`** — On `master` only, after the three checks pass: pushes the image to GHCR.
5. **`deploy-production`** — On `master` only, after the three checks pass: applies migrations, deploys to Vercel, and checks `/api/health/ready`. See `docs/deployment.md`, including the rule that migrations must work with the code already running.

`.github/workflows/codeql.yml` runs CodeQL on pull requests, on `master`, and weekly. `.github/dependabot.yml` opens weekly grouped updates for npm and GitHub Actions.

### Ensuring CI passes

Before pushing:

```bash
npm run lint && npm test && npm run build
```

For E2E locally:

```bash
npm run test:e2e
```

---

## File Naming Conventions

- Unit tests: `<module>.test.ts` next to the source file (e.g. `charts.ts` → `charts.test.ts`).
- E2E tests: `tests/e2e/<feature>.spec.ts` (e.g. `portfolios.spec.ts`).
- Do not put unit tests in the `tests/` directory — that is reserved for E2E specs.
- Do not put E2E specs in the `src/` directory.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
