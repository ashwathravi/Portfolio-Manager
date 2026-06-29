# Risk Policy Engine Usage Guide

## What This Release Does

Risk Policy Engine helps you operate the portfolio by policy instead of by vibes. It answers:

- What is breached right now?
- How much wealth is tied to GOOG/employer exposure?
- How much of the portfolio is really one AI/mega-cap/semi/risk-on trade?
- Which cash is reserved, scheduled, or unassigned?
- Which option positions violate written-thesis, max-loss, or sizing rules?
- Which trades increased already-breached risk?
- Which positions need a trim, re-underwrite, thesis update, or cooldown?
- What happens if GOOG or the AI basket sells off?

The app does not provide financial advice and does not execute trades automatically. It gives deterministic policy checks, calculations, and review tasks.

## First-Time Setup

### 1. Open The App

Start the local app:

```bash
npm run dev
```

Then open the local URL printed by Next.js.

### 2. Optional: Configure Plaid Sandbox

For live Plaid sandbox flow, set these environment variables:

```bash
PLAID_CLIENT_ID="your_client_id"
PLAID_SECRET="your_sandbox_secret"
PLAID_ENV="sandbox"
PLAID_PRODUCTS="investments,transactions"
PLAID_COUNTRY_CODES="US"
```

Restart the app after setting them.

If credentials are not set, the mocked E2E flow still verifies the UI, but the real sandbox connection will not work.

### 3. Review Default Policy

Go to **Settings** and review the risk policy cards:

- Bucket policy.
- Cash jobs.
- GOOG de-risking.
- Sell discipline.
- Churn policy.
- Connected accounts.

Defaults are intentionally conservative enough to reveal risk. Tune them to your actual policy before treating alerts as operational.

## Dashboard Workflow

Go to **Dashboard**.

The Portfolio Risk Policy card shows:

- Status counts: inside, watch, breached, missing data.
- Policy dimensions with current value, threshold, explanation, and status.
- Next actions.
- Sell-discipline tasks.
- Stress-test scenarios.
- Deep links to configure or investigate a policy area.

Use this page first before placing new trades. The dashboard answers whether the portfolio has existing breaches that a new trade could worsen.

Recommended review:

1. Look for red/breached rows.
2. Look for missing data rows.
3. Check whether GOOG, AI/theme, options, cash, churn, or sell discipline has a next action.
4. Use deep links to fix one issue at a time.

## Holdings Workflow

Go to **Portfolios > Holdings**.

Use this page to inspect policy metadata at the position level:

- Bucket chips show core, satellite, speculative/options, special situation, cash reserve, or unassigned.
- Theme chips show AI infrastructure, semiconductors, mega-cap growth, cloud, crypto/risk-on, and other factor exposure.
- Policy overview shows bucket and theme concentration.
- Options ledger shows long option risk separately from equities.

What to look for:

- GOOG and employer-linked exposure.
- AI/semiconductor overlap across multiple tickers.
- Unassigned holdings.
- Option positions missing thesis or max-loss acknowledgement.
- Special situations that are larger than intended.

## Settings Workflow

Go to **Settings**.

### Bucket Policy

Use the bucket policy card to define target ranges and caps for:

- Core.
- Satellite/active ideas.
- Speculative/options.
- Special situations.
- Cash reserves.
- Unassigned.

Use reset if you want to return to defaults.

### Cash Jobs

Use the cash jobs card to classify cash:

- Emergency fund.
- Tax reserve.
- Near-term spending.
- Opportunistic reserve.
- Scheduled deployment.
- Settlement/pending transfer.
- Unassigned.

If you have excess cash, set a deployment rule such as monthly or quarterly deployment. The dashboard will show the next due action.

### GOOG De-Risking

Use the GOOG plan card to:

- Set a target allocation.
- Set an intermediate target.
- Choose vest-driven or scheduled trim behavior.
- Record next action date.

The planner computes dollars/shares required to reach target. It does not execute sales.

### Sell Discipline

Use the sell discipline card to define rules such as:

- Single stock above max allocation.
- Position drawdown beyond re-underwrite threshold.
- Thesis stale.
- Target price reached.
- Position doubled.
- Employer vest action.
- Thesis break.
- No written thesis means no add.

Triggered rules can be snoozed or resolved with an audit event.

### Churn Policy

Use churn thresholds to decide when repeated trading activity becomes a review item.

The analyzer can flag:

- Repeated buy/sell loops.
- Reopened positions soon after sale.
- Short holding periods.
- Caution mood trades.
- Low adherence trades.
- Missing-thesis adds.

## Execution Workflow

Go to **Execution**.

The order ticket shows a risk-policy impact panel for proposed trades.

For risk-increasing buys, the app checks:

- Whether the target ticker or bucket is already breached.
- Whether theme exposure would worsen.
- Whether employer-linked exposure would worsen.
- Whether option policy is satisfied.
- Whether a thesis exists and is fresh enough.
- Whether a no-add sell discipline rule is active.

For risk-reducing sells, the app allows trims that reduce breached exposure.

If a trade requires override:

1. Read current exposure, post-trade exposure, and threshold.
2. Enter an override reason.
3. Submit only if the reason is intentional and reviewable.

The override is evidence for weekly review.

## Trade Log Workflow

Go to **Portfolios > Trade Log**.

The trade log shows churn warnings and can filter high-churn names.

Use it to review:

- Names repeatedly bought and sold.
- Trades that increased breached exposure.
- Trades made without updated thesis.
- Activity that should trigger cooldown or re-underwriting.

## Ask Ledger Workflow

Open Ask Ledger from:

- Sidebar Ask Ledger link.
- `/ask`.
- Keyboard shortcut from the app shell.

Example questions:

- What happens if GOOG drops 40%?
- How much of my portfolio is one AI trade?
- What should I trim to reach 25% GOOG?
- Which positions have no written thesis?
- How much cash is unassigned?
- Which names are high churn?
- Which risk policies are breached?

Ask Ledger uses deterministic tools and shows citations/links. It does not send portfolio data to an external LLM in this release.

## Plaid Connected Account Workflow

Go to **Settings > Connected Accounts**.

1. Click the Plaid connect action.
2. Complete Plaid Link.
3. Review returned accounts.
4. Select the accounts to connect.
5. Confirm connection.

The app stores account metadata only. Plaid access tokens are exchanged server-side and are not written to localStorage.

If the flow fails:

- Confirm `PLAID_CLIENT_ID` and `PLAID_SECRET` are set.
- Confirm `PLAID_ENV=sandbox` for sandbox.
- Restart the dev server after changing env vars.
- Retry from Settings.

## Stress-Test Workflow

From Dashboard or Ask Ledger, review built-in stress scenarios:

- GOOG drawdown.
- AI basket drawdown.
- Semiconductors drawdown.
- Mega-cap growth underperformance.
- Crypto/risk-on liquidity shock.
- Broad market stress with tech beta.

Read:

- Total dollar impact.
- Portfolio percentage impact.
- Top contributors.
- Scenario assumptions.
- Missing metadata notes.

Scenarios are deterministic what-if tests, not forecasts.

## Weekly Review Workflow

Use weekly review to inspect:

- Captured policy exceptions.
- Triggered sell-discipline events.
- Churn warnings.
- Trades that worsened or reduced policy breaches.

The goal is to convert policy exceptions into behavior changes, not just collect warnings.

## Recommended Operating Rhythm

Daily or before trading:

1. Check Dashboard policy status.
2. Avoid new buys that worsen breached risk.
3. Use Ask Ledger for one specific question if unsure.

Weekly:

1. Review churn warnings.
2. Review sell-discipline triggers.
3. Resolve or snooze tasks with reasons.
4. Check whether cash deployment actions are due.

Monthly or after vest:

1. Review GOOG target progress.
2. Update vest-driven action date.
3. Re-check AI/theme exposure.
4. Revisit bucket targets.

Before options trades:

1. Confirm written thesis.
2. Confirm max loss.
3. Confirm expiry rule.
4. Confirm options exposure cap.

## Troubleshooting

### Dashboard Shows Missing Data

Missing data is intentional. It means the app cannot safely classify something.

Fix by:

- Assigning bucket metadata.
- Assigning theme metadata.
- Adding a written thesis.
- Classifying cash.
- Configuring policy thresholds.

### Ask Ledger Has No History After First Render

Ask Ledger loads local history after mount to avoid hydration mismatch. Wait for the page to finish rendering. If the history is still gone, localStorage may have been cleared.

### Plaid Connect Fails

Check:

- `PLAID_CLIENT_ID`.
- `PLAID_SECRET`.
- `PLAID_ENV`.
- Network access.
- Server restart after env changes.

### Option Trade Is Blocked

Check:

- Thesis field.
- Max-loss acknowledgement.
- Days to expiry and exit rule.
- Total options exposure cap.
- Underlying concentration.

### A Buy Requires Override

The buy probably worsens a breached policy. Either:

- Reduce size.
- Trim elsewhere first.
- Update thesis and write an override reason.
- Treat it as a signal that the portfolio policy needs review.

### Repo Verification Notes

Current closeout commands:

```bash
npm test
npx tsc --noEmit --pretty false --allowImportingTsExtensions
npm run build
npm audit --audit-level=moderate
npm run test:e2e -- tests/e2e/dashboard.spec.ts tests/e2e/settings.spec.ts tests/e2e/execution.spec.ts tests/e2e/holdings.spec.ts tests/e2e/trade-log.spec.ts tests/e2e/ask.spec.ts tests/e2e/help.spec.ts --workers=1
```

Known residual: full repo `npm run lint` still reports older lint issues outside the Risk Policy/Plaid/Ask release slice. Release-owned lint passes.
