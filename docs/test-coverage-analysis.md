# Test Coverage Analysis

## Current State

The codebase has **3 test files** across **~85 source files**, covering a very narrow slice of the application.

| File | What it tests |
|---|---|
| `src/lib/charts.test.ts` | `calculateSparklinePoints` (5 cases) |
| `src/lib/validators/settings.test.ts` | `tagSchema` only (7 cases) |
| `tests/e2e/smoke.spec.ts` | Homepage title + sidebar visible |

There is no `test` script in `package.json`, no coverage reporter configured, and the CI pipeline (`docker-build.yml`) does not run any tests — only lint and build.

---

## Gaps by Priority

### 1. Untested validators — `profileSchema` and `passwordChangeSchema`

**File:** `src/lib/validators/settings.ts`

`tagSchema` has good unit coverage, but the other two schemas exported from the same file are completely untested:

- `profileSchema` — validates `fullName` (min 2 / max 100), `email` (must be valid), and `phone` (min 10 / max 20).
- `passwordChangeSchema` — enforces uppercase, lowercase, digit, and special-character requirements on `newPassword`, and cross-field equality with `confirmPassword` via a Zod `.refine()`.

The cross-field password match is the highest-value gap: it is a custom `refine` that is easy to break silently during a schema refactor.

**Suggested tests:**
- Valid profile object passes.
- Invalid email format fails with the right message.
- `fullName` below min / above max fails.
- Valid password that matches `confirmPassword` passes.
- Password without uppercase / digit / special character each produce distinct error messages.
- Mismatched `confirmPassword` attaches the error to the `confirmPassword` path (not the root).

---

### 2. `settingsStore` — Zustand store with no test coverage

**File:** `src/lib/stores/settingsStore.ts`

This store drives the entire Settings page. It has 13 distinct actions (profile update, notification toggles, 2FA toggle, theme changes, tag CRUD, account sync/reconnect/remove, full reset). None are tested.

The riskiest actions are:

- **`addTag`** — calls `crypto.randomUUID()` and splices the result into state. A test would catch ID uniqueness or mutability regressions.
- **`deleteTag` / `updateTag`** — filter/map over tags by ID. Edge cases (non-existent ID, empty list) are silently no-ops today.
- **`reconnectAccount`** — clears `errorMessage` and sets `status: 'reconciled'`. The type cast (`as const`) here is a smell worth exercising.
- **`resetSettings`** — replaces all state slices atomically. A test confirms each slice is restored to the expected default.

**Suggested tests (using Zustand's `getState()` / `setState()` directly — no React needed):**
- `updateProfile` merges partial updates without clobbering other fields.
- `toggleTwoFactor` flips boolean on each call.
- `addTag` appends a tag with a unique `id`.
- `deleteTag` with a known ID removes it; with an unknown ID leaves the list unchanged.
- `updateTag` with a known ID updates only specified fields; other fields are preserved.
- `syncAccount` updates `lastSynced` for the given ID.
- `reconnectAccount` sets `status` to `'reconciled'` and removes `errorMessage`.
- `resetSettings` restores every slice to its default value.

---

### 3. `charts.ts` — uncovered branches in `calculateSparklinePoints`

**File:** `src/lib/charts.ts`

The existing 5 tests are a good start but miss two code branches:

- **`drawHeight <= 0` path (line 34–40)** — reached when `padding * 2 >= height`. No test exercises this. It produces centred points and is clearly a defensive path worth regression-pinning.
- **Negative values in the data array** — the function uses a min/max loop, so negatives should work, but this is not verified. A dataset like `[-50, 0, 50]` would confirm the normalisation arithmetic.
- **Default parameter values** — calling `calculateSparklinePoints([10, 20])` with no `width`/`height` arguments exercises the defaults (`80`, `30`). Currently all tests pass explicit values.

---

### 4. UI components with embedded logic

Several components contain branching logic that can be tested with a lightweight renderer (e.g. Vitest + `@testing-library/react`):

#### `PerformanceBadge` (`src/components/data-display/PerformanceBadge.tsx`)
- When `value > 0`: renders `ArrowUp`, applies success colour classes, formats correctly.
- When `value < 0`: renders `ArrowDown`, applies danger colour classes, shows `Math.abs(value)`.
- When `value === 0`: renders `Minus` (implicit via `showArrow` default), applies muted class.
- When `showArrow = false`: no arrow icon rendered regardless of sign.
- `format = "decimal"` omits the `%` suffix.

#### `StatCard` (`src/components/data-display/StatCard.tsx`)
- When both `label` and `title` are passed, `label` takes precedence.
- When `change` is positive and `trend` is not set, `calculatedTrend` is `"up"`.
- When `change` is exactly `0`, trend is `"neutral"` and the `Minus` icon is shown.
- When `loading` is truthy, a skeleton/loading state is rendered (if implemented).

#### `OrderEntryForm` (`src/components/execution/OrderEntryForm.tsx`)
- The price `<Input>` is hidden when `orderType === 'market'` and visible otherwise.
- Submitting with `orderType === 'market'` calls the handler without a price field.
- The ticker input transforms characters to uppercase on change.

---

### 5. E2E coverage — only the homepage is tested

**File:** `tests/e2e/smoke.spec.ts`

The single Playwright test only checks the homepage title and sidebar visibility. The entire application — six top-level routes, all interactive forms, and navigation — has no E2E coverage.

**Highest-value additions:**

| Route | Key interaction to cover |
|---|---|
| `/portfolios` | Portfolio cards render; clicking a card navigates to holdings |
| `/portfolios/holdings` | Holdings table renders rows with ticker, price, return data |
| `/portfolios/trade-log` | Transaction list renders with correct types (buy, sell, dividend) |
| `/execution` | Order form renders; selecting Market hides the price field; form submits |
| `/research` | Thesis cards render; navigating to a thesis detail page works |
| `/analytics` | Performance metrics table and chart render without error |
| `/settings` | Profile form pre-fills from the store; tag CRUD round-trip |
| Sidebar navigation | Each nav link changes the URL and renders the correct page heading |

---

### 6. No test infrastructure in CI

The `.github/workflows/docker-build.yml` `lint-test` job runs `npm run lint` and `npm run build` but never executes any test suite. Adding a `test` script to `package.json` and invoking it in CI would surface regressions automatically.

A minimal addition to `package.json`:
```json
"test": "node --test src/**/*.test.ts",
"test:e2e": "playwright test"
```

And to the CI job:
```yaml
- run: npm test
- run: npm run test:e2e
```

---

## Summary Table

| Area | Risk | Effort |
|---|---|---|
| `profileSchema` + `passwordChangeSchema` | High — password rules broken silently | Low |
| `settingsStore` actions | High — 13 untested state mutations | Medium |
| `charts.ts` edge cases | Low — 2 uncovered branches | Low |
| `PerformanceBadge` rendering logic | Medium — financial display correctness | Low |
| `StatCard` trend calculation | Medium — trend-direction logic | Low |
| `OrderEntryForm` conditional fields | Medium — form behaviour | Low |
| E2E: navigation + key user flows | High — zero coverage on 6 routes | High |
| CI test execution | Critical — tests never run automatically | Low |
