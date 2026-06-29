# Risk Policy Engine PRD

## Overview

Risk Policy Engine turns Portfolio Manager from a portfolio viewer and trading journal into a personal portfolio operating system. The release converts the user's current financial read into enforceable product surfaces: concentration limits, core/satellite/speculative buckets, correlated AI/theme exposure, GOOG employer-stock de-risking, cash jobs, options policy, churn analysis, sell discipline, stress tests, Ask Ledger tools, and Plaid account discovery.

The milestone is named **Risk Policy Engine: Personal Portfolio Operating System**.

## Source Insight

The release is based on a financial read of a concentrated, high-conviction tech/AI portfolio:

- Connected investment holdings are roughly $1.89M.
- GOOG is roughly 48% of connected holdings.
- Cash is roughly 12%.
- NVDA, AAPL, TSM, MU, META, ORCL, COIN, ARK-style exposure, and semis create overlapping AI/mega-cap/risk-on exposure.
- Recent trading shows repeated activity in the same names.
- Long-dated options exist and should be treated as speculative leverage.
- FNMA/FMCC are special-situation bets, not ordinary compounders.

The blunt product problem: the user can be directionally right about AI and still have a fragile financial plan if too much wealth depends on one employer, one factor cluster, and repeated tactical timing decisions.

## Product Goals

1. Make portfolio fragility visible before new trades are placed.
2. Convert vague risk advice into explicit policy, thresholds, tasks, and questions.
3. Separate core wealth building from active ideas, options, and special situations.
4. Treat GOOG/employer exposure as a first-class risk, not just another top holding.
5. Make cash accountable by assigning each dollar a job.
6. Add sell-side discipline so conviction does not silently become concentration.
7. Let the user ask deterministic portfolio-risk questions in Ask Ledger.
8. Add real Plaid Link account discovery as the foundation for richer connected data.

## Non-Goals

- Do not provide personalized financial, tax, or legal advice.
- Do not execute trades automatically.
- Do not optimize tax lots or estimate exact tax liability in this release.
- Do not build a full options pricing or Greeks engine.
- Do not build a probabilistic Monte Carlo risk engine.
- Do not require perfect ETF/fund look-through for v1.
- Do not introduce external LLM calls for risk-policy answers.
- Do not persist Plaid access tokens durably in v1 beyond the server-side placeholder vault.

## Primary Users

- A high-conviction individual investor with concentrated employer stock and active single-name ideas.
- A user who wants tactical flexibility but needs guardrails against drift, churn, and correlated exposure.
- A user who wants a decision journal that can enforce written rules before and after trades.

## Core User Stories

### Risk Dashboard

As a user, I want one command center that shows whether the portfolio is inside policy, on watch, breached, or missing data, so I know what to fix before making new trades.

Acceptance:

- Shows at least 8 policy dimensions.
- Shows current value, target/band, status, explanation, and next action.
- Calls out GOOG/employer-stock separately from generic concentration.
- Missing data is visible and actionable.
- Deep links route to settings, holdings, trade log, research, execution, or Ask.

### Bucket Model

As a user, I want holdings and trades classified as core, satellite, speculative/options, special situation, cash reserve, or unassigned, so active ideas do not quietly drive my whole portfolio.

Acceptance:

- Calculates bucket exposure by dollars and percentage.
- Supports target ranges and hard caps.
- Supports explicit metadata and deterministic fallback.
- Surfaces unassigned exposure as a task.

### Theme And Factor Exposure

As a user, I want the app to show correlated AI, semis, mega-cap growth, cloud, crypto/risk-on, and employer-linked exposure, so ticker count does not masquerade as diversification.

Acceptance:

- Supports weighted multi-theme holdings.
- Computes theme exposure, contributors, and cap status.
- Shows unknown theme metadata as missing data.
- Feeds dashboard, holdings, guardrails, stress tests, and Ask.

### GOOG De-Risking Planner

As a user, I want a staged GOOG de-risking plan, so reducing employer-stock concentration is concrete and repeatable.

Acceptance:

- Supports target allocation and intermediate target.
- Computes dollars/shares required to reach target.
- Supports vest-driven or scheduled trim metadata.
- Surfaces next action on dashboard.
- Does not execute trades automatically.

### Options Risk Ledger

As a user, I want option exposure shown separately from ordinary equities, so LEAPS and calls are treated as speculative leverage with max-loss and thesis checks.

Acceptance:

- Shows premium at risk, current value, notional equivalent, expiry, days to expiry, and underlying exposure.
- Flags missing thesis, missing max-loss acknowledgement, over-cap exposure, and expiry clusters.
- Blocks or warns on option orders that fail policy.

### Cash Jobs

As a user, I want every cash dollar assigned a purpose, so cash is either reserved, scheduled, or explicitly reviewed instead of becoming a timing trap.

Acceptance:

- Supports emergency, tax, near-term, opportunistic, scheduled deployment, settlement, and unassigned cash jobs.
- Computes reserved cash, excess cash, deployment amount, next due date, and unassigned cash.
- Allows temporary acknowledgement of unassigned cash with expiry.

### Churn And Behavior Analyzer

As a user, I want repeated trading in the same names flagged, so I can distinguish intentional active strategy from decision fatigue and thesis churn.

Acceptance:

- Detects repeated buy/sell loops, reopened positions, short holding periods, low adherence, caution mood trades, and missing-thesis adds.
- Shows high-churn names in trade log and weekly review.
- Uses configurable thresholds.

### Sell Discipline

As a user, I want explicit sell/trim/re-underwrite rules, so winners do not become unchecked concentration and losers get re-underwritten.

Acceptance:

- Supports allocation cap, drawdown, thesis stale, target price, position doubled, employer vest, thesis break, and no-add triggers.
- Supports active, triggered, snoozed, and resolved states.
- Captures audit events and reasons.
- Feeds dashboard and execution guardrails.

### Execution Guardrails

As a user, I want the order ticket to distinguish risk-increasing adds from risk-reducing trims, so I can add friction only where it matters.

Acceptance:

- Shows current and post-trade exposure.
- Requires override reason when a buy worsens a breached policy.
- Permits risk-reducing trims.
- Captures policy exceptions for weekly review.

### Stress Tests

As a user, I want deterministic what-if scenarios, so I understand dollar impact from GOOG, AI, semis, mega-cap growth, and risk-on drawdowns.

Acceptance:

- Runs built-in and custom ticker/theme scenarios.
- Shows total impact, percentage impact, contributors, assumptions, and missing metadata.
- Feeds dashboard and Ask Ledger.

### Ask Ledger Risk Tools

As a user, I want to ask plain-English risk-policy questions and get cited deterministic answers.

Acceptance:

- Supports questions about policy breaches, stress tests, theme exposure, trim-to-target, missing theses, cash jobs, churn, and trade policy impact.
- Uses deterministic tools, not freeform external LLM calls.
- Provides citations and links to relevant app surfaces.

### Plaid Account Discovery

As a user, I want to connect accounts through Plaid Link and choose which returned accounts belong in Portfolio Manager.

Acceptance:

- Plaid Link launches from Settings connected accounts.
- Server creates link tokens and exchanges public tokens.
- Access token is not returned to the client.
- User can select accounts and connect them.
- Duplicate account connection updates existing rows rather than creating duplicates.

## Success Metrics

- User can answer "what is breached?" from the dashboard in under 30 seconds.
- User can identify GOOG trim-to-target dollars/shares without spreadsheet work.
- User can see AI/theme exposure separate from sector exposure.
- User can place a risk-reducing trim without override friction.
- User is forced to write an override reason for risk-increasing breached adds.
- Ask Ledger can answer at least 6 risk-policy question types with deterministic citations.
- Plaid flow can discover and connect mocked sandbox accounts in E2E.

## Release Scope By Issue

| Issue | Feature | Classification |
| --- | --- | --- |
| AR-138 | Portfolio risk policy dashboard | UI-heavy |
| AR-139 | Core/satellite/speculative bucket model | Backend/data plus UI-adjacent |
| AR-140 | GOOG employer-stock de-risking planner | UI-adjacent plus backend/data |
| AR-141 | Theme and factor exposure engine | Backend/data plus UI-adjacent |
| AR-142 | Stronger execution guardrails | UI-heavy plus backend/data |
| AR-143 | Options risk ledger and LEAPS policy checks | UI-adjacent plus backend/data |
| AR-144 | Cash jobs and scheduled deployment rules | UI-heavy plus backend/data |
| AR-145 | Churn, tax-friction, and behavior analyzer | Backend/data plus UI-adjacent |
| AR-146 | Systematic sell discipline and trim rules | UI-heavy plus backend/data |
| AR-147 | Portfolio scenario stress tests | Backend/data plus UI-adjacent |
| AR-148 | Ask Ledger risk-policy tools | UI-adjacent plus backend/data |
| AR-149 | Plaid account discovery/linking | UI-heavy plus backend/API/security |

## Key Product Decisions

- Risk-policy utilities are deterministic pure TypeScript where possible.
- Missing metadata is not safe. It is a visible `missing_data` state.
- Risk-reducing trades should be easier than risk-increasing adds.
- Ask Ledger risk answers use deterministic tool outputs with citations.
- Plaid access tokens stay server-side only.
- The release uses existing Next.js/Zustand/Drizzle patterns and does not introduce a new service boundary.

## Security And Privacy Requirements

- Plaid client ID and secret are read only by server API routes.
- Plaid public tokens are exchanged server-side.
- Plaid access tokens are not returned to client components or persisted in localStorage.
- `.env`, `.env.local`, and `.env.example` are ignored by Git.
- Dependency audit must be clean at moderate level or higher before release closeout.
- Ask Ledger must not send portfolio data to an external LLM in this release.

## Verification Summary

Latest release closeout evidence:

- `npm test`: 626/626 passing.
- `npx tsc --noEmit --pretty false --allowImportingTsExtensions`: passing.
- `npm run build`: passing on Next 16.2.6.
- `npm audit --audit-level=moderate`: 0 vulnerabilities.
- Targeted release lint: passing for risk-policy, Ask, Plaid, dashboard, holdings, settings risk cards, execution risk surface, and related E2E specs.
- Release Playwright slice: 92/92 passing.
- Ask Ledger post-fix Playwright spec: 10/10 passing.

Known residual:

- Repo-wide `npm run lint` still reports legacy lint issues outside the release-owned Risk Policy/Plaid/Ask slice. The release-owned lint slice is clean.
- Live Plaid sandbox smoke requires `PLAID_CLIENT_ID` and `PLAID_SECRET`; mocked E2E covers the UI flow.
