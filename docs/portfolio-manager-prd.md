# Portfolio Manager PRD

## Product Summary

Portfolio Manager, branded in the UI as Atlas Wealth, is a personal investment operating system for a high-conviction individual investor. It combines portfolio monitoring, live market data, research workflows, trading journal analysis, strategy governance, execution guardrails, Alpha Radar 13F research, Ask Ledger Q&A, and the Risk Policy Engine into one workspace.

The product is not a brokerage, financial adviser, tax adviser, or automated trading system. It helps the user see risk, record decisions, review behavior, and operate from explicit rules before placing trades elsewhere.

## Target User

The primary user is an active individual investor with:

- Concentrated single-name exposure.
- Employer-stock concentration risk.
- Active AI, semiconductor, mega-cap growth, crypto/risk-on, and special-situation ideas.
- Long-term wealth-building positions mixed with tactical trades.
- A need for written theses, risk limits, behavioral review, and sell discipline.
- Interest in external research signals such as 13F filings and clone-manager activity.

## Problem Statement

Most portfolio apps show balances, charts, and transactions. They do not answer the harder operating questions:

- What risk is actually driving the portfolio?
- Is this portfolio diversified by true exposure, or only by ticker count?
- What should be reviewed before adding risk?
- Which ideas are core wealth-building positions versus speculative or special-situation bets?
- Which trades are repeated churn rather than deliberate strategy?
- Which position should be trimmed, re-underwritten, or blocked from new adds?
- What external manager activity matters for my portfolio now?
- Can I ask portfolio questions and get deterministic, cited answers?

Portfolio Manager exists to answer those questions.

## Product Goals

1. Show the current state of the portfolio, holdings, performance, risk, and behavior in one workspace.
2. Make risk policy explicit through buckets, theme caps, sell rules, cash jobs, option policy, stress tests, and execution checks.
3. Turn research into structured theses, watchlists, evidence, catalysts, journal entries, and Alpha Radar insights.
4. Add deterministic Ask Ledger answers with citations instead of opaque freeform responses.
5. Support account discovery through Plaid Link without exposing access tokens to the client.
6. Keep the product useful locally with seeded and fixture data while preserving paths to real Postgres and provider-backed data.
7. Provide enough test coverage and documentation for iterative feature work.

## Non-Goals

- No automated trade execution.
- No personalized tax, legal, or financial advice.
- No portfolio optimization recommendations that claim suitability.
- No production custody of broker credentials in localStorage.
- No external LLM dependency for deterministic risk-policy answers.
- No requirement that every page be database-backed in the current version.
- No full options pricing, Greeks, or tax-lot optimizer in the current version.

## Core Product Areas

### Dashboard

The dashboard is the daily command center. It should answer:

- What changed?
- What is breached?
- What needs review?
- What is my portfolio value and allocation?
- What are the highest-signal research and risk tasks?

Current dashboard surfaces include:

- Portfolio stats.
- Equity/allocation cards.
- Top holdings and activity.
- Watchlist/thesis snippets.
- Alpha Radar card.
- Risk Policy Dashboard card.
- Weekly review and pattern feed.

### Portfolios And Holdings

Holdings are the source of exposure truth. The holdings surface should support:

- Full holdings table.
- Search, filtering, and detail inspection.
- Bucket classification.
- Theme/factor tags.
- Options risk ledger.
- Concentration and missing-metadata review.

Portfolio list and trade log surfaces provide navigation, performance context, and transaction activity review.

### Performance And Analytics

Performance pages should help the user understand:

- Equity curve and benchmark context.
- Attribution.
- Metrics by period.
- Monthly heatmap.
- P&L density.
- Mood and behavior overlays.
- Archived weekly reviews.

Analytics focuses on behavioral and trading-pattern inspection.

### Research Workspace

Research is where ideas become structured and reviewable:

- Active theses.
- Watchlist.
- Alpha Radar.
- Journal.
- Archive.
- Thesis detail panes.
- Evidence, catalysts, falsification criteria, confidence, and review state.

Research should keep decisions auditable. A trade without a thesis should be visible as a policy failure, not just missing prose.

### Alpha Radar

Alpha Radar detects important 13F activity and turns it into portfolio-relevant research signals.

Current scope includes:

- Tracked filers.
- SEC 13F ingestion and parsing.
- Normalized holdings.
- Quarterly change detection.
- Report generation.
- Semantic memory with keyword fallback and optional embeddings.
- Clone tracking.
- Conviction scoring.
- External overlay contracts.
- Thesis draft generation.
- Scheduled orchestration planning.
- Exploratory backtests.
- Research and dashboard UI.

Alpha Radar answers: "What changed this quarter that matters to my portfolio or watchlist?"

### Risk Policy Engine

Risk Policy Engine turns portfolio advice into explicit rules and workflows:

- Portfolio risk dashboard.
- Core/satellite/speculative bucket model.
- Theme and factor exposure engine.
- GOOG/employer-stock de-risking planner.
- Options and LEAPS policy checks.
- Cash jobs and scheduled deployment.
- Churn and tax-friction proxy analysis.
- Sell discipline and trim rules.
- Execution guardrails.
- Scenario stress tests.
- Ask Ledger risk-policy tools.
- Plaid account discovery.

Risk Policy Engine should make risk visible before a new order is placed.

### Execution

Execution is an order planning and guardrail surface, not a brokerage replacement. It includes:

- Focus, Checkout, and Terminal variants.
- Order entry.
- Pre-trade rationale.
- Mood/cooldown controls.
- Adherence checks.
- Risk-policy impact checks.
- Order blotter preview.

The core rule: risk-reducing trades should be easier than risk-increasing trades that worsen breached policy.

### Strategies

Strategies organize rule-based investment approaches and adherence:

- Strategy cards.
- Rule builder.
- Guardrails.
- Backtest panel.
- Adherence rules.
- Adherence impact.
- Promotion/deployment workflow surfaces.

Strategies connect the user's stated process to measurable behavior.

### Ask Ledger

Ask Ledger is a deterministic Q&A layer over portfolio data, risk policy, Alpha Radar evidence, and app state.

It should:

- Route questions to approved internal tools.
- Return cited answers.
- Avoid sending sensitive portfolio data to an external LLM in deterministic release paths.
- Link back to the relevant app surface.

Example supported questions:

- What happens if GOOG drops 40%?
- How much of my portfolio is one AI trade?
- Which positions lack a thesis?
- Which risk policies are breached?
- What should I trim to hit a GOOG target?
- Which names are high churn?
- What Alpha Radar evidence exists for this ticker?

### Settings

Settings owns user preferences and operating policy:

- Profile.
- Connected accounts.
- Appearance, theme, density, and accent.
- Guardrails.
- Execution friction.
- Bucket policy.
- Cash jobs.
- GOOG de-risking.
- Trading activity policy.
- Sell discipline.
- Advanced notification, alerts, API key, data, security, and tag surfaces.

### Help

Help should make the app self-explanatory for local and product workflows:

- Alpha Radar release notes and guides.
- Links to key product surfaces.
- Mobile-safe content.

## User Journeys

### Daily Risk Review

1. Open Dashboard.
2. Review breached and missing-data policy dimensions.
3. Inspect GOOG/employer, theme, cash, options, churn, and sell-discipline tasks.
4. Open the relevant deep link.
5. Resolve, snooze, or update policy.
6. Ask Ledger for a cited explanation if needed.

### New Trade Review

1. Open Execution.
2. Enter proposed order.
3. Complete pre-trade rationale and mood state.
4. Review policy impact.
5. If trade worsens breached risk, enter override reason or cancel.
6. If trade reduces risk, proceed through the planning flow.

### Research To Thesis

1. Open Research.
2. Review watchlist and active theses.
3. Check Alpha Radar for 13F changes, clone signals, conviction scores, overlays, and draft ideas.
4. Promote useful evidence into a thesis.
5. Use falsify-if and next-watch fields to keep the thesis reviewable.

### Weekly Behavior Review

1. Open Performance and Analytics.
2. Review attribution, P&L density, heatmaps, and mood behavior.
3. Review pattern feed and weekly review card.
4. Inspect churn names in Trade Log.
5. Update sell discipline or strategy adherence rules.

### Account Connection

1. Open Settings.
2. Click Connect in Connected accounts.
3. Complete Plaid Link.
4. Review returned accounts.
5. Select accounts to connect.
6. Store metadata in app settings; keep access token server-side.

## Success Metrics

- User can identify top breached risks in under 30 seconds.
- User can trace a dashboard risk to holdings, settings, or execution in one click.
- User can answer at least six portfolio-risk questions through Ask Ledger with citations.
- User can connect Plaid sandbox accounts and select returned accounts.
- Unit tests cover pure domain modules.
- E2E tests cover major app routes and critical interactions.
- No access tokens or secrets are stored in localStorage.

## Current Verification Status

As of 2026-05-16 local closeout:

- `npm test`: passing, 626 tests.
- `npx tsc --noEmit --pretty false --allowImportingTsExtensions`: passing.
- `npx next build --webpack`: passing.
- `npm run lint`: currently blocked by existing repo-wide lint debt, mostly React Compiler lint rules and legacy `any` usage outside the latest Plaid/Risk Policy closeout path.
- `npm run test:e2e`: blocked in the current sandbox because the Playwright web server cannot bind to port 3000 without escalation. Prior focused Plaid E2E passed when escalation was available.
- Security review: no tracked real secrets found; `npm audit --json` reported 0 vulnerabilities during the security-agent pass.

## Open Product Risks

- Several pages still rely on seeded/mock data and local client state.
- Plaid access token storage supports encrypted local persistence when `PLAID_TOKEN_ENCRYPTION_KEY` or `INTERNAL_API_SECRET` is configured, but falls back to process memory when no key is available.
- Schwab tokens are not persisted with a production-ready token lifecycle.
- Database-backed Alpha Radar routes require `DATABASE_URL`; fallback UI should remain usable without it.
- Full lint and CI readiness require resolving existing repo-wide lint debt.
- Production security posture still requires real user authentication, route-level authorization, rate limits, CSP hardening, provider error redaction, and audit logging.
