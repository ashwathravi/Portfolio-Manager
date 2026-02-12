# CLAUDE.md — Atlas Wealth (Portfolio Manager)

## Project Overview

**Atlas Wealth** is a Personal Investment Operating System — a comprehensive wealth management platform with four interconnected modules:

1. **Performance Tracker** — Real-time account aggregation, net worth calculation, performance analytics
2. **Research** — Structured thesis development, evidence capture, decision journaling
3. **Strategy & Backtesting** — Rule-based strategy builder with backtesting engine
4. **Execution** — Controlled order execution with constraint-based guardrails

The full UX specification lives in `docs/Atlas-Wealth-UX-Prototype-Spec.md` (4,573 lines, 148KB). Always consult this spec before building any component or page.

## Tech Stack

| Category | Technology | Notes |
| :--- | :--- | :--- |
| Framework | Next.js 15+ (App Router) | Server Components, streaming SSR |
| UI | React 19 + TypeScript 5.3+ | Strict mode, concurrent features |
| Styling | Tailwind CSS v4 | Utility-first, 4px base spacing unit |
| Components | shadcn/ui + Radix UI | Accessible, copy-paste architecture |
| Tables | TanStack Table v8+ | Headless, virtualized for 1000+ rows |
| Server State | TanStack Query v5 | Cache: 30s portfolio, 5min market, 30min settings |
| Client State | Zustand v4+ | Lightweight global UI state |
| Forms | React Hook Form v7+ + Zod v3+ | Uncontrolled components, schema validation |
| Charts | Recharts (standard) + Lightweight Charts (candlestick) | Lazy-load Lightweight Charts |
| Animation | Framer Motion v10+ | GPU-accelerated, declarative |
| DnD | @dnd-kit | Headless, accessible drag-and-drop |
| Dates | date-fns v3+ | Modular, lightweight |
| Testing | Vitest + React Testing Library | Unit + component tests |
| Linting | ESLint (eslint-config-next) + Prettier | Enforced formatting |

## Commands

```bash
# Development
npm run dev          # Start dev server
npm run build        # Production build
npm run start        # Start production server

# Quality
npm run lint         # ESLint
npm run format       # Prettier
npm run test         # Vitest
npm run test:watch   # Vitest watch mode
```

## Project Structure (Target)

```text
src/
├── app/                          # Next.js App Router pages
│   ├── layout.tsx                # Root layout with AppShell
│   ├── page.tsx                  # Dashboard (/)
│   ├── portfolios/[id]/          # Portfolio Detail
│   ├── performance/              # Performance Deep Dive
│   ├── accounts/                 # Account Linking
│   ├── research/
│   │   ├── theses/[id]/          # Thesis Workspace
│   │   └── journal/              # Decision Journal
│   ├── strategies/
│   │   ├── builder/              # Strategy Builder (7-step wizard)
│   │   └── [id]/backtests/[backtestId]/ # Backtest Results
│   └── execution/
│       ├── planner/              # Order Planner
│       └── active/               # Execution Monitor
├── components/
│   ├── layout/                   # AppShell, Sidebar, TopBar, PageHeader, Panel, SplitView
│   ├── navigation/               # SideNav, TabNav, Breadcrumbs, CommandPalette
│   ├── data-display/             # StatCard, MetricTile, DataTable, SparklineCell, etc.
│   ├── charts/                   # TimeSeriesChart, AllocationDonut, DrawdownChart, etc.
│   ├── forms/                    # SearchInput, FilterBar, DateRangePicker, RuleBuilder, etc.
│   ├── feedback/                 # Toast, Alert, EmptyState, LoadingSkeleton, etc.
│   └── specialized/              # ThesisCard, JournalEntry, StrategyLifecycleBadge, etc.
├── lib/
│   ├── stores/                   # Zustand stores
│   ├── hooks/                    # Custom hooks (TanStack Query wrappers, etc.)
│   ├── utils/                    # Formatters, calculations, helpers
│   └── validators/               # Zod schemas
├── types/                        # TypeScript interfaces (50+ defined in spec)
└── mock-data/                    # Static mock data for prototype
```

## Core Principles

These principles from the spec must guide every implementation decision:

- **Truth over vibes** — Show complete data lineage. Never hide reconciliation status. Display confidence levels.
- **Make thinking explicit** — Use thesis templates, evidence frameworks. Track counterarguments.
- **Guardrails by default** — Realistic backtest assumptions (slippage, fees). Execution constraints. Approval workflows.
- **Progressive autonomy** — Staged confidence levels before earning automation.

## Design System

### Colors

- **Primary:** Indigo scale (`#6366f1` as primary-500)
- **Success/Gains:** Emerald (`#10b981`)
- **Danger/Losses:** Red (`#ef4444`)
- **Warning:** Amber (`#f59e0b`)
- **Info:** Blue (`#3b82f6`)
- **Neutrals:** Gray scale from `#ffffff` to `#111827`

### Typography

- **UI font:** Inter (sans-serif)
- **Code font:** JetBrains Mono (monospace)
- **Scale:** 12px–36px, weights 400–700

### Spacing

- **Base unit:** 4px
- **Scale:** 4/8/12/16/20/24/32/40/48/64/80/96

### Layout

- **Sidebar:** 256px expanded, 64px collapsed
- **TopBar:** 64px fixed height
- **Content max-width:** varies by page
- **Breakpoints:** sm(640) / md(768) / lg(1024) / xl(1280) / 2xl(1536)

### Animation

- **Fast:** 100ms, **Base:** 200ms, **Slow:** 300ms
- **Easing:** ease-in-out for most, bounce for delight moments
- Respect `prefers-reduced-motion`

## Coding Conventions

### TypeScript

- Strict mode enabled. No `any` types.
- Use interfaces (not type aliases) for component props — they are defined in the spec.
- All props interfaces follow the naming pattern: `ComponentNameProps`.
- Export types from `src/types/`.

### Components

- Use shadcn/ui as the base. Extend with Radix primitives when needed.
- Every component must support keyboard navigation and screen readers (WCAG 2.1 AA).
- Use Framer Motion for all animations — wrap in `prefers-reduced-motion` checks.
- Components follow the spec's interface definitions exactly.

### State Management

- **Server data** (portfolios, market data, etc.) → TanStack Query with specified stale times.
- **Global UI state** (sidebar open, active portfolio, theme) → Zustand.
- **Form state** → React Hook Form + Zod validation.
- **URL state** (filters, pagination, active tab) → Next.js `searchParams`.
- Use optimistic updates for mutations.

### Styling

- Tailwind utility classes only — no custom CSS files unless absolutely necessary.
- Use CSS custom properties for design tokens (defined in spec section 3.1).
- Responsive: mobile-first approach with Tailwind breakpoint prefixes.

### Data

- All mock data must match the TypeScript interfaces defined in spec section 10.
- Use realistic financial data (proper ticker symbols, plausible returns, etc.).

## Performance Targets

- **FCP:** < 1.2s
- **LCP:** < 2.5s
- **CLS:** < 0.1
- **Bundle:** < 200KB gzipped (use code-splitting)
- **Chart render:** < 100ms
- **Table render:** < 100ms for 1000+ rows
- Lazy-load Lightweight Charts, Strategy Builder, and other heavy modules.

## Accessibility (WCAG 2.1 AA)

- Color contrast: 4.5:1 normal text, 3:1 large text/UI components
- All interactive elements keyboard-accessible with visible focus indicators
- ARIA labels on all icons, charts, and non-text content
- Form errors announced to screen readers
- Semantic HTML (`<nav>`, `<main>`, `<section>`, `<article>`)
- Test with keyboard, screen reader, 200% zoom, and reduced motion

## Key Pages (10)

Refer to spec section 5 for full details on each page:

1. **Dashboard** `/` — Net worth hero, portfolio cards, activity feed, market movers
2. **Portfolio Detail** `/portfolios/:id` — Holdings, Performance, Allocation, Transactions, Alerts tabs
3. **Performance** `/performance` — Metrics, equity curves, attribution, benchmarks
4. **Account Linking** `/accounts` — Connected accounts, OAuth flow, reconciliation
5. **Thesis Workspace** `/research/theses/:id` — Structured editor, evidence panel, health gauge
6. **Decision Journal** `/research/journal` — Timeline entries, outcome tracking
7. **Strategy Builder** `/strategies/builder` — 7-step wizard + canvas mode
8. **Backtest Results** `/strategies/:id/backtests/:backtestId` — Metrics, equity curve, trade log
9. **Order Planner** `/execution/planner` — Order table, constraint validation, approval
10. **Execution Monitor** `/execution/active` — Active orders, fill tracking, kill switch

## Component Library (35+)

Components are fully specified in spec section 3.2 with TypeScript interfaces, variants, states, and responsive behavior. Categories:

- **Layout:** AppShell, Sidebar, TopBar, PageHeader, ContentArea, Panel, SplitView
- **Navigation:** SideNav, TabNav, Breadcrumbs, CommandPalette
- **Data Display:** StatCard, MetricTile, DataTable, SparklineCell, PerformanceBadge, ReconciliationIndicator
- **Charts:** TimeSeriesChart, AllocationDonut, DrawdownChart, AttributionWaterfall, HeatmapGrid, CandlestickChart
- **Forms:** SearchInput, FilterBar, DateRangePicker, TickerAutocomplete, TagInput, SliderInput, RuleBuilder
- **Feedback:** Toast, Alert, EmptyState, LoadingSkeleton, ProgressIndicator, ConfirmationDialog
- **Specialized:** ThesisCard, JournalEntry, StrategyLifecycleBadge, OrderRow, ConstraintEditor, KillSwitchButton

## Build Phases

1. **Phase 1:** Environment setup, design tokens, layout primitives
2. **Phase 2:** Component library (35+ components)
3. **Phase 3:** Page implementation (10 pages)
4. **Phase 4:** Data integration, interactions, animations, state management
5. **Phase 5:** Performance optimization, accessibility, responsiveness
6. **Phase 6:** Testing (unit, component, integration, E2E)
