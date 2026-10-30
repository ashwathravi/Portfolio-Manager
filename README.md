# Atlas Wealth

## Personal Investment Operating System

Atlas Wealth is a personal investment workspace for people who treat their own investing as a serious business: one place to see what you own, how it has done, why you made each decision, and whether a trade fits the rules you set for yourself. It is in a private, invite-only beta at https://atlas-wealth-lovat.vercel.app.

## What it does

- **Today**: net worth, what needs your attention under your own risk policy, your equity curve from nightly valuations, and a weekly review of your closed trades.
- **Portfolio**: accounts, holdings and activity, entered by hand, imported from a broker CSV, or synced from a linked account through Plaid.
- **Performance**: time-weighted returns against the S&P 500, Brinson attribution by sector, and the behaviour behind your closed trades.
- **Research**: a watchlist, a decision journal and structured theses, saved with your account, plus Alpha Radar: changes in institutional holdings from 13F filings on SEC EDGAR.
- **Trade**: an order ticket checked against your risk policy, saved as a plan with its rationale. Atlas never places trades or moves money.
- **Ask**: questions answered from your own data (⌘K).
- **Strategies**: a rule builder. Its strategies and backtests are examples for now.

Prices are stored daily closes from Massive, not live quotes. Anything that isn't your own data carries a **Sample** tag and can be hidden in Settings. Nothing in the app is investment advice.

## Tech stack

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, Server Components), React 19, TypeScript
- **Styling and UI**: [Tailwind CSS v4](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/) + [Radix UI](https://www.radix-ui.com/)
- **State**: [TanStack Query](https://tanstack.com/query/latest) (server) + [Zustand](https://github.com/pmndrs/zustand) (client)
- **Charts**: [Recharts](https://recharts.org/) + [Lightweight Charts](https://tradingview.github.io/lightweight-charts/)
- **Database**: PostgreSQL with Drizzle (Supabase in production, Docker locally)
- **Sign-in**: Auth.js with Google and database sessions, behind an invite list
- **Hosting**: Vercel (cron, deploys from CI), Upstash Redis for shared rate limits, Sentry for errors
- **Data**: Massive (daily prices, history, reference data), SEC EDGAR (13F filings), Plaid (linked accounts)
- **Tests**: Node's built-in test runner (unit) and Playwright (E2E, and a smoke test after every deploy)

## Getting started

### Prerequisites

- Node.js 24 (see `.nvmrc`)
- Docker & Docker Compose

This repository uses **npm** as its canonical package manager. Commit changes to
`package-lock.json` and do not add lockfiles from other package managers.

### Local development

1. **Clone the repository:**

    ```bash
    git clone <repository-url>
    cd Portfolio-Manager
    ```

2. **Install dependencies:**

    ```bash
    npm install
    ```

3. **Start the local database and load example data:**

    ```bash
    cp .env.example .env.local
    npm run db:up
    npm run db:setup
    ```

    This runs Postgres in Docker on `127.0.0.1:54329`. Local development never connects to the production Supabase project.

4. **Run the development server:**

    ```bash
    npm run dev
    ```

    Open [http://localhost:3000](http://localhost:3000) with your browser. You are signed in as the local dev user from `.env.local`. Every other setting is optional locally and described in `.env.example`.

### Tests

```bash
npm run lint && npm test     # lint and unit tests
npm run test:e2e:local       # E2E like CI: a fresh database in the Docker Postgres
```

`AGENTS.md` explains each layer, what every spec covers, and the rule that every change comes with tests.

### Running the production image

`docker compose up -d db` starts only the database. The production image refuses the local sign-in bypass, so it needs real sign-in settings. Put these in `.env.docker` (ignored by git, like every `.env*` file):

```bash
# The db service by name; it serves no TLS, and the app requires TLS for any host but localhost.
DATABASE_URL="postgres://atlas_app:atlas-app-local-only@db:5432/atlas_wealth?sslmode=disable"
AUTH_SECRET="…"                      # openssl rand -base64 32
AUTH_GOOGLE_ID="…"
AUTH_GOOGLE_SECRET="…"               # a Google OAuth client with redirect URI http://localhost:3000/api/auth/callback/google
AUTH_URL="http://localhost:3000"     # off Vercel, Auth.js trusts no other host
AUTH_ALLOWED_EMAILS="you@example.com"
```

Then run:

```bash
docker compose --profile app up -d --build
```

## Documentation

- [AGENTS.md](AGENTS.md): testing rules, the E2E coverage map and the CI pipeline.
- [Architecture](docs/architecture.md): how the app, its data and its jobs fit together.
- [Decisions](docs/decisions.md): the choices behind the launch and why.
- [Deployment](docs/deployment.md), [monitoring](docs/monitoring.md) and [backups](docs/backups.md): how production is deployed, watched and recovered.
- [Security audit](docs/SECURITY-AUDIT.md): the pre-launch review and what it changed.
- [Product guide](docs/portfolio-manager-product-guide.md) and the [UX prototype specification](docs/Atlas-Wealth-UX-Prototype-Spec.md).
- [Developer guide](docs/CLAUDE.md): coding conventions and the design system.

## Project structure

- `src/app`: App Router pages (Today, Portfolio, Performance, Research, Strategies, Trade, Ask, Settings, and the public sign-in, privacy and terms pages) and the API routes under `src/app/api`.
- `src/components`: React components by area (`today/`, `holdings/`, `research/`, …), with shadcn/ui primitives in `ui/`.
- `src/lib`: domain logic by area (`portfolio/`, `performance/`, `risk-policy/`, `markets/`, `plaid/`, `jobs/`, …), each with its unit tests.
- `src/db`: the Drizzle schema and the database client; migrations are in `drizzle/`.
- `src/proxy.ts`: sign-in, rate limits and the Content-Security-Policy for every request.
- `scripts/`: database setup, migrations, seed data, backups, the production monitor and E2E tooling.
- `tests/e2e`: Playwright specs; `tests/production`: the post-deploy smoke test.
