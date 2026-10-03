# AGENTS.md — Testing & Quality Guidelines

## Overview

Atlas Wealth uses two layers of automated testing:

| Layer | Tool | Directory | Command |
|-------|------|-----------|---------|
| **Unit tests** | Node.js built-in test runner + `tsx` | `src/**/*.test.ts` | `npm test` |
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

# Run all E2E tests (auto-starts dev server)
npm run test:e2e

# Run with interactive UI
npm run test:e2e:ui
```

The Playwright config (`playwright.config.ts`) includes a `webServer` block that automatically starts `npm run dev` before running tests. If the dev server is already running on port 3000, it reuses the existing server.

**Never run E2E against a dev server connected to a real database.** A server Playwright starts gets `DATABASE_URL=""` unless the shell exports one, so `.env.local` is ignored. A server you started yourself with `.env.local` pointing at Supabase is *reused as-is*, and tests would act on real data. Stop it before `npm run test:e2e`.

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
| `/portfolios/holdings` | `holdings.spec.ts` | Portfolio title + Holdings tab, one heading, table or single empty state, LEAPS ledger only with holdings and tagged Sample, page gutter |
| `/portfolios/accounts` | `accounts.spec.ts` | Accounts tab, real accounts or empty state (never seeded balances) |
| `/portfolios/activity` | `activity.spec.ts` | Activity tab, real transactions or empty state, side filters |
| `/portfolios/detail/[symbol]` | `position-detail.spec.ts` | Symbol title, draft-order prefill link, thesis link, not-held state is not a dead end |
| `/execution` (Trade) | `execution.spec.ts` | Single ticket (no variant switcher), Buy/Sell, sticky summary, blotter newest-first, `?symbol=` prefill, keyboard mode (B/S/M/L/T/Q, ⌘↵ respects gates), phone fit, rationale/cooldown/adherence flows |
| `/research` | `research.spec.ts` | One header, one-row tabs, delete in overflow menu, Sample-tagged recent seed theses, Alpha Radar workflows |
| `/research/thesis/[ticker]` | `thesis.spec.ts` | Memo layout, explained thesis check (no opaque health score), links to position and draft order, not-found state |
| `/strategies` | `strategies.spec.ts` | "Strategies" title, compact switcher, Duplicate works, stale-backtest flag, legacy `/strategies/[id]` redirects |
| `/performance`, `/performance/behaviour` | `performance.spec.ts` | Returns: four cards, one heading, Sample notice, CSV export. Behaviour: one continuous trading calendar, mood, P&L density, reviews archive |
| `/ask` + ⌘K | `ask.spec.ts` | Command palette (top-bar search + ⌘K), page/ticker/question routing, Ask overlay and page history |
| `/settings` | `settings.spec.ts` | One column + section rail, legacy `?tab=` links scroll to sections, honest sign-in card, no seeded accounts, example-data toggle |
| `/help` | `help.spec.ts` | Getting started (5 steps), glossary, Alpha Radar notes, single h1 |
| `/login` | `login.spec.ts` | Google sign-in without app chrome, shared brand mark, no raw setup text |
| 404 | `not-found.spec.ts` | Search button opens the palette, link back to Today |
| Sidebar + IA | `navigation.spec.ts` | Eight destinations, section tabs, legacy redirects, identity footer |
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

The GitHub Actions workflow (`.github/workflows/docker-build.yml`) runs three jobs:

1. **`build`** — Docker image build and push (only pushes on `main`).
2. **`lint-and-test`** — Linting (`npm run lint`), unit tests (`npm test`), and Next.js build (`npm run build`).
3. **`e2e-tests`** — Installs Playwright browsers, starts the dev server, and runs all E2E tests. Only runs after `lint-and-test` passes. Uploads the Playwright HTML report as a build artifact.

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
