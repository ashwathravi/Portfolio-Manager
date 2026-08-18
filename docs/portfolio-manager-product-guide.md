# Portfolio Manager Product Guide

## Purpose

Portfolio Manager is a personal investment operating system. Use it to monitor portfolio state, inspect holdings, research ideas, review behavior, enforce risk policy, plan trades, and ask deterministic questions about your portfolio.

It does not provide financial advice and does not execute trades automatically.

## Local Setup

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm run dev
```

Open the local URL printed by Next.js, usually:

```text
http://localhost:3000
```

Run unit tests:

```bash
npm test
```

Run type check:

```bash
npx tsc --noEmit --pretty false --allowImportingTsExtensions
```

Run a production build with webpack:

```bash
npx next build --webpack
```

Run Playwright E2E:

```bash
npm run test:e2e
```

In restricted sandboxes, E2E may fail because the dev server cannot bind to port 3000. Run it in a normal local shell when needed.

## Environment Variables

Create `.env.local` for local secrets. Do not commit real secrets.

Common variables:

```bash
DATABASE_URL="postgresql://..."
ALPHA_VANTAGE_API_KEY=""
POLYGON_API_KEY=""
SEC_EDGAR_USER_AGENT="Portfolio-Manager local contact@example.com"
```

Auth.js (required for any network-reachable environment):

```bash
AUTH_SECRET="replace-with-a-managed-random-secret"
AUTH_GOOGLE_ID="your_google_oauth_client_id"
AUTH_GOOGLE_SECRET="your_google_oauth_client_secret"
```

Missing or partial Auth.js configuration fails closed for browser access.
Machine API callers may still use a validated `INTERNAL_API_SECRET` together
with an explicit `x-user-id`; a browser session identity always takes
precedence over that header. Fixture-only local and E2E use may opt into one
fixed principal; this bypass is ignored in production:

```bash
AUTH_LOCAL_DEV_BYPASS="1"
AUTH_LOCAL_DEV_USER_ID="the-exact-seeded-auth_users-id"
```

Set `SEED_USER_ID` (or the same `AUTH_LOCAL_DEV_USER_ID`) to an existing
`auth_users.id` before running `node --import tsx scripts/seed.ts`. The command
refuses to create an Auth.js identity, and atomically replaces only that user's
portfolios. Before deploying the ownership constraint over an existing
database, follow `docs/portfolio-ownership-migration.md`; the migration stops
rather than guessing an owner for legacy rows.

Plaid sandbox:

```bash
PLAID_ENV="sandbox"
PLAID_CLIENT_ID="your_client_id"
PLAID_SECRET="your_sandbox_secret"
PLAID_TOKEN_ENCRYPTION_KEY="local_32_plus_character_secret"
PLAID_PRODUCTS="investments,transactions"
PLAID_COUNTRY_CODES="US"
```

`PLAID_TOKEN_ENCRYPTION_KEY` enables encrypted local persistence for Plaid access tokens in `.runtime/plaid-token-vault.json`. Without it, Plaid tokens are cached only in the running server process and accounts must be reconnected after a server restart before provider sync can resume.

Schwab:

```bash
SCHWAB_CLIENT_ID=""
SCHWAB_CLIENT_SECRET=""
SCHWAB_REDIRECT_URI=""
SCHWAB_ACCESS_TOKEN=""
SCHWAB_ACCOUNT_ID=""
INTERNAL_API_SECRET=""
```

Restart the dev server after changing env vars.

Production secrets:

- Do not deploy `.env` or `.env.local`; configure production values through the hosting platform or a secrets manager such as Vercel environment variables, AWS Secrets Manager, or 1Password CLI.
- `DATABASE_URL` must be a production database credential with SSL enabled. Local-style hosts such as `localhost`, `127.0.0.1`, `postgres`, or `db` are treated as misconfiguration in production.
- Configure all three Auth.js values (`AUTH_SECRET`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET`). Missing or partial production auth returns a closed configuration error; `AUTH_LOCAL_DEV_BYPASS` can never enable production access.
- Keep Plaid and broker access tokens server-side only. The encrypted local Plaid vault is a development bridge; production sync needs user-scoped durable storage and managed key rotation.
- Set `INTERNAL_API_SECRET` before network-visible deployment so API middleware can enforce authenticated requests and per-user rate limits.

Production Plaid token storage:

- Store Plaid access tokens in Postgres as encrypted token rows scoped by authenticated `user_id` and internal Plaid item id.
- Encrypt tokens before database write with an application key from the production secrets manager or KMS-backed secret. Track key version on each token row for rotation.
- Keep displayable account metadata separate from encrypted token material. Client responses may include account names, masks, institution metadata, and sync state, but never access tokens, public tokens, or encrypted token blobs.
- Set `PLAID_TOKEN_STORAGE=postgres` in production so Plaid connections write to the durable registry. Leave it unset in local development to keep the encrypted file vault behavior.
- Use `PLAID_TOKEN_KEY_VERSION` during operator-managed key rotation; rotate by re-encrypting registry rows under the new key version before disabling the old key.

Supabase Data API posture:

- Portfolio Manager uses Supabase-hosted Postgres through server-side Drizzle, not direct browser Data API access.
- Do not grant `anon` or `authenticated` table access unless a table is intentionally exposed through Supabase REST, GraphQL, or `supabase-js`.
- Every new `public` table migration must enable row-level security, revoke implicit Data API access for internal-only tables, or add explicit `GRANT` statements with concrete RLS policies for intentionally exposed tables.
- Re-run the Supabase Security Advisor after database privilege changes and document any remaining accepted findings.

## Navigation Overview

The sidebar has two sections.

Workspace:

- Dashboard.
- Performance.
- Holdings.
- Research.
- Strategies.
- Execution.
- Ask Ledger.

System:

- Settings.
- Help.

## Dashboard

Use Dashboard first each day.

What to review:

- Portfolio value and daily movement.
- Allocation.
- Top holdings.
- Recent activity.
- Alpha Radar signal card.
- Risk Policy Dashboard card.
- Weekly review and pattern feed.

Recommended workflow:

1. Check breached risk policies.
2. Check missing metadata.
3. Open the highest-priority next action.
4. Ask Ledger for explanation if the risk is unclear.
5. Avoid adding new risk until policy breaches are understood.

## Holdings

Open **Holdings** to inspect exposure at the position level.

Use it to:

- Review holdings table.
- Search/filter holdings.
- Inspect allocation and concentration.
- Review bucket classifications.
- Review theme/factor exposure.
- Review options risk ledger.
- Identify unassigned or missing metadata.

Important fields:

- Policy bucket: core, satellite, speculative/options, special situation, cash reserve, or unassigned.
- Theme/factor tags: AI infrastructure, semiconductors, mega-cap growth, cloud/platform, crypto/risk-on, employer-linked, broad core, bonds/cash.
- Options risk: premium at risk, notional equivalent, expiry, thesis and max-loss policy.

## Portfolios

Open **Portfolios** for account and portfolio-level views.

Use it to:

- Review portfolio list.
- Search and sort rows.
- Navigate into portfolio or holding details.
- Track account count and high-level portfolio metadata.

## Trade Log

Open **Portfolios > Trade Log** to review transaction activity.

Use it to:

- Review buy/sell history.
- Inspect trade summary stats.
- Filter high-churn names.
- Review repeated buys and sells.
- Look for trades made without thesis or rule adherence.

Risk Policy Engine uses trade history to detect churn, reopened positions, short holding periods, and behavioral patterns.

## Performance

Open **Performance** for returns and behavior context.

Use it to:

- Review equity curve.
- Compare attribution.
- Inspect metrics by period.
- Review monthly heatmap.
- Review P&L density.
- Review mood and behavioral overlays.
- Browse review archive.

Recommended weekly workflow:

1. Review returns and attribution.
2. Compare performance against behavior patterns.
3. Review mood-driven trades.
4. Update strategy rules or sell discipline if needed.

## Analytics

Open **Analytics** for deeper trading behavior review.

Use it to inspect:

- Trading activity heatmap.
- Trade calendar.
- Behavioral insights.
- Chart sections.

Analytics is most useful after the trade journal has enough entries.

## Research

Open **Research** to manage investment ideas.

Tabs and surfaces include:

- Theses.
- Watchlist.
- Alpha Radar.
- Journal.
- Archive.

Use Research to:

- Create and update theses.
- Track hypothesis, evidence, risks, target, confidence, and falsify-if criteria.
- Add catalysts and evidence.
- Review watchlist ideas.
- Inspect Alpha Radar 13F changes.
- Generate and review thesis draft candidates.
- Archive stale or rejected ideas.

Good thesis hygiene:

- Every active single-name idea should have a written thesis.
- Every thesis should have a falsify-if condition.
- Every add should reference a thesis or intentionally record an exception.

## Alpha Radar

Alpha Radar surfaces institutional 13F activity and turns it into research evidence.

Use it to:

- Track filers.
- Review quarterly changes.
- See top adds, trims, exits, and new positions.
- Review clone tracking and consensus.
- Inspect conviction-ranked ideas.
- Search semantic filing memory.
- View external overlays when configured.
- Run exploratory backtests.
- Review thesis draft candidates.

Alpha Radar evidence is not a buy signal by itself. Treat it as sourced research input.

## Strategies

Open **Strategies** to manage strategy rules and adherence.

Use it to:

- Review strategy cards.
- Select a strategy.
- Configure rule builder conditions.
- Edit adherence rules.
- Review adherence impact.
- Inspect backtest panel.
- Explore builder/deploy pages.

Strategy rules should describe process, not just desired outcomes.

## Execution

Open **Execution** to plan orders with guardrails.

Execution variants:

- Focus: normal order planning.
- Checkout: step-based confirmation flow.
- Terminal: fast keyboard-oriented workflow.

Before submitting a trade plan:

1. Enter ticker, side, quantity, order type, and prices.
2. Complete pre-trade rationale if required.
3. Review mood/cooldown warnings.
4. Review thesis linkage.
5. Review risk-policy impact.
6. If the trade worsens breached risk, provide an override reason or cancel.
7. Prefer risk-reducing trims when policies are breached.

Options rules:

- Option trades require thesis context.
- Max-loss acknowledgement is required.
- Short option flow is not supported in v1.
- Speculative/options exposure should stay inside configured caps.

## Ask Ledger

Open **Ask Ledger** from the sidebar or `/ask`.

Ask Ledger answers deterministic questions using internal tools.

Examples:

```text
What risk policies are breached?
What happens if GOOG drops 40%?
How much of my portfolio is AI exposure?
Which positions do not have a thesis?
Which names are high churn?
How much cash is unassigned?
What should I trim to reach my GOOG target?
What Alpha Radar evidence exists for NVDA?
```

Read the citations and links. Ask Ledger is a navigation and reasoning aid, not an adviser.

## Settings

Open **Settings** to configure the operating system.

Primary cards:

- Profile.
- Connected accounts.
- Appearance.
- Guardrails.
- Execution.
- Bucket policy.
- GOOG de-risking.
- Trading activity.
- Cash jobs.
- Sell discipline.

Advanced settings:

- Notifications.
- Alerts.
- API keys.
- Security.
- Data.
- Tags.

### Appearance

Configure:

- Theme.
- Density.
- Accent.
- Animations.

### Connected Accounts

For Plaid:

1. Confirm Plaid env vars are set.
2. Click Connect.
3. Complete Plaid Link.
4. Review returned accounts.
5. Select accounts to connect.
6. Confirm.

The app stores account metadata in settings. Plaid access tokens stay server-side.

For local sandbox testing, configure `PLAID_TOKEN_ENCRYPTION_KEY` before connecting accounts if you want Plaid access tokens to survive a dev-server restart.

### Bucket Policy

Set targets and caps for:

- Core.
- Satellite.
- Speculative/options.
- Special situations.
- Cash reserve.
- Unassigned.

### GOOG De-Risking

Configure:

- Target allocation.
- Intermediate target.
- Trim amount.
- Tax reserve percent.
- Next action date.
- Destination allocation.

The planner computes planning output only. It does not trade.

### Cash Jobs

Classify cash into jobs:

- Emergency.
- Tax.
- Near-term.
- Opportunistic.
- Scheduled deployment.
- Settlement.
- Unassigned.

Set a deployment rule if excess cash should be invested on a schedule.

### Trading Activity

Configure churn thresholds:

- Lookback days.
- Watch repeated names.
- Breach repeated names.

Use this to tune high-churn warnings.

### Sell Discipline

Create sell rules:

- Allocation cap.
- Drawdown.
- Thesis stale.
- Target reached.
- Position doubled.
- Employer vest.
- Thesis break.
- No-add rule.

Triggered rules can be snoozed or resolved with a reason. Reasons become review evidence.

## Help

Open **Help** for release notes, Alpha Radar guidance, and product links.

Use it when:

- You need to understand Alpha Radar v1/v2.
- You want release context.
- You need links back to primary workflows.

## Common Troubleshooting

### App Starts But Data Is Missing

Check:

- `DATABASE_URL` is set if you need database-backed data.
- Seed data has been loaded if working locally.
- Provider API keys are set if expecting live data.

Without database/provider keys, many UI surfaces still render seeded or fallback data.

### Market Data Returns Errors

Check:

- `ALPHA_VANTAGE_API_KEY`.
- `POLYGON_API_KEY`.
- Provider rate limits.
- Network access.

The app can degrade to empty quotes when providers are unavailable.

### Plaid Link Fails

Check:

- `PLAID_ENV=sandbox`.
- `PLAID_CLIENT_ID` is set.
- `PLAID_SECRET` is set.
- Dev server was restarted after env changes.
- Plaid account has product access for `investments` and `transactions`.

### Alpha Radar Routes Return 500

Check:

- `DATABASE_URL`.
- Alpha Radar migrations.
- `SEC_EDGAR_USER_AGENT` for live SEC calls.
- Provider budgets and circuit-breaker state.

### E2E Cannot Start Server In Sandbox

Run E2E from a normal local shell:

```bash
npm run test:e2e
```

The sandbox can block binding to port 3000.

## Operator Checklist

Before treating a release as ready:

1. Run `npm test`.
2. Run `npx tsc --noEmit --pretty false --allowImportingTsExtensions`.
3. Run `npx next build --webpack`.
4. Run focused and full Playwright E2E from a shell that can bind port 3000.
5. Run `npm run lint` and resolve existing repo-wide lint debt.
6. Run `npm audit --audit-level=moderate` in a network-enabled shell.
7. Confirm no real secrets are committed.
8. Confirm `.env*`, `.runtime/`, and `.next/` artifacts are not included in Docker images or commits.
9. Confirm Plaid and Schwab tokens are not stored in localStorage.
10. Confirm production secrets are set through the deployment secrets manager, not copied from local `.env` files.
11. Confirm auth and rate limits are in place before network-visible deployment.
12. Update Linear with verification evidence before moving work to Done.
