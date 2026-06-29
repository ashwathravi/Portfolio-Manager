# Risk Policy Engine Product Architecture

## System Context

Portfolio Manager is a Next.js App Router application with a shared app shell, local Zustand settings state, Drizzle/Postgres database access, deterministic TypeScript domain modules, and Playwright/Node test coverage.

Risk Policy Engine extends the existing app without adding a new service boundary. The release adds a policy layer that sits between holdings/trades/settings data and user-facing workflows such as dashboard, holdings, trade log, execution, Ask Ledger, and connected accounts.

```text
Holdings / Trades / Settings / Connected Accounts
        |
        v
Risk Policy Domain Modules
        |
        +--> Dashboard summary
        +--> Holdings policy chips and ledgers
        +--> Trade log churn warnings
        +--> Execution guardrails
        +--> Ask Ledger deterministic tools
        +--> Weekly review evidence
```

## Runtime Architecture

### Application Layer

- `src/app/page.tsx`: dashboard entry point and risk policy dashboard composition.
- `src/app/portfolios/holdings/page.tsx`: holdings surface, options ledger, bucket/theme controls.
- `src/app/portfolios/trade-log/page.tsx`: trade activity and churn warning/filter.
- `src/app/execution`: order ticket and risk-policy impact checks.
- `src/app/ask/page.tsx`: dedicated Ask Ledger page.
- `src/app/settings`: policy configuration cards and connected-account flow.
- `src/app/api/plaid/*`: server Plaid token endpoints.

### Domain Layer

Risk policy domain code is under `src/lib/risk-policy`.

Important modules:

- `buckets.ts`: core/satellite/speculative/special/cash classification and allocation.
- `themes.ts`: weighted theme/factor exposure and cap evaluation.
- `dashboard.ts`: dashboard dimension assembly and next-action summaries.
- `de-risking.ts`: GOOG/employer-stock plan math and schedule helpers.
- `options.ts`: option position exposure, premium-at-risk, expiry and policy ledger.
- `cash.ts`: cash jobs, excess cash, scheduled deployment, acknowledgement logic.
- `churn.ts`: repeated trading, behavior, turnover, and tax-friction proxy analysis.
- `sell-discipline.ts`: sell/trim/re-underwrite trigger evaluation and state transitions.
- `execution.ts`: pre-trade policy impact evaluation and policy exception generation.
- `stress.ts`: deterministic scenario stress-test engine.

### Ask Ledger Layer

Ask Ledger remains deterministic:

- `src/lib/ask/planner.ts`: maps natural language to approved tools.
- `src/lib/ask/tools.ts`: executes risk-policy, portfolio, and Alpha Radar tools.
- `src/lib/ask/renderer.ts`: renders tables, paragraphs, and citations.
- `src/components/ask/*`: page and overlay UI.

Risk-policy Ask tools call shared domain modules. They do not duplicate UI-only logic.

### Plaid Integration Layer

Plaid code is split by trust boundary:

- `src/components/settings/cards/IntegrationsCard.tsx`: loads Plaid Link SDK and lets the user connect/select accounts.
- `src/app/api/plaid/link-token/route.ts`: reads Plaid env vars and creates a link token.
- `src/app/api/plaid/exchange-public-token/route.ts`: exchanges public token server-side and returns sanitized account metadata.
- `src/lib/plaid/link.ts`: Plaid HTTP helper functions, account mapping, and response sanitization.
- `src/lib/plaid/server-token-vault.ts`: v1 in-memory access-token storage placeholder.
- `src/lib/stores/settingsStore.ts`: persists connected account metadata only.

Client-safe account metadata includes institution, account id, account name, type/subtype, mask, status, balance summary, and sync timestamp. It excludes `access_token`.

## Data Model

### Policy Bucket Metadata

Holdings can carry:

- `policyBucket`: core, satellite, speculative, special_situation, cash_reserve, unassigned.
- `policyBucketLabel`: UI label.
- `policyBucketSource`: explicit, fallback, inferred, missing.

Bucket policy settings include:

- target min/max percent.
- hard cap percent.
- warning threshold.
- enabled state.

### Theme Metadata

Holdings can carry weighted theme rows:

- AI infrastructure.
- Semiconductors.
- Mega-cap growth.
- Cloud/platforms.
- Consumer tech.
- Crypto/risk-on liquidity.
- Special situation/regulatory.
- Employer-linked wealth.
- Broad core index.
- Bonds/treasuries/cash equivalent.

Each theme row has a weight, source, and optional confidence/notes. Unknown theme metadata creates a missing-data state.

### Risk Policy Settings

Persisted in the Zustand settings store:

- bucket policies.
- theme caps.
- cash jobs and deployment rule.
- options risk policy.
- sell discipline rules and audit events.
- churn policy thresholds.
- employer-stock de-risking plan.
- connected account metadata.

### Trade Policy Exceptions

Execution can produce policy exceptions:

- policy id and label.
- current exposure.
- post-trade exposure.
- threshold.
- severity.
- override reason.
- timestamp.

Exceptions feed weekly review and Ask Ledger.

### Plaid Token Boundary

Plaid objects are intentionally split:

- Public token: client receives from Plaid Link, sends once to server.
- Access token: server receives from Plaid, stores server-side only.
- Connected account metadata: sanitized and safe for client persistence.

The in-memory token vault is acceptable for local v1 flow verification but must be replaced before production sync.

## Key Flows

### Dashboard Policy Summary

1. Load holdings, trades, settings, option positions, cash jobs, and policy rules.
2. Compute bucket allocation.
3. Compute theme exposure.
4. Compute employer-stock plan summary.
5. Compute options ledger summary.
6. Compute cash policy summary.
7. Compute churn and sell-discipline tasks.
8. Run selected stress scenarios.
9. Build dashboard dimensions and next actions.
10. Render counts, dimensions, stress cards, and deep links.

### Execution Guardrail Flow

1. User edits order ticket.
2. App builds proposed trade context.
3. Risk policy evaluator computes current and post-trade exposure.
4. Evaluator classifies checks as pass, watch, blocked, or override-required.
5. If trade reduces breached risk, it is allowed.
6. If trade worsens breached risk, override reason is required.
7. Captured exceptions are attached to trade/review state.

### Ask Ledger Risk Question Flow

1. User asks a portfolio-risk question.
2. Planner selects deterministic tool.
3. Tool calls shared domain module.
4. Renderer creates answer text, key rows, citations, and links.
5. Ask UI persists local conversation history after mount to avoid hydration mismatch.

### Plaid Connect Flow

1. User clicks connect from Settings.
2. Client requests `/api/plaid/link-token`.
3. Server creates Plaid Link token using env vars.
4. Client opens Plaid Link SDK.
5. Plaid returns public token and metadata.
6. Client posts public token plus selected account ids to `/api/plaid/exchange-public-token`.
7. Server exchanges public token, fetches accounts, stores access token server-side, sanitizes response.
8. Client stores selected account metadata in settings store.

## Security Model

### Secrets

- `PLAID_CLIENT_ID` and `PLAID_SECRET` are server-only.
- `PLAID_ENV` controls sandbox/development/production base URL.
- `.env*` files are ignored by Git.
- Plaid access tokens never leave server routes.

### Client Storage

LocalStorage may contain:

- UI settings.
- risk policy settings.
- connected account metadata.
- Ask Ledger local transcript.

LocalStorage must not contain:

- Plaid access tokens.
- Plaid secret.
- broker refresh tokens.
- raw credentials.

### Dependency Security

Closeout remediation:

- Upgraded `next` and `eslint-config-next` to 16.2.6.
- Upgraded vulnerable transitive packages through `npm audit fix`.
- Added npm overrides for `postcss` and `@esbuild-kit/core-utils` transitive `esbuild`.
- `npm audit --audit-level=moderate` now reports 0 vulnerabilities.

## Test Architecture

### Unit Tests

Risk-policy modules have unit tests for:

- bucket allocation.
- theme exposure.
- dashboard status classification.
- employer de-risking math.
- options exposure and policy checks.
- cash job math.
- churn analyzer.
- sell discipline transitions.
- stress scenario math.
- execution policy evaluator.
- Ask Ledger tool routing.
- Plaid mapping and sanitization.

Command:

```bash
npm test
```

### Type And Build

Commands:

```bash
npx tsc --noEmit --pretty false --allowImportingTsExtensions
npm run build
```

### E2E

Release E2E slice:

```bash
npm run test:e2e -- tests/e2e/dashboard.spec.ts tests/e2e/settings.spec.ts tests/e2e/execution.spec.ts tests/e2e/holdings.spec.ts tests/e2e/trade-log.spec.ts tests/e2e/ask.spec.ts tests/e2e/help.spec.ts --workers=1
```

Ask post-fix E2E:

```bash
npm run test:e2e -- tests/e2e/ask.spec.ts --workers=1
```

### Lint

Release-owned lint slice:

```bash
npx eslint src/lib/risk-policy src/lib/plaid src/lib/ask src/components/ask src/lib/reviews/generate.ts src/lib/reviews/generate.test.ts src/lib/reviews/narrative.ts src/lib/stores/settingsStore.ts src/lib/stores/settingsStore.test.ts src/components/dashboard/RiskPolicyDashboardCard.tsx src/components/holdings/OptionsRiskLedgerCard.tsx src/components/settings/cards/BucketPolicyCard.tsx src/components/settings/cards/CashJobsCard.tsx src/components/settings/cards/ChurnPolicyCard.tsx src/components/settings/cards/EmployerStockPlanCard.tsx src/components/settings/cards/IntegrationsCard.tsx src/components/settings/cards/SellDisciplineCard.tsx src/components/execution/FocusVariant.tsx tests/e2e/dashboard.spec.ts tests/e2e/settings.spec.ts tests/e2e/execution.spec.ts tests/e2e/holdings.spec.ts tests/e2e/trade-log.spec.ts tests/e2e/ask.spec.ts
```

Known residual: repo-wide `npm run lint` still reports older lint issues outside this release slice.

## Deployment Requirements

Required for baseline app:

- Node compatible with Next 16.2.6.
- `DATABASE_URL` for Postgres-backed features.
- Drizzle migrations applied for current schema.

Required for Plaid sandbox:

- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ENV=sandbox`
- Optional `PLAID_PRODUCTS=investments,transactions`
- Optional `PLAID_COUNTRY_CODES=US`

Required for live Plaid production:

- Replace in-memory token vault with encrypted durable per-user token storage.
- Add user identity/session boundary for account ownership.
- Add webhook verification and item/account sync scheduling.
- Add operational alerts for token exchange and sync failures.

## Extension Points

- Add durable Plaid token storage and item sync.
- Add ETF/fund look-through provider.
- Add tax-lot aware de-risking planner.
- Add broker order placement for generated trim plans.
- Add production scheduler for cash deployment reminders.
- Add richer factor model or historical drawdown analytics.
- Generalize employer-stock planner beyond GOOG after the GOOG flow proves useful.
