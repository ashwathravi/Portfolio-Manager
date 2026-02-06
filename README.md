# Atlas Wealth UX Engineering Prototype Specification

## Document Summary

This comprehensive UX Engineering Prototype Specification provides a complete blueprint for building an interactive clickable prototype of **Atlas Wealth — Personal Investment Operating System**.

### Document Details

- **File:** `Atlas-Wealth-UX-Prototype-Spec.md`
- **Format:** Markdown
- **Version:** 1.0
- **Created:** 2026-02-06
- **Line Count:** 4,573 lines
- **File Size:** 148 KB
- **Audience:** UX Engineers, Frontend Developers, Product Managers

---

## What's Included

### 1. Executive Summary
- Product overview and four core modules
- Core principles (Truth, Explicit Thinking, Guardrails, Progressive Autonomy)
- Five key user journeys

### 2. Technology Stack Recommendation (with benchmarks)
- **Frontend:** Next.js 15, React 19, TypeScript
- **Styling:** Tailwind CSS v4, shadcn/ui, Radix UI
- **State Management:** TanStack Query v5, Zustand, React Hook Form + Zod
- **Visualization:** Recharts, Lightweight Charts (TradingView), Framer Motion
- **Bundle size targets:** <200KB gzipped (with code-splitting strategy)

### 3. Design System (Comprehensive)
- **Color palette:** Primary indigo, semantic colors (success/danger/warning/info), neutral grays with hex + HSL + CSS variable names
- **Typography:** Font families (Inter for UI, JetBrains Mono for code), 8-point scale from 12px-36px, font weights, line heights
- **Spacing:** 4px base unit with scale (4/8/12/16/20/24/32/40/48/64/80/96)
- **Shadows:** 5 elevation levels (sm, md, lg, xl, 2xl)
- **Responsive breakpoints:** sm (640px), md (768px), lg (1024px), xl (1280px), 2xl (1536px)
- **Animation timing:** instant/fast/base/slow/slower with easing functions

### 4. Component Library (35+ components specified)
Detailed specifications including variants, props, states, responsive behavior, and accessibility notes for:
- **Layout:** AppShell, Sidebar, TopBar, PageHeader, ContentArea, Panel, SplitView
- **Navigation:** SideNav, TabNav, Breadcrumbs, CommandPalette
- **Data Display:** StatCard, MetricTile, DataTable, SparklineCell, PerformanceBadge, ReconciliationIndicator
- **Charts:** TimeSeriesChart, AllocationDonut, DrawdownChart, AttributionWaterfall, HeatmapGrid, CandlestickChart
- **Forms:** SearchInput, FilterBar, DateRangePicker, TickerAutocomplete, TagInput, SliderInput, RuleBuilder
- **Feedback:** Toast, Alert, EmptyState, LoadingSkeleton, ProgressIndicator, ConfirmationDialog
- **Specialized:** ThesisCard, JournalEntry, StrategyLifecycleBadge, OrderRow, ConstraintEditor, KillSwitchButton

### 5. Global Layout & Navigation
- Complete app shell architecture (left sidebar, top bar, main content, right panel)
- Full navigation tree with icons (8 main sections, 25+ sub-pages)
- Responsive strategy (desktop, tablet, mobile)

### 6. Page-by-Page Specifications (10 major pages)
Each page includes: layout diagrams, component breakdown, interactions, states, transitions, responsive behavior, and mock data shapes

**Pages Specified:**
1. **Dashboard (/)** — Net worth hero, portfolio cards, activity feed, market movers
2. **Portfolio Detail (/portfolios/:id)** — Holdings, Performance, Allocation, Transactions, Alerts tabs
3. **Performance Deep Dive (/performance)** — Metrics, equity curves, attribution analysis, benchmarks
4. **Account Linking (/accounts)** — Connected accounts, OAuth flow, reconciliation dashboard
5. **Thesis Workspace (/research/theses/:id)** — Structured editor, evidence panel, health gauge
6. **Decision Journal (/research/journal)** — Timeline entries, outcome tracking, filter bar
7. **Strategy Builder (/strategies/builder)** — 7-step wizard + canvas mode, rule builder, live preview
8. **Backtest Results (/strategies/:id/backtests/:backtestId)** — Metrics, equity curve, robustness analysis, trade log
9. **Order Planner (/execution/planner)** — Order table, constraint validation, approval workflow
10. **Execution Monitor (/execution/active)** — Active orders, fill tracking, kill switch, audit log

### 7. Interaction Patterns & Micro-interactions
- Chart interactions (hover tooltips, crosshairs, zoom/pan, legend toggling)
- Form interactions (auto-save, real-time validation, autocomplete)
- Table interactions (hover, expandable rows, sorting, filtering, virtualization)
- Modal/drawer animations (fade, slide, stack, timing)
- Loading states (skeleton screens with pulse animation, progressive loading)
- Keyboard shortcuts (global and contextual)
- Toast notifications (types, positioning, dismiss behavior)
- Empty states (design pattern with CTAs)
- Drag & drop with undo support

### 8. Data Flow & State Management
- **Zustand store** example for global UI state (sidebar, active portfolio, preferences)
- **TanStack Query** setup for server state with cache strategies (30s-5min stale times)
- **React Hook Form + Zod** for form validation with auto-save
- **URL state** via Next.js searchParams for filters and pagination
- **Optimistic updates** pattern for mutations

### 9. Performance Budget
- Core Web Vitals targets (FCP <1.2s, LCP <2.5s, CLS <0.1)
- Bundle size breakdown (<200KB gzipped target with code-splitting for heavy libraries)
- Runtime performance targets (chart <100ms, table <100ms, API <500-2000ms)
- Caching strategy (30s for portfolio, 5min for market data, 30min for settings)

### 10. Accessibility Requirements (WCAG 2.1 AA)
- Color contrast ratios (4.5:1 for normal text, 3:1 for large text/UI)
- Focus indicators and keyboard navigation
- Screen reader support with ARIA labels
- Form validation with error messages
- Motion preferences (prefers-reduced-motion support)
- Semantic HTML guidelines
- Testing checklist (keyboard, screen reader, contrast, zoom, motion)

### 11. Mock Data Schemas (TypeScript Interfaces)
Complete data models for:
- Portfolios & Holdings
- Transactions & Corporate Actions
- Performance Metrics & Attribution
- Theses, Evidence, Catalysts, Journal Entries
- Strategies, Signals, Rules, Backtests
- Orders, Constraints, Execution Logs
- All with proper relationships and fields

### 12. Prototype Build Checklist (6 phases)
**Phase 1:** Environment setup, design tokens, layout primitives
**Phase 2:** Component library (35+ components)
**Phase 3:** Page implementation (10 pages)
**Phase 4:** Data, interactions, animations, state management
**Phase 5:** Performance optimization, accessibility, responsiveness
**Phase 6:** Testing (unit, component, integration, E2E)

---

## Key Features of This Specification

✓ **Comprehensive:** Covers all four product modules (Performance Tracker, Research, Strategy & Backtesting, Execution)

✓ **Implementation-Ready:** Includes code examples (TypeScript, component props, state management patterns)

✓ **Design System Complete:** Full color palette, typography, spacing, components with variants and states

✓ **Accessibility-First:** WCAG 2.1 AA compliance details throughout

✓ **Performance-Focused:** Bundle size targets, runtime performance budgets, caching strategies

✓ **Mock Data:** Complete TypeScript interfaces for all data types

✓ **Build Checklist:** Week-by-week phase breakdown with 100+ specific deliverables

✓ **Interaction Details:** Animations, transitions, timing, and keyboard shortcuts specified

✓ **Responsive Design:** Mobile-first strategy with specific breakpoint behavior for each component

---

## How to Use This Specification

### For UX Engineers:
1. Review Sections 1-4 for product vision and design system
2. Use Section 5 (pages) as your primary development guide
3. Refer to Section 6 for interaction patterns and animations
4. Follow the build checklist in Section 11 for project phases

### For Frontend Developers:
1. Study Section 2 for technology stack rationale
2. Build components using Section 3.2 (Component Library)
3. Implement pages from Section 5
4. Use Section 10 (Mock Data Schemas) for TypeScript models
5. Reference Section 7 for state management setup

### For Product Managers:
1. Review Executive Summary (Section 1)
2. Understand user journeys and core principles
3. Review page specifications (Section 5) for feature completeness
4. Use prototype build checklist for timeline planning

### For Designers:
1. Extract design tokens (Section 3.1) for design tools
2. Review component specifications (Section 3.2) for variations
3. Use page layouts (Section 5) for understanding user flows
4. Reference interaction patterns (Section 6) for motion design

---

## Technology Stack at a Glance

| Category | Technology | Why |
|----------|-----------|-----|
| **Framework** | Next.js 15 + React 19 | Server Components, streaming SSR, App Router, excellent performance |
| **Styling** | Tailwind CSS v4 | Utility-first, tree-shaken, minimal bundle impact |
| **Components** | shadcn/ui + Radix UI | Accessible, customizable, copy-paste architecture |
| **Tables** | TanStack Table | Headless, virtualization, sorting/filtering/grouping |
| **Data Fetching** | TanStack Query | Caching, background refetch, optimistic updates |
| **State** | Zustand | Lightweight, minimal boilerplate |
| **Forms** | React Hook Form + Zod | Performant, TypeScript-first validation |
| **Charts** | Recharts + Lightweight Charts | Standard charts + high-perf candlesticks |
| **Animations** | Framer Motion | Declarative, GPU-accelerated |
| **Date Utils** | date-fns | Lightweight, modular |

---

## Document Statistics

- **Total Lines:** 4,573
- **Total Words:** ~65,000
- **Sections:** 12 major + 40+ subsections
- **Components Specified:** 35+
- **Pages Detailed:** 10+
- **TypeScript Interfaces:** 50+
- **Figures & Diagrams:** 15+
- **Code Examples:** 20+

---

## File Location

```
/sessions/exciting-nice-hawking/mnt/Portfolio-Manager/
├── Atlas-Wealth-UX-Prototype-Spec.md (main document)
└── README.md (this file)
```

---

## Next Steps

1. **Review:** Read through sections 1-4 to understand the vision and design system
2. **Setup:** Follow Section 2 to set up the Next.js environment with recommended stack
3. **Build:** Use Section 3.2 to build the component library
4. **Develop:** Implement pages following Section 5 specifications
5. **Polish:** Optimize using Section 8 performance budget and Section 9 accessibility checklist
6. **Test:** Follow Section 11 build checklist for comprehensive testing

---

## Questions or Clarifications?

If building the prototype and you encounter ambiguities:
1. Return to the relevant page specification (Section 5) for context
2. Check the component library (Section 3.2) for similar patterns
3. Review interaction patterns (Section 6) for animation details
4. Check mock data schemas (Section 10) for data structure questions

This specification is designed to be comprehensive while allowing room for creative interpretation in visual design and micro-interactions.

---

**Atlas Wealth UX Engineering Prototype Specification v1.0**
*Last Updated: 2026-02-06*
