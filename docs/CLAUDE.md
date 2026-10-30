# CLAUDE.md — Atlas Wealth (Portfolio Manager)

## Project Overview

**Atlas Wealth** is a Personal Investment Operating System. It brings together performance tracking, research, strategy work and controlled trade planning around the user's own portfolio, in eight destinations: Today, Portfolio, Performance, Research, Strategies, Trade, Ask and Settings (`src/lib/navigation.ts`).

The original UX specification lives in `docs/Atlas-Wealth-UX-Prototype-Spec.md` (4,573 lines). It is the reference for page and component design, but the app has since consolidated its information architecture: where the spec and `src/lib/navigation.ts` disagree on pages or routes, the code wins. How the system fits together is in `docs/architecture.md`, and why it is built this way is in `docs/decisions.md`.

## Tech Stack

| Category | Technology | Notes |
| :--- | :--- | :--- |
| Framework | Next.js 16 (App Router) | Server Components, `src/proxy.ts` on every request. Read `node_modules/next/dist/docs/` before relying on older Next.js knowledge (`AGENTS.md`). |
| UI | React 19 + TypeScript 5 | Strict mode |
| Styling | Tailwind CSS v4 | Utility-first, 4px base spacing unit, tokens in `src/app/globals.css` |
| Components | shadcn/ui + Radix UI | Accessible, copy-paste architecture |
| Tables | TanStack Table v8 | Headless |
| Server State | TanStack Query v5 | |
| Client State | Zustand v5 | Per-browser UI state only; whatever a user owns is stored on the server |
| Forms | React Hook Form v7 + Zod v4 | Schema validation, shared with the API routes (`src/lib/validators`) |
| Charts | Recharts (standard) + Lightweight Charts (candlestick) | Lazy-load Lightweight Charts |
| Animation | Framer Motion v12 | GPU-accelerated, declarative |
| DnD | @dnd-kit | Headless, accessible drag-and-drop |
| Dates | date-fns | Modular, lightweight |
| Database | PostgreSQL + Drizzle | Supabase in production, Docker locally (`docs/architecture.md`) |
| Auth | Auth.js (next-auth v5) | Google, database sessions, invite list |
| Testing | Node's `node:test` + `tsx` (unit), Playwright (E2E and post-deploy smoke) | See `AGENTS.md` |
| Linting | ESLint (eslint-config-next) | |

## Commands

```bash
# Development
npm run db:up        # local Postgres in Docker (127.0.0.1:54329)
npm run db:setup     # migrate, create the app login and dev user, seed examples
npm run dev          # dev server, signed in as the local dev user

# Quality
npm run lint             # ESLint
npm test                 # unit tests
npm run test:e2e:local   # E2E like CI, on a fresh database
npm run build            # production build
```

`AGENTS.md` has the full testing workflow and the rule that every change comes with tests.

## Project Structure

```text
src/
├── app/                  # App Router pages and API routes
│   ├── page.tsx          # Today (/)
│   ├── portfolios/       # Holdings, Accounts, Activity, symbol detail
│   ├── performance/      # Returns, Attribution, Behaviour
│   ├── research/         # Watchlist, journal, theses, Alpha Radar
│   ├── strategies/       # Strategy builder (example data)
│   ├── execution/        # Trade: order ticket and plans
│   ├── ask/              # Ask history (the overlay is ⌘K)
│   ├── settings/, help/  # Settings and Help
│   ├── login/, privacy/, terms/   # Public pages
│   └── api/              # API routes
├── components/           # By area: today/, holdings/, research/, layout/, … and ui/ (shadcn/ui)
├── lib/                  # Domain logic by area, each module with its unit tests
├── db/                   # Drizzle schema and client
├── styles/               # Self-hosted fonts and shared CSS
├── types/                # Shared TypeScript types
├── auth.ts               # Auth.js configuration
└── proxy.ts              # CSP, sign-in and rate limits for every request
```

## Core Principles

These principles from the spec must guide every implementation decision:

- **Truth over vibes** — Show complete data lineage. Never hide reconciliation status. Display confidence levels.
- **Make thinking explicit** — Use thesis templates, evidence frameworks. Track counterarguments.
- **Guardrails by default** — Realistic backtest assumptions (slippage, fees). Execution constraints. Approval workflows.
- **Progressive autonomy** — Staged confidence levels before earning automation.

## Design System

### Colors

Tokens live in `src/app/globals.css`.

- **Primary:** a green scale (`--color-primary-500` is `#17cf54`)
- **Success/Gains:** `--pm-success` (`#0da83f`); the `--color-success-*` scale for fills
- **Danger/Losses:** `--pm-danger` (`#dc2626`); the `--color-danger-*` scale
- **Warning:** `--color-warning-500` (`#f59e0b`)
- **Info:** `--color-info-500` (`#3b82f6`)

Use the tokens rather than raw hex values, so light and dark themes stay consistent.

### Typography

- **UI font:** IBM Plex Sans; **numbers and code:** IBM Plex Mono. Both are self-hosted (`src/styles/fonts`), never fetched from Google.
- **Scale:** 12px–36px, weights 400–700

### Spacing

- **Base unit:** 4px
- **Scale:** 4/8/12/16/20/24/32/40/48/64/80/96

### Layout

- **Sidebar:** `--pm-sidebar-w` (248px)
- **Breakpoints:** sm(640) / md(768) / lg(1024) / xl(1280) / 2xl(1536)
- Every page must fit a 390px phone without horizontal scrolling.

### Animation

- **Fast:** 100ms, **Base:** 200ms, **Slow:** 300ms
- **Easing:** ease-in-out for most, bounce for delight moments
- Respect `prefers-reduced-motion`

## Coding Conventions

### TypeScript

- Strict mode enabled. No `any` types.
- Use interfaces (not type aliases) for component props.
- All props interfaces follow the naming pattern: `ComponentNameProps`.
- Export shared types from `src/types/`.

### Components

- Use shadcn/ui as the base. Extend with Radix primitives when needed.
- Every component must support keyboard navigation and screen readers (WCAG 2.1 AA).
- Use Framer Motion for animations, behind `prefers-reduced-motion` checks.
- Keep logic that can be tested (calculations, formatting, rules) in `src/lib` functions with unit tests, not inside components.

### State Management

- **The user's data** (portfolios, settings, watchlist, journal, theses, order plans, Ask) lives on the server, read by server components or through the API routes. Browser storage holds only per-browser conveniences, keyed to the signed-in user (`src/lib/storage`).
- **Global UI state** (sidebar open, theme) → Zustand.
- **Form state** → React Hook Form + Zod validation.
- **URL state** (filters, active tab, `?account=`) → Next.js `searchParams`.

### Styling

- Tailwind utility classes first; shared CSS only where utilities can't express it.
- Use the CSS custom properties from `src/app/globals.css` for design tokens.
- Responsive: mobile-first approach with Tailwind breakpoint prefixes.

### Data

- Every figure is the user's own data or carries a **Sample** tag (`SampleTag`, `SampleDataNotice`), hideable in Settings › Data. Never invent a number to fill a card: no made-up prices, deltas, sparklines or commissions.
- Prices are stored daily closes from the nightly ingest, not live quotes; say so where it matters.
- Nothing in the app is investment advice, and Atlas never places trades or moves money.

## Performance Targets

- **FCP:** < 1.2s
- **LCP:** < 2.5s
- **CLS:** < 0.1
- **Bundle:** < 200KB gzipped (use code-splitting)
- **Chart render:** < 100ms
- **Table render:** < 100ms for 1000+ rows
- Lazy-load Lightweight Charts, the Strategy Builder, and other heavy modules.

## Accessibility (WCAG 2.1 AA)

- Color contrast: 4.5:1 normal text, 3:1 large text/UI components
- All interactive elements keyboard-accessible with visible focus indicators
- ARIA labels on all icons, charts, and non-text content
- Form errors announced to screen readers
- Semantic HTML (`<nav>`, `<main>`, `<section>`, `<article>`), one `<h1>` per page
- Test with keyboard, screen reader, 200% zoom, and reduced motion

## Where the work stands

The production launch plan (phases 0–5) is tracked in the launch tracker; `docs/current-focus.md` summarises what each destination shows and what comes next.
