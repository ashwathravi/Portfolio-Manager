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

`test:e2e:local` (`scripts/e2e/run-local.sh`) recreates `atlas_wealth_e2e` in the Docker container, applies migrations and the fixtures in `scripts/e2e/fixtures.sql` through `scripts/e2e/prepare-database.ts` (the same script CI runs), then starts Playwright. It refuses to start if anything is listening on port 3000, 3100 or 3200.

Every checkout, git worktrees under `.claude/worktrees/` included, shares one container: `docker-compose.yml` pins the Compose project to `portfolio-manager` (container `atlas-wealth-db`, volume `portfolio-manager_atlas-wealth-db`). A checkout in a directory not named `Portfolio-Manager` may still have `atlas-wealth-db` under its old, directory-named project; `npm run db:up` and `test:e2e:local` then stop and print the commands that move it over, keeping its data (`scripts/db/check-container-project.sh`). Runs from different checkouts take turns through a Postgres advisory lock (`scripts/e2e/run-lock.mjs`): a second run prints which checkout holds the lock and waits up to `E2E_LOCK_WAIT_SECONDS` (default 1800) before exiting 75. The lock lasts exactly as long as the run: the wrapper and a helper process each hold part of it until every process the run started has exited, so if either is killed (even with SIGKILL) the other stops the run and keeps the next one waiting until it has. `test:e2e:local` starts the container if needed but never recreates it; `npm run db:up` applies changes to `docker-compose.yml`. The lock's tests, the `db:migrate` test, and the database tests in `scripts/db` (migration 0019; the Plaid sync into portfolios, connections and webhooks; deleting and exporting an account) need a database: `SCRIPTS_TEST_DATABASE_URL=postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth npm test` (CI's e2e job runs them).

Playwright starts three web servers: the main one on port 3000; a "database down" one on port 3100 (a `DATABASE_URL` nothing answers); and an "unusable database URL" one on port 3200 (`DATABASE_URL="[SENSITIVE]"`, Vercel's placeholder, with `PGHOST`/`PGPORT` on a closed port so postgres.js's `localhost:5432` fallback reaches no database, CI's Postgres service included). The last two have their own build directories via `NEXT_DIST_DIR`, use local auth bypass, and serve only `outage.spec.ts`. Every run deletes those two directories before starting their servers: Playwright SIGKILLs its servers at the end of a run, so `next dev` never saves its Turbopack cache while the chunks it wrote stay on disk, and a run that started from that leftover state hot-reloaded the outage pages as they loaded.

With database sessions (CI and `test:e2e:local`) the main server is a **production build**, as Vercel serves it: `next build` into `.next/e2e-production`, then `next start`, with the fixture users as the invite list. That adds a few minutes before the first test; `E2E_DEV_SERVER=1` runs `next dev` instead while debugging. Without a database (`npm run test:e2e`) every server is `next dev`, because the local auth bypass is refused in production, and so are the two outage servers.

The Playwright config (`playwright.config.ts`) starts its own servers (on 3000, 3100 and 3200) and never reuses a running one: if any of those ports is busy, the run fails. Stop your dev server first.

**Tests that change settings, the watchlist, the journal or theses sign in as a fresh user.** These are stored per user on the server (`user_settings`, `watchlist_items`, `journal_entries`, `theses`), so a test that changes them as fixture user A would change them for every test after it. Call `signInAsFreshUser(context)` from `tests/e2e/helpers/users.ts` first: it creates a copy of user A (same portfolios, holdings and transactions) with settings of its own. Without database sessions it does nothing, since each test's browser storage is already its own.

**E2E never touches real services.** A server Playwright starts gets `DATABASE_URL=""` unless the shell exports one, empty Upstash variables, an empty `POLYGON_API_KEY` and no Sentry DSN, so neither `.env.local`'s database, the shared Redis, the market-data provider nor Sentry is used. Without a usable `DATABASE_URL` (missing, or Vercel's `"[SENSITIVE]"` placeholder) the app connects to no database at all, not even `PGHOST` or `localhost:5432`: every query rejects at once with `DatabaseNotConfiguredError` (`src/db/unconfigured-client.ts`), and pages show their empty states.

### Local database

Local development uses the Postgres container in `docker-compose.yml`, never the Supabase project (that is production):

```bash
cp .env.example .env.local   # first time only
npm run db:up                # start Postgres on 127.0.0.1:54329
npm run db:setup             # migrate, create the app login and local dev user, seed examples
npm run dev
```

`DATABASE_URL` is the app's least-privilege login (a member of `app_runtime`, migration 0010); `DATABASE_MIGRATION_URL` is the table owner, used only by `db:migrate` and `db:setup`. `db:setup` refuses to run against anything but localhost. It, and `db:migrate` when its URL is local, apply `scripts/db/init-local.sql` first (the pgcrypto extension and the Supabase roles migrations expect); the container has no bind mounts, so its config is the same from every checkout and one checkout's `db:up` never restarts Postgres under another.

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
| `/` (Today) | `dashboard.spec.ts` | Single "Today" header with greeting/market state, money-first hero (or, before any positions, the first-run steps: add an account, then import positions; DB mode: a new user goes from no accounts to an account to a net worth, the import goes into the account just made, a first sign-in starts with example data off and the card turns it on, the page arrives with the stored setting so examples never flash in or out while it loads, a user with settings keeps them), ranked "Needs your attention" from the policy the user saved (launch item i52), policy strip + disclosure, no employer stock assumed until the user names it, a real equity curve from nightly valuations outside the example section (none for a new user), example section labelled and hideable, no fabricated deltas, a position with no price yet counts at cost in net worth |
| `/portfolios/holdings` | `holdings.spec.ts` | Portfolio title + Holdings tab, one heading, table or single empty state, sector chips are the sectors held (DB mode: from the securities master's reference data, which outranks the ticker map, with reference names), LEAPS ledger only with holdings and tagged Sample, sparklines never invented, Import CSV (preview, issues, exact payload, errors; API 400/cross-tenant 404/unchanged in DB mode; a position with no price yet is valued at cost, not $0), Today P&L counts only today's session, page gutter; a bucket chosen in Settings is the one Holdings files the position under (`settings.spec.ts`) |
| `/portfolios/accounts` | `accounts.spec.ts` | Accounts tab, real accounts or empty state (never seeded balances). With a database: add an account with cash (survives reload), rename and change cash, form errors explained, delete after a confirm that names what goes with it, a name already in use (any case) refused by the form, a rename and an import's new account (keeping its own name is fine), and the API changes only your own accounts (another user's is a 404, signed-out a 401) |
| `/portfolios/activity` | `activity.spec.ts` | Activity tab, real transactions or empty state, side filters, adding needs an account first. With a database: a buy entered by hand (value and fees, survives reload), a deposit by amount, form errors explained, a broker CSV imported once (importing it again adds nothing), unreadable rows listed with nothing imported, a trade in another currency shown in it and totalled apart from dollars, delete after asking, and the API writes only to your own accounts (404 otherwise, 401 signed out, the bad row named) |
| `/portfolios/detail/[symbol]` | `position-detail.spec.ts` | Symbol title, draft-order prefill link, thesis link, Add to watchlist toggle, not-held state is not a dead end |
| `/execution` (Trade) | `execution.spec.ts` | Single ticket (no variant switcher), Buy/Sell, sticky summary, blotter newest-first, `?symbol=` prefill, keyboard mode (B/S/M/L/T/Q, ⌘↵ respects gates), phone fit, rationale/cooldown/adherence flows; DB mode (launch item i54): the risk-policy checks run on the user's holdings, and a thesis the user writes satisfies a no-add rule |
| `/research` | `research.spec.ts` | One header, one-row tabs, delete in overflow menu, Sample-tagged recent seed theses, saved watchlist (add/refuse duplicates/edit/remove, survives reload), journal entries (add/edit/delete, survive reload, form limits), theses (create, archive, delete, catalyst on the thesis page, survive reload, form limits), watchlist and journal detail panes, labelled illustrative price strip, Alpha Radar workflows |
| `/research/thesis/[ticker]` | `thesis.spec.ts` | Memo layout, explained thesis check (no opaque health score), links to position and draft order, not-found state |
| `/strategies` | `strategies.spec.ts` | "Strategies" title, compact switcher, Duplicate works, stale-backtest flag, legacy `/strategies/[id]` redirects |
| `/performance`, `/performance/attribution`, `/performance/behaviour` | `performance.spec.ts` | Returns before any history (a fresh user): three cards, one heading, Sample notice, CSV export (same months as the charts after a month rollover). Returns from history (DB mode, fixture valuations): all accounts' time-weighted return vs the S&P 500, only benchmarks with every close, ranges and periods longer than the history disabled or dashed, risk figures hidden over too few returns, heatmap months, `?account=` switcher, a transfer between own accounts isn't a return, an account without history says so, daily CSV export, another user sees none of it. Attribution before any history (a fresh user): plain-language verdict, BHB bars, full table with sector/asset-class switch. Attribution from history (DB mode, fixture valuations and sector ETF closes): all accounts against the S&P 500 by sector (the same return as Returns, beating it by 6.3 pp), only held or benchmark segments, periods longer than the history disabled, asset class compares stocks with the index, `?account=` and an account without history, another user sees none of it. Behaviour: one continuous trading calendar, mood, P&L density, reviews archive |
| `/ask` + ⌘K | `ask.spec.ts` | Command palette (top-bar search + ⌘K), page/ticker/question routing, Ask overlay and page history |
| `/settings` | `settings.spec.ts` | One column + section rail, legacy `?tab=` links scroll to sections, honest sign-in card, no seeded accounts, example-data toggle, Plaid Link connects the picked accounts and syncs only those (`POST /api/plaid/sync` with their IDs, the result in a toast), connections listed from the server (`GET /api/plaid/connections`: each account's pick and the account it syncs into, balances-only accounts not synced), "Sync now" syncs the connection and shows why when it can't, a connection needing a sign-in reconnects through Link update mode (`link-token` with its `itemId`) then syncs, accounts waiting for a pick are picked on the card, Disconnect asks first and removes the connection; Data (DB mode): everything downloads as JSON (the account's data, nothing internal) and transactions as CSV, Delete account needs DELETE typed then signs out with the account's rows and this browser's copies gone; risk policy previews on the user's own portfolio, never example data (launch item i54): each holding in the bucket its type suggests until one is chosen, a chosen bucket survives reload and Today's checks follow it, employer stock none until named and the plan for the tickers named surfaces on Today, sell rules triggered on real holdings |
| `/help` (Settings › Help) | `help.spec.ts` | Getting started (5 steps), glossary, Alpha Radar notes, single h1 |
| `/privacy` | `privacy.spec.ts` | Public without app chrome, every section, the watchlist, journal and theses listed as saved with the account (and what stays when one is removed), which linked accounts are synced, how often and how to stop one (or disconnect it in Settings), downloading and deleting your data in Settings straight away, every service that receives data (Sentry included), Plaid policy link, off-site callbacks dropped |
| `/login` | `login.spec.ts` | Google sign-in without app chrome, shared brand mark, no raw setup text, link to the privacy policy that keeps the sign-in callback; after Delete account (`?deleted=1`, covered in `settings.spec.ts`) a notice that the account and its data were deleted |
| `/privacy` | `privacy.spec.ts` | Public when signed out, no app chrome, single h1, all policy sections, Plaid end user policy and contact links, scrolls to the end, off-site callbacks dropped, no overflow at 390px |
| 404 | `not-found.spec.ts` | Search button opens the palette, link back to Today |
| Sidebar + IA | `navigation.spec.ts` | Exactly eight sidebar destinations (Help is a Settings tab), section tabs, legacy redirects, identity footer |
| Database outage | `outage.spec.ts` | Port 3100 (database configured but unreachable): `/api/health/ready` is 503 `unavailable`; Today, Holdings, Accounts and Performance › Returns show the outage notice inside their page container, never an empty state, and Holdings still shows it promptly after many failed reads (the pool's reconnect backoff is capped at a second). Port 3200 (`DATABASE_URL="[SENSITIVE]"`): readiness is 503 `not_configured`; the same pages show their empty states (Returns: the labelled example series) and no outage notice |
| Content Security Policy | `content-security-policy.spec.ts` | Every main page gets a nonce-based policy (`'strict-dynamic'`, no `'unsafe-inline'` for scripts), its scripts carry the nonce, no violations after load, a new nonce per response, injected markup (inline handler, `srcdoc` script) can't run |
| Settings sync | `settings-sync.spec.ts` | A change is saved to the server and follows the user to another browser, an edit made just before a reload isn't lost, a browser's existing settings become the user's the first time, one account's settings don't reach another, `PUT /api/settings` refuses unknown slices (API keys), future versions, a field the app could never write (400 naming it) and signed-out callers |
| Theses in the account | `thesis-sync.spec.ts` | With a database (launch item i38): a thesis with its catalysts and evidence follows the user to another browser, a browser's earlier theses (edited and deleted examples included) move to the account once and leave the browser, one account's theses don't reach another, the API refuses mismatched ids, non-http(s) evidence links, unknown fields, writes without an order and oversized imports, ignores a page's older write (a deletion included), and refuses signed-out callers |
| Journal in the account | `journal-sync.spec.ts` | With a database (launch item i38): an added entry follows the user to another browser, a browser's earlier journal (edited and deleted examples included) moves to the account once and leaves the browser, one account's journal doesn't reach another, a page's older write that lands late is ignored, and so is a save that lands after a deletion, the API refuses mismatched ids, unknown types and fields, writes without an order, oversized imports and signed-out callers |
| Watchlist in the account | `watchlist-sync.spec.ts` | With a database (launch item i38): an added ticker follows the user to another browser and to Today, a browser's earlier list (edited and removed examples included) moves to the account once and leaves the browser, one account's list doesn't reach another, a page's older write that lands late doesn't undo its newer one (nor a removal that landed first), changes wait until the list has loaded, why and notes stop at what the account keeps, the API refuses duplicate tickers, mismatched ids, unknown fields, writes without an order, oversized imports and signed-out callers. Specs that change the watchlist, journal or theses sign in with `signInAsFreshUser` and wait for the page to load them (`researchLoaded` in `tests/e2e/helpers/research.ts`) |
| Browser data per user | `browser-data-isolation.spec.ts` | `<html data-storage-scope>` is the signed-in user, another account on the same browser doesn't see your Ask history (yours stays under your key), history saved under the old shared key goes to the first account that opens it, signing out removes the Ask transcript. Specs that read or clear storage use `userKey()` from `tests/e2e/helpers/storage.ts` |
| Cross-cutting | `smoke.spec.ts` | Fonts loaded and self-hosted (Latin files preloaded from `/_next/static/media`, Plex Mono and the Greek subset available, nothing fetched from Google), hydration clean in another timezone and with the browser on the next UTC day, no horizontal overflow at 390px, market-data routes answer 503 `MARKET_DATA_NOT_CONFIGURED` without a provider key, quotes answer from the price store (the fixture SPY close; 404 `QUOTE_UNAVAILABLE` for an unpriced symbol), valuation lists unpriced holdings, `/api/cron/daily` reaches the route without a session and refuses with 503 `CRON_NOT_CONFIGURED` without `CRON_SECRET` |

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
3. **`e2e-tests`** — Installs Playwright browsers, prepares a Postgres service with `scripts/e2e/prepare-database.ts`, runs the tests of the scripts that need a database against it, builds and starts the app in production mode connected as a member of `app_runtime`, and runs all E2E tests. Only runs after `lint-and-test` passes. Uploads the Playwright HTML report as a build artifact.
4. **`publish-image`** — On `master` only, after the three checks pass: pushes the image to GHCR.
5. **`deploy-production`** — On `master` only, after the three checks pass: applies migrations, has Vercel build and deploy the commit (Sensitive variables such as the Sentry DSN only exist in Vercel's own builds), and checks `/api/health/ready`. See `docs/deployment.md`, including the rule that migrations must work with the code already running.

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

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
