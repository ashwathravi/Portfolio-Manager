# Atlas Wealth — UX Engineering Prototype Specification

**Document Version:** 1.0
**Last Updated:** 2026-02-06
**Audience:** UX Engineers, Frontend Developers
**Purpose:** Complete clickable interactive prototype specification covering all four product modules

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Technology Stack Recommendation](#2-technology-stack-recommendation)
3. [Design System](#3-design-system)
4. [Global Layout & Navigation](#4-global-layout--navigation)
5. [Page-by-Page Specifications](#5-page-by-page-specifications)
6. [Interaction Patterns & Micro-interactions](#6-interaction-patterns--micro-interactions)
7. [Data Flow & State Management](#7-data-flow--state-management)
8. [Performance Budget](#8-performance-budget)
9. [Accessibility Requirements](#9-accessibility-requirements)
10. [Mock Data Schemas](#10-mock-data-schemas)
11. [Prototype Build Checklist](#11-prototype-build-checklist)

---

## 1. Executive Summary

### Product Overview

**Atlas Wealth — Personal Investment Operating System** is a comprehensive wealth management platform built on four interconnected modules:

1. **Performance Tracker** — Real-time account aggregation, net worth calculation, and performance analytics
2. **Research** — Structured thesis development, evidence capture, and decision journaling
3. **Strategy & Backtesting** — Rule-based strategy builder with robust backtesting engine
4. **Execution** — Safe, controlled order execution with constraint-based guardrails

### Core Principles

- **Truth over vibes:** Complete data lineage and reconciliation visibility
- **Make thinking explicit:** Thesis templates, evidence frameworks, counterargument tracking
- **Guardrails by default:** Realistic backtest assumptions, execution constraints, approval workflows
- **Progressive autonomy:** Earn automation through staged confidence levels

### Key User Journeys

1. Connect and trust net worth (account linking → reconciliation → portfolio view)
2. Understand performance and drivers (portfolio analytics → attribution → benchmarks)
3. Create and track thesis (research workspace → hypothesis development → evidence collection)
4. Build and validate strategy (strategy builder → backtest → robustness analysis)
5. Execute safely (order planning → constraint validation → approval → monitoring)

---

## 2. Technology Stack Recommendation

### 2.1 Frontend Framework Stack

| Technology | Version | Purpose | Justification |
|-----------|---------|---------|---------------|
| **Next.js** | 15+ | Meta-framework | App Router, Server Components, streaming SSR, built-in optimization |
| **React** | 19 | UI library | Concurrent features, automatic batching, better performance |
| **TypeScript** | 5.3+ | Language | Type safety for complex data flows, excellent IDE support |
| **Tailwind CSS** | 4+ | Styling | Tree-shaken utility classes, minimal bundle impact (~15KB gzipped) |
| **shadcn/ui** | Latest | Component library | Copy-paste components, fully customizable, no vendor lock-in |
| **Radix UI** | Latest | Primitives | Accessible headless components, zero-styled foundation |

### 2.2 Data & State Management

| Technology | Version | Purpose | Justification |
|-----------|---------|---------|---------------|
| **TanStack Query** | 5+ | Server state | Automatic caching, background refetching, optimistic updates for data-heavy app |
| **TanStack Table** | 8+ | Table rendering | Headless, virtualization for 1000+ rows, sorting/filtering/grouping |
| **Zustand** | 4+ | Client state | Lightweight (~2KB), minimal boilerplate, excellent DX |
| **React Hook Form** | 7+ | Form state | Minimal re-renders, uncontrolled components, great perf |
| **Zod** | 3+ | Schema validation | TypeScript-first, composable, excellent error messages |

### 2.3 Visualization & Charts

| Technology | Version | Purpose | Justification |
|-----------|---------|---------|---------------|
| **Recharts** | 2+ | Standard charts | Composable, responsive, great for allocation/attribution charts |
| **Lightweight Charts** | Latest | Financial charts | High-performance candlestick charts, <100ms render for 5y daily data |
| **date-fns** | 3+ | Date utilities | Lightweight (~13KB), modular imports, excellent for time series |

### 2.4 Interactions & Animations

| Technology | Version | Purpose | Justification |
|-----------|---------|---------|---------------|
| **Framer Motion** | 10+ | Animations | Declarative, GPU-accelerated, excellent gesture support |
| **@dnd-kit** | Latest | Drag-and-drop | Modern headless library, accessible, performant |

### 2.5 Bundle Size Analysis

```
Initial JS (gzipped):
├─ Next.js runtime:          ~35KB
├─ React:                    ~42KB
├─ Tailwind CSS:             ~15KB
├─ shadcn/ui:               ~20KB (typical 5-8 components)
├─ TanStack Query:           ~15KB
├─ Recharts:                 ~45KB
├─ Lightweight Charts:       ~20KB (lazy-loaded)
├─ Framer Motion:            ~28KB
├─ date-fns:                 ~13KB
└─ App code + utilities:     ~40KB
────────────────────────────────────
Total target:               ~273KB (aim for <200KB via code splitting)
```

**Optimization Strategy:**
- Code-split chart libraries (Lightweight Charts lazy-loaded on /performance)
- Tree-shake unused Recharts components
- Dynamic imports for Strategy Builder (complex UI)
- Server-side rendering for critical path (portfolio list, dashboard)
- Service Worker for offline caching (secondary data)

### 2.6 Development Dependencies

```json
{
  "devDependencies": {
    "eslint": "^8.50.0",
    "eslint-config-next": "^15.0.0",
    "prettier": "^3.0.0",
    "tailwindcss": "^4.0.0",
    "postcss": "^8.4.31",
    "autoprefixer": "^10.4.16",
    "@types/react": "^18.2.0",
    "@types/node": "^20.0.0",
    "vitest": "^1.0.0",
    "@testing-library/react": "^14.0.0",
    "@testing-library/jest-dom": "^6.0.0"
  }
}
```

---

## 3. Design System

### 3.1 Design Tokens

#### 3.1.1 Color Palette

**Primary Colors (Deep Navy/Indigo)**
```css
--color-primary-50: #f0f4ff;
--color-primary-100: #e6ebff;
--color-primary-200: #cdd7ff;
--color-primary-300: #b4c3ff;
--color-primary-400: #9bafff;
--color-primary-500: #6366f1;    /* Primary brand color */
--color-primary-600: #4f46e5;
--color-primary-700: #4338ca;
--color-primary-800: #3730a3;
--color-primary-900: #312e81;
```

**Semantic Colors**
```css
/* Success - Gains, Positive Returns */
--color-success-50: #f0fdf4;
--color-success-500: #10b981;    /* Emerald */
--color-success-600: #059669;
--color-success-700: #047857;

/* Danger - Losses, Negative Returns */
--color-danger-50: #fef2f2;
--color-danger-500: #ef4444;     /* Red */
--color-danger-600: #dc2626;
--color-danger-700: #b91c1c;

/* Warning - Neutral/Warnings */
--color-warning-50: #fffbeb;
--color-warning-500: #f59e0b;    /* Amber */
--color-warning-600: #d97706;
--color-warning-700: #b45309;

/* Info */
--color-info-50: #eff6ff;
--color-info-500: #3b82f6;       /* Blue */
--color-info-600: #2563eb;
--color-info-700: #1d4ed8;

/* Neutral */
--color-neutral-0: #ffffff;
--color-neutral-50: #f9fafb;
--color-neutral-100: #f3f4f6;
--color-neutral-200: #e5e7eb;
--color-neutral-300: #d1d5db;
--color-neutral-400: #9ca3af;
--color-neutral-500: #6b7280;
--color-neutral-600: #4b5563;
--color-neutral-700: #374151;
--color-neutral-800: #1f2937;
--color-neutral-900: #111827;
```

#### 3.1.2 Typography

**Font Families**
```css
--font-family-sans: 'Inter', system-ui, -apple-system, sans-serif;
--font-family-mono: 'JetBrains Mono', monospace;
```

**Font Sizes & Weights**
```css
--text-xs: 12px;      /* line-height: 16px; */
--text-sm: 14px;      /* line-height: 20px; */
--text-base: 16px;    /* line-height: 24px; */
--text-lg: 18px;      /* line-height: 28px; */
--text-xl: 20px;      /* line-height: 28px; */
--text-2xl: 24px;     /* line-height: 32px; */
--text-3xl: 30px;     /* line-height: 36px; */
--text-4xl: 36px;     /* line-height: 40px; */

--font-weight-400: 400;  /* Regular */
--font-weight-500: 500;  /* Medium */
--font-weight-600: 600;  /* Semibold */
--font-weight-700: 700;  /* Bold */
```

**Text Styles**
```css
/* Labels & Small Text */
--text-label: 12px / 600;

/* Body */
--text-body-sm: 14px / 400;
--text-body-md: 16px / 400;
--text-body-lg: 18px / 400;

/* Headings */
--text-h1: 36px / 700;
--text-h2: 30px / 700;
--text-h3: 24px / 600;
--text-h4: 20px / 600;
--text-h5: 18px / 600;
--text-h6: 16px / 600;

/* Code */
--text-code: 13px / 400 / mono;
```

#### 3.1.3 Spacing Scale (4px base unit)

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-20: 80px;
--space-24: 96px;
```

#### 3.1.4 Border Radius

```css
--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 12px;
--radius-xl: 16px;
--radius-full: 9999px;
```

#### 3.1.5 Shadows (Elevation System)

```css
--shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1),
             0 2px 4px -1px rgba(0, 0, 0, 0.06);
--shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1),
             0 4px 6px -2px rgba(0, 0, 0, 0.05);
--shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1),
             0 10px 10px -5px rgba(0, 0, 0, 0.04);
--shadow-2xl: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
```

#### 3.1.6 Responsive Breakpoints

```css
--breakpoint-sm: 640px;
--breakpoint-md: 768px;
--breakpoint-lg: 1024px;
--breakpoint-xl: 1280px;
--breakpoint-2xl: 1536px;
```

#### 3.1.7 Animation Timing

```css
--duration-instant: 0ms;
--duration-fast: 100ms;
--duration-base: 200ms;
--duration-slow: 300ms;
--duration-slower: 500ms;

--easing-in: cubic-bezier(0.4, 0, 1, 1);
--easing-out: cubic-bezier(0, 0, 0.2, 1);
--easing-in-out: cubic-bezier(0.4, 0, 0.2, 1);
--easing-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
```

### 3.2 Component Library Specifications

#### 3.2.1 Layout Components

**AppShell**
```typescript
interface AppShellProps {
  children: React.ReactNode;
  sidebarOpen?: boolean;
  rightPanelOpen?: boolean;
}
```
- Provides top-level layout structure
- Manages sidebar/right panel states
- Responsive: full sidebar (desktop) → collapsed sidebar (tablet) → bottom nav (mobile)

**Sidebar**
```typescript
interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  navItems: NavItem[];
  collapsedWidth?: number;  // 64px default
  expandedWidth?: number;   // 256px default
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
  isActive?: boolean;
  submenu?: NavItem[];
}
```
- Collapsible with smooth animation (200ms ease-out)
- Shows labels on hover when collapsed
- Indicates active route with left accent border (4px primary-500)
- Smooth background color on hover

**TopBar**
```typescript
interface TopBarProps {
  onSidebarToggle: () => void;
  onCommandPaletteOpen: () => void;
  currentUser?: UserProfile;
  notificationCount?: number;
}
```
- Fixed height: 64px
- Left: sidebar toggle icon
- Center: page breadcrumbs or title
- Right: search trigger (⌘K), notifications, user menu
- Sticky on scroll

**PageHeader**
```typescript
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
}
```
- Title (h1), optional subtitle, action buttons
- Breadcrumb navigation
- Sticky below top bar

**ContentArea**
```typescript
interface ContentAreaProps {
  children: React.ReactNode;
  padding?: 'sm' | 'md' | 'lg';  // 16px | 24px | 32px
  maxWidth?: 'md' | 'lg' | 'xl' | 'full';
}
```
- Main scrollable content
- Responsive padding
- Max-width container for readability

**Panel**
```typescript
interface PanelProps {
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  bordered?: boolean;
  elevation?: 'sm' | 'md' | 'lg';
}
```
- Reusable card-like container
- Optional border, header, footer
- Configurable shadow elevation
- Used throughout for data sections

**SplitView**
```typescript
interface SplitViewProps {
  left: React.ReactNode;
  right: React.ReactNode;
  ratio?: '30-70' | '40-60' | '50-50';
  collapsible?: boolean;
  resizable?: boolean;
}
```
- Two-column layout for thesis workspace
- Optional resizable divider
- Responsive: stacks on tablets, full stack on mobile

#### 3.2.2 Navigation Components

**SideNav** (defined above under Sidebar)

**TabNav**
```typescript
interface TabNavProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  variant?: 'underline' | 'pills' | 'segment';
}

interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number;
  disabled?: boolean;
}
```
- Horizontal tab navigation
- Variants: underline (minimal), pills (rounded bg), segment (filled)
- Smooth underline animation (150ms)

**Breadcrumbs**
```typescript
interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
}
```
- "/" separator between items
- Last item is current page (not clickable)
- Responsive: truncate on mobile

**CommandPalette**
```typescript
interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
  onCommandSelect: (commandId: string) => void;
}

interface Command {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  category?: string;
  action: () => void;
}
```
- Triggered by ⌘K / Ctrl+K
- Searchable command list with categories
- Keyboard navigation (↑↓ arrows, Enter to select, Esc to close)
- Fuzzy matching for search
- Example commands:
  - Go to portfolio...
  - Create thesis...
  - Run backtest...
  - View settings...

#### 3.2.3 Data Display Components

**StatCard**
```typescript
interface StatCardProps {
  label: string;
  value: string | number;
  change?: number;  // percentage
  changeLabel?: string;
  icon?: React.ReactNode;
  color?: 'primary' | 'success' | 'danger' | 'warning' | 'info';
  trend?: 'up' | 'down' | 'neutral';
  loading?: boolean;
  onClick?: () => void;
}
```
- Displays single metric with optional change indicator
- Conditional color based on trend (green up, red down)
- Sparkline miniature optional variant
- Clickable for drill-down navigation

**MetricTile**
```typescript
interface MetricTileProps {
  title: string;
  value: string | number;
  unit?: string;
  subValue?: string;
  chart?: React.ReactNode;
  status?: 'good' | 'warning' | 'bad' | 'neutral';
  footnote?: string;
}
```
- Larger tile format with optional mini-chart
- Status indicator (color-coded bottom bar)
- Good for dashboard grid layouts

**DataTable**
```typescript
interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  pagination?: PaginationState;
  onPaginationChange?: (pagination: PaginationState) => void;
  filtering?: ColumnFiltersState;
  onFilteringChange?: (filtering: ColumnFiltersState) => void;
  virtualized?: boolean;  // For 1000+ rows
  expandableRows?: boolean;
  rowClickHandler?: (row: T) => void;
  dense?: boolean;  // Reduced padding for compact tables
  loading?: boolean;
  emptyMessage?: string;
}
```
- TanStack Table headless component
- Sortable columns (click header, visual indicator)
- Filterable columns (filter icon in header)
- Pagination controls below (prev/next, page input)
- Virtualization for performance (1000+ rows)
- Expandable row details
- Row hover highlight
- Sticky header on scroll

**SparklineCell**
```typescript
interface SparklineCellProps {
  data: number[];
  color?: 'success' | 'danger' | 'neutral';
  height?: number;  // default 32px
  width?: '100%' | number;
  showValue?: boolean;
}
```
- Inline sparkline chart for table cells
- Renders 1-year daily data in ~40px width
- Color coded by trend (green/red/gray)
- Shows current value on hover

**PerformanceBadge**
```typescript
interface PerformanceBadgeProps {
  value: number;  // percentage
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  showArrow?: boolean;
  format?: 'percent' | 'decimal';
}
```
- Color-coded pill badge for returns
- Green (+X%), red (-X%), gray (±X%)
- Optional up/down arrow icon
- Sizes: sm (12px text), md (14px), lg (16px)

**ReconciliationIndicator**
```typescript
interface ReconciliationIndicatorProps {
  status: 'synced' | 'stale' | 'error' | 'reconciling';
  lastSyncTime?: Date;
  errorMessage?: string;
  onRetryClick?: () => void;
}
```
- Status badge with icon
- Shows "Synced 2 min ago" or "Stale" or error message
- Retry button for errors
- Pulse animation for reconciling state

#### 3.2.4 Chart Components

**TimeSeriesChart** (wrapper around Recharts)
```typescript
interface TimeSeriesChartProps {
  data: TimeSeriesDataPoint[];
  series: SeriesConfig[];
  title?: string;
  subtitle?: string;
  height?: number;  // default 300px
  showLegend?: boolean;
  showGrid?: boolean;
  showCrosshair?: boolean;
  tooltip?: CustomTooltip;
  xAxisFormat?: 'date' | 'time';
  yAxisFormat?: 'currency' | 'percent' | 'number';
  interactive?: boolean;
}

interface TimeSeriesDataPoint {
  date: Date;
  [key: string]: number | Date;
}

interface SeriesConfig {
  key: string;
  name: string;
  color?: string;
  type?: 'line' | 'area' | 'bar';
  opacity?: number;
  strokeWidth?: number;
}
```
- Renders line/area/bar charts over time
- Interactive tooltips on hover
- Responsive sizing
- Crosshair on hover (vertical line + label)
- Legend with toggle visibility
- Zooming support (drag to select date range)

**AllocationDonut**
```typescript
interface AllocationDonutProps {
  data: AllocationDataPoint[];
  title?: string;
  innerRadius?: number;  // 0-100 for thickness
  showLabels?: boolean;
  showLegend?: boolean;
  onSegmentClick?: (segment: AllocationDataPoint) => void;
  colors?: string[];
}

interface AllocationDataPoint {
  name: string;
  value: number;
  percentage: number;
}
```
- Pie/donut chart for asset allocation
- Click segments to drill down
- Hover tooltip with value/percentage
- Legend below chart
- Responsive: stacks legend on mobile

**DrawdownChart**
```typescript
interface DrawdownChartProps {
  data: DrawdownDataPoint[];
  maxDrawdown?: number;
  currentDrawdown?: number;
  height?: number;
}

interface DrawdownDataPoint {
  date: Date;
  drawdown: number;  // negative percentage
}
```
- Area chart showing drawdown from peak
- Filled area in danger-600 color
- Highlights max drawdown with annotation
- Current drawdown indicator line

**AttributionWaterfall**
```typescript
interface AttributionWaterfallProps {
  categories: AttributionCategory[];
  totalReturn: number;
  benchmark?: number;
  height?: number;  // default 250px
}

interface AttributionCategory {
  name: string;
  value: number;  // contribution in basis points or percent
  type: 'allocation' | 'selection' | 'interaction';
}
```
- Waterfall chart showing performance attribution
- Bars show positive/negative contributions
- Connecting lines between bars
- Color coded by attribution type

**HeatmapGrid**
```typescript
interface HeatmapGridProps {
  rows: string[];        // Month labels
  columns: string[];     // Year/Sector labels
  data: number[][];      // Heat values (-100 to 100)
  colorScheme?: 'diverging' | 'sequential';
  onCellClick?: (row: number, col: number) => void;
  tooltip?: (value: number) => string;
}
```
- 2D grid for return heatmap (months vs years, or sectors vs factors)
- Color intensity represents magnitude
- Hover tooltip with value
- Useful for robustness analysis

**CandlestickChart**
```typescript
interface CandlestickChartProps {
  data: CandleData[];
  height?: number;  // default 300px
  width?: string;   // default '100%'
  timeframe?: '1m' | '5m' | '15m' | '1h' | '1d' | '1w';
  onTimeframeChange?: (tf: string) => void;
  interactive?: boolean;
  tooltip?: boolean;
}

interface CandleData {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}
```
- High-performance candlestick using Lightweight Charts
- Responsive to window resize
- Optional volume bar chart below
- Zoom/pan support
- Crosshair cursor
- Timeframe selector (1m, 5m, 15m, 1h, 1d, 1w)

#### 3.2.5 Form Components

**SearchInput**
```typescript
interface SearchInputProps {
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  isLoading?: boolean;
  icon?: React.ReactNode;
  debounceMs?: number;  // default 300ms
  className?: string;
}
```
- Text input with search icon
- Debounced onChange callback
- Loading spinner on right
- Clearable button when filled
- Full width by default

**FilterBar**
```typescript
interface FilterBarProps {
  filters: FilterConfig[];
  onFilterChange: (filters: Record<string, any>) => void;
  onClearAll?: () => void;
  compact?: boolean;
}

interface FilterConfig {
  id: string;
  label: string;
  type: 'select' | 'multiselect' | 'daterange' | 'number' | 'text';
  options?: { label: string; value: any }[];
  defaultValue?: any;
  placeholder?: string;
}
```
- Horizontal filter UI with multiple fields
- Shows active filter badges
- "Clear All" button
- Compact mode: collapse to icon button with dropdown on mobile

**DateRangePicker**
```typescript
interface DateRangePickerProps {
  startDate: Date;
  endDate: Date;
  onChange: (startDate: Date, endDate: Date) => void;
  presets?: DatePreset[];
  minDate?: Date;
  maxDate?: Date;
  format?: string;
}

interface DatePreset {
  label: string;
  getValue: () => [Date, Date];
}
```
- Dual calendar UI or single compact input
- Keyboard date entry
- Preset buttons: "Last 7 days", "Last 30 days", "YTD", "Custom"
- Responsive: modal on mobile

**TickerAutocomplete**
```typescript
interface TickerAutocompleteProps {
  value: string;
  onChange: (ticker: string) => void;
  onSelect?: (ticker: string, security: Security) => void;
  placeholder?: string;
  allowFreetext?: boolean;
  className?: string;
}

interface Security {
  ticker: string;
  name: string;
  type: 'stock' | 'etf' | 'mutual_fund' | 'option' | 'future';
  exchange?: string;
}
```
- Typeahead autocomplete for stock tickers
- Shows security name on selection
- Debounced API search
- Keyboard navigation (↑↓ arrows)
- Recent searches shown on focus

**TagInput**
```typescript
interface TagInputProps {
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  allowDuplicates?: boolean;
  maxTags?: number;
  separator?: 'space' | 'comma' | 'enter';
}
```
- Comma/space/enter separated tag input
- Tag pills with X to remove
- Autocomplete suggestions
- Keyboard navigation for suggestions

**SliderInput**
```typescript
interface SliderInputProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label?: string;
  formatValue?: (value: number) => string;
  showValue?: boolean;
  range?: boolean;  // For dual-handle sliders
}
```
- Single or range slider
- Numeric input field alongside
- Formatted display (e.g., "50%" or "$10K")
- Keyboard support (arrow keys)

**RuleBuilder**
```typescript
interface RuleBuilderProps {
  rules: Rule[];
  onRulesChange: (rules: Rule[]) => void;
  availableFields: RuleField[];
  operators?: OperatorConfig[];
  mode?: 'simple' | 'advanced';
}

interface Rule {
  id: string;
  field: string;
  operator: string;
  value: any;
  conjunction?: 'AND' | 'OR';
}

interface RuleField {
  name: string;
  label: string;
  type: 'number' | 'string' | 'date' | 'select';
  operators?: string[];
}
```
- Drag-and-drop rule builder for strategy signals
- Field selector → operator → value
- Add/remove rule buttons
- AND/OR conjunction toggling between rules
- Live preview of matching results
- Advanced mode for nested groups

#### 3.2.6 Feedback Components

**Toast**
```typescript
interface ToastProps {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;  // ms, 0 = persistent
  action?: {
    label: string;
    onClick: () => void;
  };
  onDismiss: () => void;
}
```
- Position: bottom-right corner
- Auto-dismiss after 5s (configurable)
- Slide in/out animation (150ms)
- Closable X button
- Optional action button (e.g., "Undo")

**Alert**
```typescript
interface AlertProps {
  type: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  message: string;
  icon?: React.ReactNode;
  closeable?: boolean;
  onClose?: () => void;
  action?: React.ReactNode;
}
```
- Inline alert box (not dismissing)
- Color-coded background and border
- Icon, title, message
- Optional action button
- Used in-page for warnings/info

**EmptyState**
```typescript
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  illustration?: React.ReactNode;
}
```
- Shown when no data available
- Icon or illustration
- Clear CTA button
- Examples: "No portfolios yet", "No trades executed"

**LoadingSkeleton**
```typescript
interface LoadingSkeletonProps {
  count?: number;
  height?: number | string;
  width?: number | string;
  circle?: boolean;
  className?: string;
}
```
- Pulse animation skeleton matching content shape
- Used for tables, cards, charts
- Never spinners for primary content (bad UX for data apps)

**ProgressIndicator**
```typescript
interface ProgressIndicatorProps {
  current: number;
  total: number;
  label?: string;
  showPercent?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'bar' | 'circle';
}
```
- Linear or circular progress bar
- Shows current/total steps
- Used in wizards, file uploads, order execution

**ConfirmationDialog**
```typescript
interface ConfirmationDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  actionLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDangerous?: boolean;  // Red button for destructive actions
  loading?: boolean;
}
```
- Modal overlay for destructive/irreversible actions
- Title, message, confirm/cancel buttons
- Dangerous variant: red button + confirmatory text input
- Example: "Delete this strategy?" or "Execute orders?"

#### 3.2.7 Specialized Components

**ThesisCard**
```typescript
interface ThesisCardProps {
  thesis: Thesis;
  onClick?: () => void;
  showLinkedTrades?: boolean;
  condensed?: boolean;
}

interface Thesis {
  id: string;
  ticker: string;
  hypothesis: string;
  conviction: 'high' | 'medium' | 'low';
  timeHorizon: string;
  status: 'active' | 'tested' | 'abandoned';
  evidenceCount: number;
  linkedTrades: number;
  lastUpdated: Date;
  healthScore: number;  // 0-100
}
```
- Compact card for thesis list/grid
- Shows ticker, hypothesis excerpt, conviction level
- Health score gauge (visual bar)
- Status badge
- Click to open full thesis

**JournalEntry**
```typescript
interface JournalEntryProps {
  entry: JournalEntry;
  onEdit?: () => void;
  showOutcome?: boolean;
}

interface JournalEntry {
  id: string;
  date: Date;
  ticker: string;
  action: 'buy' | 'sell' | 'hold';
  rationale: string;
  linkedThesis?: string;
  outcome?: {
    realized: boolean;
    returnPercent: number;
    notes: string;
  };
}
```
- Timeline-style entry display
- Date | Ticker | Action | Rationale
- Optional linked thesis link
- Outcome overlay (current vs expected)
- Editable in review mode

**StrategyLifecycleBadge**
```typescript
interface StrategyLifecycleBadgeProps {
  status: 'draft' | 'backtested' | 'approved' | 'staging' | 'live' | 'archived';
  promotable?: boolean;
  onPromote?: () => void;
}
```
- Color-coded badge for strategy status
- "Draft" (gray), "Backtested" (blue), "Approved" (green), "Staging" (amber), "Live" (green+bold), "Archived" (neutral)
- Optional promote button for workflow transitions

**OrderRow**
```typescript
interface OrderRowProps {
  order: Order;
  onClick?: () => void;
  onCancel?: () => void;
  showDetails?: boolean;
}

interface Order {
  id: string;
  ticker: string;
  action: 'buy' | 'sell';
  quantity: number;
  price?: number;
  estimatedCost: number;
  status: 'pending' | 'filled' | 'partial' | 'cancelled' | 'rejected';
  fillPercent?: number;  // For partial fills
  executedAt?: Date;
}
```
- Table row component for order display
- Status indicator with color
- Fill progress bar for partial fills
- Expandable details drawer
- Cancel button for pending orders

**ConstraintEditor**
```typescript
interface ConstraintEditorProps {
  constraint: Constraint;
  onChange: (constraint: Constraint) => void;
  presets?: ConstraintPreset[];
}

interface Constraint {
  id: string;
  name: string;
  type: 'maxPosition' | 'minNotional' | 'sectorLimit' | 'drawdownLimit' | 'turnoverLimit' | 'custom';
  value: number;
  unit?: '%' | '$' | 'shares';
  enabled: boolean;
  priority?: number;
}
```
- Form for editing execution constraints
- Drag-to-reorder constraint priority
- Toggle enable/disable
- Preset templates (e.g., "Conservative", "Growth")

**KillSwitchButton**
```typescript
interface KillSwitchButtonProps {
  isActive: boolean;
  onActivate: () => void;
  loading?: boolean;
  disabled?: boolean;
}
```
- Large, prominent red button for emergency stop
- "Stop All Execution" label
- Requires confirmation dialog
- Shows loading state during execution
- Disabled once activated
- Notification sent to user/admin

---

## 4. Global Layout & Navigation

### 4.1 App Shell Architecture

```
┌─────────────────────────────────────────────────┐
│         TopBar (h=64px, sticky)                 │
│  [≡ Menu]  [Breadcrumb]      [🔍⌘K] [🔔] [👤]  │
├────────────┬───────────────────────────────────┤
│            │                                     │
│  Sidebar   │         ContentArea                │ [Right Panel]
│  (w=256px) │                                     │ (w=320px, optional)
│            │                                     │
│  • Home    │    ┌──────────────────────────┐    │
│  • Ports.  │    │  Page Content             │    │
│  • Accounts│    │                           │    │
│  • Perf.   │    │                           │    │
│  • Research│    │                           │    │
│  • Strategy│    │                           │    │
│  • Exec.   │    └──────────────────────────┘    │
│  • Settings│                                     │
│            │                                     │
└────────────┴───────────────────────────────────┘
```

### 4.2 Sidebar Navigation Tree

```
Atlas Wealth
├─ Home ⌂ (/)
├─ Portfolios 📊
│  ├─ All Portfolios (/portfolios)
│  └─ [Portfolio Name] (/portfolios/:id)
├─ Accounts 🏦
│  ├─ Linked Accounts (/accounts)
│  └─ Add Account (/accounts/add)
├─ Performance 📈
│  ├─ Overview (/performance)
│  ├─ Attribution (/performance/attribution)
│  ├─ Benchmarks (/performance/benchmarks)
│  └─ Tax Analytics (/performance/tax)
├─ Research 🔬
│  ├─ Theses (/research/theses)
│  ├─ Thesis [Name] (/research/theses/:id)
│  ├─ Watchlists (/research/watchlists)
│  ├─ Decision Journal (/research/journal)
│  └─ Evidence Library (/research/evidence)
├─ Strategies ⚙️
│  ├─ All Strategies (/strategies)
│  ├─ Strategy Builder (/strategies/builder)
│  ├─ Strategy [Name] (/strategies/:id)
│  ├─ Backtests (/strategies/:id/backtests)
│  └─ Backtest Results (/strategies/:id/backtests/:backtestId)
├─ Execution ✈️
│  ├─ Order Planner (/execution/planner)
│  ├─ Active Orders (/execution/active)
│  ├─ Order History (/execution/history)
│  ├─ Constraints (/execution/constraints)
│  └─ Audit Log (/execution/audit)
└─ Settings ⚙️
   ├─ Profile (/settings/profile)
   ├─ Integrations (/settings/integrations)
   ├─ Notifications (/settings/notifications)
   ├─ Security (/settings/security)
   └─ Data (/settings/data)
```

### 4.3 Top Bar Components

```
┌──────────────────────────────────────────────────────────┐
│ [☰] [🏠 Dashboard / Portfolios / AAPL]  [🔍⌘K] [🔔2] [👤v]│
│                 Breadcrumb Trail                          │
└──────────────────────────────────────────────────────────┘
```

**Components in TopBar:**
- **Left:** Sidebar toggle (hamburger icon)
- **Center-Left:** Breadcrumbs showing current location
- **Center-Right:** Global search trigger (⌘K)
- **Right:**
  - Notification bell (with badge count)
  - User avatar dropdown (profile, settings, logout)

### 4.4 Responsive Behavior

#### Desktop (≥1280px)
- Full sidebar expanded (256px)
- All navigation visible
- Right panel slides in from right
- Content area has max-width for readability

#### Tablet (768px - 1279px)
- Sidebar collapsed to 64px (icon-only)
- Labels show on hover
- Content area full width
- Right panel as overlay drawer (push from right)
- Bottom tab bar for quick navigation

#### Mobile (< 768px)
- Sidebar completely hidden (hamburger menu)
- Bottom navigation bar (5-6 key sections)
  - Home, Portfolios, Research, Strategies, Execution, More (⋯)
- Content full screen
- Right panel stacks below content

---

## 5. Page-by-Page Specifications

### 5.1 Dashboard (/)

**Route:** `/`

**Layout:**

```
┌─────────────────────────────────────────┐
│ PageHeader: Dashboard                    │
├─────────────────────────────────────────┤
│                                          │
│  ┌──────────────────────────────────┐  │
│  │ Net Worth Hero                    │  │
│  │ $2,450,320  +$12,450 (+0.51%)    │  │
│  │ [Sparkline 1Y]                    │  │
│  │ 📊 Compare Benchmark              │  │
│  └──────────────────────────────────┘  │
│                                          │
│  ┌────────────┬────────────┬────────┐  │
│  │ Portfolio 1│ Portfolio 2│ Watch │  │
│  │ $1.5M      │ $850K      │ Stats │  │
│  │ +2.3%      │ +1.1%      │       │  │
│  │ [Spark]    │ [Spark]    │       │  │
│  └────────────┴────────────┴────────┘  │
│                                          │
│  Quick Actions Row                       │
│  [Link Account] [New Thesis] [Builder]  │
│                                          │
│  ┌──────────────────────────────────┐  │
│  │ What Changed (Activity Feed)      │  │
│  │                                   │  │
│  │ • 2 min ago: AAPL position +5%   │  │
│  │ • 15 min ago: Account synced ✓    │  │
│  │ • 1h ago: Alert triggered         │  │
│  │ • Yesterday: Thesis updated       │  │
│  └──────────────────────────────────┘  │
│                                          │
│  ┌──────────────────────────────────┐  │
│  │ Market Movers (Watchlist)         │  │
│  │ [Gain] TSLA +3.2% | XOM -1.5%    │  │
│  └──────────────────────────────────┘  │
│                                          │
└─────────────────────────────────────────┘
```

**Content Specification:**

1. **Net Worth Hero Card** (full width)
   - Components: StatCard elevated variant
   - Displays: Total net worth, daily change ($ + %), 1Y sparkline
   - Interaction: Click to see net worth breakdown, allocation changes
   - Period selector: default 1D, toggle to 1W, 1M, 3M, 1Y, ALL
   - Loading state: Skeleton matching card layout

2. **Portfolio Summary Grid** (3-column on desktop, stack on mobile)
   - Each portfolio: name, total value, daily return %, 1Y sparkline
   - Component: StatCard
   - Click to navigate to portfolio detail
   - If no portfolios: EmptyState with "Create Portfolio" CTA

3. **Quick Actions Row** (horizontal button group)
   - Buttons:
     - [Link Account] → /accounts/add
     - [New Thesis] → /research/theses/new
     - [Strategy Builder] → /strategies/builder
     - [View Orders] → /execution/active
   - Responsive: Collapse to icon buttons on mobile

4. **What Changed (Activity Feed)**
   - Component: Timeline-style list
   - Items:
     - Transaction updates (holdings changed)
     - Account reconciliation status
     - Price alerts triggered
     - Thesis/strategy updates
     - Trade executions
   - Each item: timestamp (relative), icon, description, link
   - Paginate or infinite scroll (show 10, "Load more")
   - Filter options: type (transaction, alert, update), portfolio

5. **Market Movers Section** (horizontal scroll on mobile)
   - Component: Grid of ticker cards
   - Card shows: ticker, name, current return %, 1D chart
   - Data source: watchlist + top holdings
   - Link each to thesis or ticker research

**Mock Data Shape:**

```typescript
interface DashboardData {
  netWorth: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
    history: { date: Date; value: number }[];
  };
  portfolios: Portfolio[];
  activityFeed: ActivityItem[];
  watchlistMovers: SecuritySnapshot[];
  alerts: Alert[];
}

interface Portfolio {
  id: string;
  name: string;
  totalValue: number;
  dayChange: number;
  dayChangePercent: number;
  sparklineData: number[];
}

interface ActivityItem {
  id: string;
  timestamp: Date;
  type: 'transaction' | 'reconciliation' | 'alert' | 'update';
  title: string;
  description: string;
  actionUrl?: string;
  icon: string;
}

interface SecuritySnapshot {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  dayChart: { time: Date; price: number }[];
}
```

**States:**

- **Loading:** Skeleton cards for each section, animations pulse
- **Empty:** "No portfolios yet" CTA for portfolio grid
- **Error:** Alert banner "Failed to load dashboard data" with retry
- **Populated:** Full dashboard with data

**Transitions:**

- Page fade-in (150ms)
- Card stagger animation: each card fades in with 50ms delay
- Sparkline chart animate-in (300ms)

**Responsive:**

- Desktop: 3-column portfolio grid, full-width stats
- Tablet: 2-column portfolio grid, collapsed sidebar
- Mobile: 1-column grid, bottom nav, full-width cards

---

### 5.2 Portfolio Detail (/portfolios/:id)

**Route:** `/portfolios/:id`

**Layout:**

```
┌────────────────────────────────────────────┐
│ PageHeader: [Portfolio Name]              │
│  Total Value: $1,234,567                   │
│  Daily: +$5,432 (+0.44%)                   │
│  Period: [1M ▼]                            │
├────────────────────────────────────────────┤
│                                             │
│ Tab Navigation:                             │
│ [Holdings] [Performance] [Allocation]      │
│ [Transactions] [Alerts]                    │
│                                             │
│ ┌──────────────────────────────────────┐  │
│ │ HOLDINGS TAB CONTENT                  │  │
│ │ (Default view)                        │  │
│ │                                       │  │
│ │ ┌────────────────────────────────┐  │  │
│ │ │ Ticker │ Shares │ Value  │ %   │  │  │
│ │ │ AAPL   │ 150    │ $23.5K │ 45% │  │  │
│ │ │ MSFT   │ 200    │ $15.2K │ 30% │  │  │
│ │ │ ...    │ ...    │ ...    │ ... │  │  │
│ │ └────────────────────────────────┘  │  │
│ │                                       │  │
│ └──────────────────────────────────────┘  │
│                                             │
└────────────────────────────────────────────┘
```

**Tab Content Specifications:**

#### Holdings Tab (Default)

**Components:**
- DataTable with columns:
  - **Ticker** (sortable, clickable → security detail)
  - **Company/Ticker** (searchable)
  - **Shares** (numeric sort)
  - **Current Price** (right-aligned)
  - **Position Value** (right-aligned, bold)
  - **% of Portfolio** (sortable)
  - **1Y Return %** (color-coded, sparkline)
  - **Gain/Loss $** (color-coded)
  - **Gain/Loss %** (color-coded)
  - **Actions** (view thesis, set alert, trade)

**Interactions:**
- Sort by any column (click header)
- Filter: ticker search, sector filter, min/max value filters
- Expandable row: shows average cost, realized gain, recent trades, linked thesis
- Row hover: highlight and show action buttons
- Click security name → security detail modal (price chart, financials, news)
- "Set Alert" → alert editor modal
- "Trade" → order planner with pre-filled ticker

**Responsive:**
- Desktop: All columns visible
- Tablet: Hide % columns, show on click
- Mobile: Ticker + Value + % visible, swipe to see more

#### Performance Tab

**Components:**
- Period selector buttons (1M, 3M, 6M, YTD, 1Y, 3Y, 5Y, ALL, Custom)
- Metrics grid:
  - TWR Return
  - MWR Return
  - Benchmark Return
  - Alpha
  - Sharpe Ratio
  - Max Drawdown

**Charts:**
- **Primary Chart:** Time series of portfolio value + benchmark overlay
  - Crosshair tooltip on hover
  - Legend with toggle visibility
  - Zoom/pan support
  - Drawdown shading in background (light gray)

- **Secondary:** Rolling 1Y returns bar chart
  - Each bar = 1Y return at that date
  - Color: green (positive), red (negative)

**Interactions:**
- Hover chart → tooltip shows date, portfolio return, benchmark return, difference
- Click benchmark selector → choose different benchmark (S&P 500, Russell 2000, etc.)
- Drag to zoom date range

#### Allocation Tab

**Components:**
- **Donut Chart** (left side, 60%)
  - Shows asset allocation by category
  - Categories: Stocks, Bonds, Alternatives, Cash
  - Click to expand category into sub-allocation (e.g., Stocks → Sectors)
  - Legend on right with percentages

- **Drift Visualization** (right side, 40%)
  - Target allocation vs current allocation
  - Bars showing drift
  - Color: amber if drift > 5%
  - Rebalance button if drift significant

**Interactions:**
- Click donut segment → drill into holdings in that category
- Hover → tooltip with absolute $ and %
- "Rebalance" button → order planner with rebalance recommendations

#### Transactions Tab

**Components:**
- DataTable with columns:
  - **Date** (sortable, descending default)
  - **Type** (sortable: Trade, Dividend, Interest, Fee, Spin-off)
  - **Ticker** (searchable)
  - **Action** (Buy/Sell for trades)
  - **Quantity** (numeric)
  - **Price** (right-aligned)
  - **Amount** (right-aligned, bold)
  - **Fee** (right-aligned, muted)

- Pagination: 25 rows per page
- Filters: date range, type, ticker
- Export button (CSV, PDF)

**Interactions:**
- Filter by type and date range
- Search by ticker
- Expandable row: shows details (trade ID, account, broker fee, notes)
- Click row → transaction detail modal

#### Alerts Tab

**Components:**
- List of active alerts for this portfolio
- Each alert:
  - Condition (e.g., "AAPL drops below $140")
  - Status (active, triggered, acknowledged)
  - Created date
  - Actions: edit, delete, test (simulate condition)

- "New Alert" button opens alert editor
- Alert editor allows:
  - Select ticker
  - Condition: price, return %, drawdown %, allocation drift
  - Threshold value
  - Notification method (in-app, email, SMS)
  - Enable/disable

**Mock Data Shape:**

```typescript
interface PortfolioDetail {
  id: string;
  name: string;
  totalValue: number;
  dayChange: number;
  dayChangePercent: number;
  holdings: Holding[];
  performance: PerformanceMetrics;
  allocation: AllocationBreakdown;
  transactions: Transaction[];
  alerts: PortfolioAlert[];
}

interface Holding {
  id: string;
  ticker: string;
  quantity: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  percentOfPortfolio: number;
  gain: number;
  gainPercent: number;
  averageCost: number;
  realizedGain: number;
  sparklineData: number[];
}

interface PerformanceMetrics {
  period: 'period';
  periodReturn: number;
  benchmark: string;
  benchmarkReturn: number;
  alpha: number;
  sharpe: number;
  maxDrawdown: number;
  volatility: number;
  beta: number;
  historicalReturns: { date: Date; return: number }[];
}

interface AllocationBreakdown {
  byCategory: AllocationCategory[];
  byAssetClass: AllocationCategory[];
  targetAllocation: AllocationCategory[];
}

interface AllocationCategory {
  name: string;
  percentage: number;
  value: number;
  drift?: number;
}

interface Transaction {
  id: string;
  date: Date;
  type: 'trade' | 'dividend' | 'interest' | 'fee' | 'corporate_action';
  ticker?: string;
  action?: 'buy' | 'sell';
  quantity?: number;
  price?: number;
  amount: number;
  fee?: number;
  notes?: string;
}

interface PortfolioAlert {
  id: string;
  ticker?: string;
  condition: string;
  threshold: number;
  status: 'active' | 'triggered' | 'acknowledged';
  createdAt: Date;
  notificationMethod: 'in_app' | 'email' | 'sms';
}
```

---

### 5.3 Performance Deep Dive (/performance)

**Route:** `/performance`

**Layout:**

```
┌─────────────────────────────────────────────┐
│ PageHeader: Performance Analytics           │
│ Period: [1M | 3M | 6M | YTD | 1Y | 3Y| 5Y] │
│         [ALL | Custom Date Range v]         │
├─────────────────────────────────────────────┤
│                                              │
│ Metric Grid (4 columns, responsive)         │
│ ┌──────────┬──────────┬──────────┬────────┐ │
│ │ TWR      │ MWR      │ Benchmark│ Alpha  │ │
│ │ +12.34%  │ +11.25%  │ +10.20%  │ +2.14%│ │
│ │ [Spark]  │ [Spark]  │ [Spark]  │ [Sp] │ │
│ └──────────┴──────────┴──────────┴────────┘ │
│                                              │
│ ┌──────────┬──────────┬──────────┬────────┐ │
│ │ Sharpe   │ Sortino  │ Max DD   │ Volt  │ │
│ │ 1.45     │ 2.10     │ -8.23%   │ 14.2% │ │
│ └──────────┴──────────┴──────────┴────────┘ │
│                                              │
│ ┌────────────────────────────────────────┐  │
│ │ Equity Curve (5Y)                       │  │
│ │  [Time series chart]                   │  │
│ │  [Benchmark overlay toggle]            │  │
│ │  [Download CSV]                        │  │
│ └────────────────────────────────────────┘  │
│                                              │
│ ┌────────────────────────────────────────┐  │
│ │ Attribution Analysis                   │  │
│ │ ┌─ Total Return: +12.34%               │  │
│ │ ├─ Allocation Effect: +3.45%           │  │
│ │ ├─ Selection Effect: +5.20%            │  │
│ │ ├─ Interaction: +0.15%                 │  │
│ │ └─ Fees: -0.46%                        │  │
│ │                                         │  │
│ │ [Waterfall Chart]                      │  │
│ └────────────────────────────────────────┘  │
│                                              │
│ ┌────────────────────────────────────────┐  │
│ │ Drawdown Analysis                      │  │
│ │ [Area chart showing peak-to-trough]   │  │
│ │ Max Drawdown: -8.23% (2024-10-15)     │  │
│ │ Duration: 45 days                      │  │
│ └────────────────────────────────────────┘  │
│                                              │
│ ┌────────────────────────────────────────┐  │
│ │ Benchmark Comparison                   │  │
│ │ Portfolio | 1M  | 3M  | 6M  | 1Y  | 3Y  │
│ │ Your Port | 2.3%| 6.1%|11.2%|12.3%|35.2%│
│ │ S&P 500   | 2.1%| 5.8%|10.8%|11.9%|34.8%│
│ │ Russell   | 1.9%| 5.2%| 9.5%|10.2%|28.3%│
│ └────────────────────────────────────────┘  │
│                                              │
└─────────────────────────────────────────────┘
```

**Components & Interactions:**

1. **Period Selector**
   - Buttons: 1M, 3M, 6M, YTD, 1Y, 3Y, 5Y, ALL
   - Dropdown: Custom date range picker
   - Default: YTD
   - Selected button: bold + primary color background
   - Custom range shows "Custom (Mar 1 - Oct 15)"

2. **Key Metrics Grid**
   - 4 metrics per row (responsive to 2 on tablet, 1 on mobile)
   - Each card shows:
     - Metric name
     - Current value (large, bold)
     - Sparkline (optional, 1Y data)
     - Comparison: "↑ +2.3% vs last period"
   - Cards: white background, subtle border
   - Hover: slight shadow elevation

3. **Equity Curve Chart**
   - Time series line chart showing portfolio value
   - Y-axis: portfolio value ($)
   - X-axis: date
   - Interactive:
     - Hover: tooltip shows date, value, daily return
     - Drag to zoom: select date range
     - Checkbox toggle: overlay benchmark line
     - Download button: export data as CSV/PDF
   - Visual: primary color for portfolio, secondary for benchmark
   - Annotations: mark significant events (rebalancing, large trades)
   - Drawdown shading: light background showing peak-to-current underwater

4. **Attribution Waterfall**
   - Waterfall chart showing breakdown of returns
   - Starting point: benchmark return
   - Bars: allocation effect, selection effect, interaction, fees
   - Stacked to show final portfolio return
   - Hover: tooltip shows basis points contribution
   - Color: green (positive attribution), red (negative)

5. **Drawdown Analysis**
   - Area chart showing drawdown from peak
   - Y-axis: drawdown % (negative values)
   - Filled area in danger color
   - Max drawdown annotation: red marker + label
   - Duration indicator: show in sidebar
   - Current drawdown: label at right edge

6. **Benchmark Comparison Table**
   - Rows: Portfolio, S&P 500, Russell 2000, other selected benchmarks
   - Columns: 1M, 3M, 6M, YTD, 1Y, 3Y, 5Y, 10Y returns
   - Color-coded: green (outperformance), red (underperformance)
   - Outperformance row at bottom: shows alpha vs each benchmark

**Mock Data Shape:**

```typescript
interface PerformanceData {
  period: DateRange;
  metrics: {
    twr: number;           // Total Weighted Return
    mwr: number;           // Money Weighted Return
    benchmarkReturn: number;
    alpha: number;
    sharpe: number;
    sortino: number;
    maxDrawdown: number;
    volatility: number;
    beta: number;
  };
  equityCurve: { date: Date; value: number; benchmark?: number }[];
  attribution: {
    benchmarkReturn: number;
    allocationEffect: number;
    selectionEffect: number;
    interactionEffect: number;
    fees: number;
  };
  drawdowns: { date: Date; drawdown: number }[];
  benchmarkComparison: {
    name: string;
    returns: { period: string; return: number }[];
  }[];
}
```

---

### 5.4 Account Linking (/accounts)

**Route:** `/accounts`

**Layout:**

```
┌──────────────────────────────────────────────┐
│ PageHeader: Connected Accounts               │
│ [+ Add Account] Button                       │
├──────────────────────────────────────────────┤
│                                               │
│ Connected Accounts (List View)                │
│                                               │
│ ┌────────────────────────────────────────┐   │
│ │ Fidelity Brokerage                 ✓  │   │
│ │ Synced 2 min ago                       │   │
│ │ 3 accounts, $1,234,567                 │   │
│ │ Last full sync: 2 min ago              │   │
│ │ [Resync] [Settings] [Disconnect]       │   │
│ └────────────────────────────────────────┘   │
│                                               │
│ ┌────────────────────────────────────────┐   │
│ │ Charles Schwab                     ⚠   │   │
│ │ Last sync: 45 min ago (stale)          │   │
│ │ 2 accounts, $450,230                   │   │
│ │ [Resync Now] [Settings] [Disconnect]   │   │
│ └────────────────────────────────────────┘   │
│                                               │
│ ┌────────────────────────────────────────┐   │
│ │ Vanguard (Error)                   ✗   │   │
│ │ Last sync failed: 2024-12-20            │   │
│ │ Error: Credentials expired              │   │
│ │ [Reconnect] [Troubleshoot] [Disconnect]│   │
│ └────────────────────────────────────────┘   │
│                                               │
├──────────────────────────────────────────────┤
│ Reconciliation Status                         │
│                                               │
│ ┌────────────────────────────────────────┐   │
│ │ Matched Positions: 47 / 50             │   │
│ │ ├─ Fidelity: 25/25 ✓                  │   │
│ │ ├─ Schwab: 15/17 (2 manual)           │   │
│ │ └─ Vanguard: 7/8 (1 unmatched)        │   │
│ │                                         │   │
│ │ [View Unmatched] [Manual Match UI]     │   │
│ └────────────────────────────────────────┘   │
│                                               │
└──────────────────────────────────────────────┘
```

**Components & Interactions:**

1. **Connected Accounts List**
   - Card per connection showing:
     - Institution name + logo
     - Status indicator (✓ synced, ⚠ stale, ✗ error)
     - Last sync timestamp (relative: "2 min ago")
     - Account count + total value
     - Action buttons: Resync, Settings, Disconnect

   - Status indicators:
     - ✓ Green: Last sync < 2 hours ago
     - ⚠ Amber: Last sync 2-24 hours ago
     - ✗ Red: Error or last sync > 24 hours ago
     - Spinner: Currently syncing

   - Resync button: triggers manual sync, shows progress
   - Settings: configure sync frequency, accounts to include/exclude
   - Disconnect: confirmation dialog before removal

2. **Add Account Flow** (Wizard)
   - Step 1: Institution Search
     - Search input: "Find your bank"
     - Autocomplete list: Fidelity, Charles Schwab, Vanguard, E-Trade, etc.
     - Click to select

   - Step 2: Authentication
     - OAuth flow: "Sign in to [Institution]"
     - Button: "Connect with [Institution]"
     - Opens OAuth consent screen in modal
     - Scopes: readonly access to holdings, transactions, balances

   - Step 3: Account Selection
     - Show accounts available from institution
     - Checkboxes: select which accounts to import
     - Each account shows: account name, type (brokerage/retirement), balance
     - Summary: "Import 3 accounts"

   - Step 4: Confirmation
     - Summary of accounts to import
     - "Complete Import" button
     - Shows initial sync progress
     - Completion screen: "Successfully imported 3 accounts, syncing holdings..."

3. **Reconciliation Dashboard**
   - Summary: "47 of 50 positions matched"
   - Progress bar showing match percentage
   - Breakdown by institution:
     - Fidelity: 25/25 ✓
     - Schwab: 15/17 (2 manual matches needed)
     - Vanguard: 7/8

   - "View Unmatched" link shows table:
     - Column: Broker Position | Internal Record | Match Status
     - Unmatched rows: suggest possible matches (99% confidence)
     - Manual match UI: dropdown selector to link broker position to internal record
     - Save button to confirm match

4. **Account Settings Modal**
   - Sync frequency: every 1/4/12 hours, daily, weekly
   - Accounts: checkboxes to include/exclude specific accounts
   - Data retention: automatic download frequency
   - Notifications: alert on sync failure
   - Disconnect button (with confirmation)

**Mock Data Shape:**

```typescript
interface AccountConnection {
  id: string;
  institution: Institution;
  accounts: LinkedAccount[];
  status: 'synced' | 'stale' | 'syncing' | 'error';
  lastSyncTime: Date;
  lastSyncError?: string;
  syncFrequency: 'hourly' | 'every_4h' | 'daily' | 'weekly';
}

interface Institution {
  id: string;
  name: string;
  logo: string;
  baseUrl: string;
}

interface LinkedAccount {
  id: string;
  name: string;
  type: 'brokerage' | 'retirement' | 'savings' | 'checking';
  balance: number;
  currency: string;
  holdings: Holding[];
  lastUpdateTime: Date;
}

interface ReconciliationStatus {
  totalPositions: number;
  matchedPositions: number;
  unmatchedPositions: UnmatchedPosition[];
  reconciliationScore: number;
}

interface UnmatchedPosition {
  brokerPosition: Position;
  suggestedMatches: SuggestedMatch[];
  manualMatch?: string;
}

interface SuggestedMatch {
  internalPosition: Position;
  confidence: number;
}
```

---

### 5.5 Thesis Workspace (/research/theses/:id)

**Route:** `/research/theses/:id`

**Layout:**

```
┌───────────────────────────────────────────────┐
│ PageHeader: [Thesis Title]                    │
│ Ticker: AAPL | Status: Active | Health: 85/100│
│ [Save] [More Options v]                        │
├───────┬───────────────────────────────────────┤
│       │                                        │
│ Left  │  Main Editor                           │
│ Panel │  ┌──────────────────────────────┐    │
│       │  │ Hypothesis                    │    │
│ Sec 1:│  │ [Rich text editor]             │    │
│ Hyp   │  │                               │    │
│       │  └──────────────────────────────┘    │
│ Sec 2:│  ┌──────────────────────────────┐    │
│ Evid  │  │ Evidence For                  │    │
│ For   │  │ [Rich text + citations]       │    │
│       │  │                               │    │
│ Sec 3:│  └──────────────────────────────┘    │
│ Evid  │  ┌──────────────────────────────┐    │
│ Agst  │  │ Evidence Against              │    │
│       │  │ [Rich text]                   │    │
│ Sec 4:│  │                               │    │
│ Catal │  └──────────────────────────────┘    │
│       │  ┌──────────────────────────────┐    │
│ Sec 5:│  │ Catalysts & Timeline          │    │
│ Risks │  │ • Q1 2025 earnings            │    │
│       │  │ • New product launch          │    │
│       │  │ • Regulatory decision         │    │
│ Sec 6:│  └──────────────────────────────┘    │
│ Price │  ┌──────────────────────────────┐    │
│ Targ  │  │ Price Targets                 │    │
│       │  │ Bull: $185 | Base: $165       │    │
│       │  │ Bear: $140                    │    │
│       │  │                               │    │
│       │  └──────────────────────────────┘    │
│       │                                        │
│ Right Panel (Collapsed to icon, expandable)   │
│ ┌─────────────────────────────────────────┐  │
│ │ Evidence Library (Evidence Articles)     │  │
│ │                                          │  │
│ │ [📄 "Apple Q4 Earnings Beat"] (selected)│  │
│ │ [🔗 Yahoo Finance Article]              │  │
│ │ [📺 Earnings Call Transcript]           │  │
│ │                                          │  │
│ │ [+ Add Evidence]                        │  │
│ └─────────────────────────────────────────┘  │
│                                                │
│ Linked Trades & Journal Entries               │
│ ┌────────────────────────────────────────┐   │
│ │ [2024-03-15] BUY 150 shares @ $142.30  │   │
│ │ [2024-02-20] Thesis updated            │   │
│ │ [2024-01-10] Journal entry: Conviction │   │
│ │              increasing to HIGH        │   │
│ └────────────────────────────────────────┘   │
│                                                │
└───────────────────────────────────────────────┘
```

**Components & Interactions:**

1. **Page Header**
   - Title: editable text field
   - Subtitle: ticker (clickable → security detail modal)
   - Status badge: Active | Tested | Abandoned | Archived
   - Conviction level: dropdown (High / Medium / Low)
   - Time horizon: text field ("6-12 months")
   - Health gauge: visual bar (0-100) calculated from:
     - Evidence balance (60% weight)
     - Thesis clarity (20%)
     - Counter-argument strength (10%)
     - Activity recency (10%)
   - Actions: Save (auto-saves on blur), More (...) menu

2. **Thesis Sections** (Structured Editor)
   - **Hypothesis**
     - Rich text editor (Markdown support)
     - Character count (aim for 100-500 chars)
     - Auto-save on blur
     - Expandable to full editor modal

   - **Evidence For**
     - Rich text editor
     - Links to evidence items (drag-and-drop from right panel)
     - List of citations shown as inline references [1], [2]
     - Citation popup on click

   - **Evidence Against**
     - Same as Evidence For
     - Explicitly designed to capture counterarguments
     - Important for "make thinking explicit" principle

   - **Catalysts & Timeline**
     - Timeline UI component (vertical)
     - Each catalyst: date (or date range), description, probability
     - Drag-to-reorder
     - Add button: insert catalyst
     - Example catalysts pre-filled for common patterns

   - **Risks**
     - Bullet list (editable)
     - Each risk: description, severity (Low/Med/High), mitigation
     - Red styling for high-risk items

   - **Price Targets**
     - Bull case target: input field ($)
     - Base case target: input field ($)
     - Bear case target: input field ($)
     - Optional: target date
     - Visual range display on right: [Bear ──── Base ──── Bull]

3. **Evidence Panel** (Right side)
   - Collapsible panel (toggle icon in header)
   - Shows linked evidence items
   - Each item:
     - Icon (📄 article, 🔗 link, 📺 transcript, 📊 data)
     - Title (clickable → view full evidence)
     - Source (domain/author)
     - Date added
     - Drag handle (drag to editor section)
     - Delete button (X)

   - Add Evidence button:
     - Opens modal for evidence input
     - Input type: URL paste, file upload (PDF), text paste, manual entry
     - URL input: auto-fetch metadata (title, excerpt, domain)
     - File upload: auto-extract text (PDF, image via OCR)
     - Manual entry: title, source, date, full text
     - Evidence type selector: article, transcript, chart, custom

4. **Linked Trades & Journal Entries**
   - Timeline view at bottom
   - Shows trades (buy/sell) linked to this thesis
   - Shows journal entries mentioning this thesis
   - Each item: date, description, link to trade/entry
   - Chronologically sorted (newest first)
   - Expandable to full details
   - "Link Trade" button to associate existing trade

**Keyboard Shortcuts:**
- Ctrl+S (Cmd+S on Mac): Save thesis
- Ctrl+/ : Toggle help
- Ctrl+M : Toggle markdown preview

**Mock Data Shape:**

```typescript
interface Thesis {
  id: string;
  ticker: string;
  title: string;
  hypothesis: string;
  evidenceFor: string;
  evidenceAgainst: string;
  catalysts: Catalyst[];
  risks: Risk[];
  priceTargets: {
    bull: number;
    base: number;
    bear: number;
    targetDate?: Date;
  };
  conviction: 'high' | 'medium' | 'low';
  timeHorizon: string;
  status: 'active' | 'tested' | 'abandoned' | 'archived';
  healthScore: number;
  linkedEvidence: Evidence[];
  linkedTrades: string[];  // Trade IDs
  linkedJournalEntries: string[];  // Journal entry IDs
  createdAt: Date;
  updatedAt: Date;
  lastReviewDate?: Date;
}

interface Catalyst {
  id: string;
  date: Date;
  dateEnd?: Date;
  description: string;
  probability?: number;
  impact?: 'high' | 'medium' | 'low';
}

interface Risk {
  description: string;
  severity: 'high' | 'medium' | 'low';
  mitigation?: string;
}

interface Evidence {
  id: string;
  type: 'article' | 'transcript' | 'chart' | 'data' | 'custom';
  title: string;
  source: string;
  url?: string;
  content?: string;
  dateAdded: Date;
  datePublished?: Date;
  excerpt?: string;
}
```

---

### 5.6 Decision Journal (/research/journal)

**Route:** `/research/journal`

**Layout:**

```
┌──────────────────────────────────────────────┐
│ PageHeader: Decision Journal                  │
│ [New Entry] Button                            │
├──────────────────────────────────────────────┤
│                                               │
│ Filter Bar:                                   │
│ [All Outcomes v] [All Tickers v] [Date Range]│
│                                               │
│ ┌──────────────────────────────────────────┐ │
│ │ Timeline View                             │ │
│ │                                           │ │
│ │ 2024-12-20                                │ │
│ │ ┌─ BUY TSLA @ $250                       │ │
│ │ │  "Breaking above 200-day MA with"      │ │
│ │ │  "strong earnings beat. Thesis:        │ │
│ │ │  "demand recovery in 2025"             │ │
│ │ │  Conviction: MEDIUM                    │ │
│ │ │  Linked thesis: TSLA Growth Story       │ │
│ │ │  [View Full] [Edit] [Link Trade]       │ │
│ │ │  Expected outcome: +15% in 6m          │ │
│ │ │  Current outcome: +3.2% (open)         │ │
│ │ │  Review date: 2025-01-20 (in 31 days)  │ │
│ │ └─────────────────────────────────────   │ │
│ │                                           │ │
│ │ 2024-12-10                                │ │
│ │ ┌─ SELL MSFT @ $425                      │ │
│ │ │  "Reached price target. Valuation"     │ │
│ │ │  "premium extended."                   │ │
│ │ │  Conviction: HIGH                      │ │
│ │ │  Result: CORRECT (Actual return -8%)   │ │
│ │ │  [View Full] [Learn]                   │ │
│ │ └─────────────────────────────────────   │ │
│ │                                           │ │
│ │ 2024-11-05                                │ │
│ │ ┌─ HOLD AAPL                              │ │
│ │ │  "Waiting for better entry point"      │ │
│ │ │  Expected: within 6 months              │ │
│ │ │  Result: PARTIALLY CORRECT              │ │
│ │ │  (Occurred in 5 months)                 │ │
│ │ └─────────────────────────────────────   │ │
│ │                                           │ │
│ └──────────────────────────────────────────┘ │
│                                               │
└──────────────────────────────────────────────┘
```

**Components & Interactions:**

1. **Timeline Navigation**
   - Default view: chronological (newest first)
   - Toggle options: chronological, by ticker, by outcome
   - Sticky header showing current filter

2. **Entry Card**
   - Date (large)
   - Ticker + Action (BUY/SELL/HOLD) in colored badge
   - Entry price (if available)
   - Rationale (excerpt, ~100 chars, truncated with "...")
   - Metadata:
     - Conviction level (High/Med/Low)
     - Linked thesis (clickable)
   - Status badge: "Open" (pending) | outcome badge
   - Outcome section (if closed or reviewable):
     - Expected outcome (e.g., "+15% in 6 months")
     - Actual outcome: current return if still open
     - Result badge: CORRECT (green) | INCORRECT (red) | PARTIAL (amber)
     - Review date (if future) or actual close date
   - Actions: View Full, Edit, Link Trade, Delete
   - Expand button: shows full details inline

3. **Filters**
   - By outcome: All | Correct | Incorrect | Partial | Pending
   - By ticker: searchable autocomplete
   - By date: date range picker
   - Filter pills show active filters with X to remove

4. **New Entry Form** (Modal or page)
   - Form fields:
     - Date picker (default today)
     - Ticker autocomplete
     - Action: radio buttons (Buy / Sell / Hold)
     - Price: number input (optional)
     - Rationale: rich text editor
     - Conviction: radio (High / Medium / Low)
     - Time horizon: text input ("6 months", "until earnings", etc.)
     - Link thesis: autocomplete to select thesis
     - Expected outcome: text input
     - Tags: tag input for custom categorization
   - Save button: creates entry, returns to journal
   - Auto-link to open trade if ticker+action matches

5. **View Full Entry Modal**
   - Shows complete entry with all fields
   - Outcome section:
     - If still open: show current price, return, review date
     - If closed: show final return, outcome assessment
   - "Edit" and "Mark as Reviewed" buttons
   - Decision quality metrics (calculated):
     - "This decision was made with MEDIUM conviction"
     - "Average conviction score: HIGH"
     - "Your SELL decisions have 70% accuracy rate"

6. **Outcome Review Flow**
   - After review date, entry shows "Ready for review" badge
   - Click → Review modal:
     - Shows original decision + rationale
     - Current market data overlay
     - Questions: "Did your hypothesis prove correct? Why?"
     - Mark outcome: dropdown (Correct/Incorrect/Partial)
     - Post-trade reflection: text field
     - Lessons learned: text field
   - Updates entry with outcome data

**Mock Data Shape:**

```typescript
interface JournalEntry {
  id: string;
  date: Date;
  ticker: string;
  action: 'buy' | 'sell' | 'hold';
  price?: number;
  rationale: string;
  conviction: 'high' | 'medium' | 'low';
  timeHorizon: string;
  expectedOutcome: string;
  linkedThesis?: string;
  linkedTrade?: string;
  tags: string[];
  outcome?: {
    actualReturn: number;
    result: 'correct' | 'incorrect' | 'partial';
    reviewedAt?: Date;
    reflection?: string;
    lessonsLearned?: string;
  };
  reviewDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface DecisionMetrics {
  averageConviction: 'high' | 'medium' | 'low';
  totalDecisions: number;
  reviewedDecisions: number;
  correctDecisions: number;
  accuracyRate: number;
  averageReturnPerDecision: number;
}
```

---

### 5.7 Strategy Builder (/strategies/builder)

**Route:** `/strategies/builder` or `/strategies/:id/edit`

**Layout:**

```
┌────────────────────────────────────────────────┐
│ PageHeader: Strategy Builder                   │
│ [Save Draft] [Run Backtest] [Cancel]           │
├────────────────────────────────────────────────┤
│                                                 │
│ Mode Toggle: [Wizard] [Canvas v]               │
│                                                 │
│ ┌──────────────────┬──────────────────────┐   │
│ │ Step 1/7:        │                      │   │
│ │ Name & Universe  │ Step Content          │   │
│ │                  │                      │   │
│ │ ┌──────────────┐ │ Strategy Name:      │   │
│ │ │ Step 1: Univ │ │ [Input field]        │   │
│ │ │ ✓ Step 2: SIG│ │                      │   │
│ │ │ > Step 3: ENT│ │ Universe:            │   │
│ │ │  Step 4: SIZE│ │ [Dropdown v]         │   │
│ │ │  Step 5: REB │ │ Options:             │   │
│ │ │  Step 6: CONS│ │ • US Stocks (500)    │   │
│ │ │  Step 7: REV │ │ • Tech Sector (50)   │   │
│ │ │              │ │ • Custom List        │   │
│ │ │ [< Back] [Next] │                     │   │
│ │ └──────────────┘ │ Max positions: [50]  │   │
│ │                  │ Rebalance freq: [M]  │   │
│ │                  │                      │   │
│ │                  │ [< Back] [Next >]    │   │
│ │                  └──────────────────────┘   │
│                                                 │
│ Canvas Mode: (When toggled)                    │
│ ┌──────────────────────────────────────────┐  │
│ │ [Universe] → [Signals] → [Entry/Exit] → │  │
│ │ [Sizing] → [Rebalance] → [Constraints]   │  │
│ │    ↓          ↓            ↓              │  │
│ │ [Connector rule builder UI for each]    │  │
│ │                                          │  │
│ │ Live Preview:                            │  │
│ │ • 500 securities in universe              │  │
│ │ • 45 match signal criteria                │  │
│ │ • Avg position: 2.2%                     │  │
│ │ • Est. turnover: 35% annually            │  │
│ └──────────────────────────────────────────┘  │
│                                                 │
└────────────────────────────────────────────────┘
```

**Wizard Steps:**

1. **Step 1: Name & Universe**
   - Text input: "Strategy Name" (e.g., "Growth Momentum")
   - Description: optional rich text
   - Universe selector:
     - Presets: S&P 500, Russell 2000, Tech 100, Custom
     - Custom: upload CSV of tickers
   - Max positions: slider (1-500)
   - Rebalance frequency: dropdown (weekly, monthly, quarterly)

2. **Step 2: Signals** (Most complex)
   - Rule builder interface
   - Add signal button: creates new rule group
   - Each signal:
     - Name: text input
     - Condition: "If [field] [operator] [value]"
     - Field selector dropdown:
       - Price: Price, Volume, Moving Average, RSI, MACD, Bollinger Bands
       - Fundamental: P/E, P/B, Dividend Yield, ROE, Debt/Equity
       - Market: Sector, Industry, Market Cap, Momentum
       - Custom: any imported custom indicator
     - Operator dropdown: =, >, <, >=, <=, crosses above, crosses below, between, etc.
     - Value input: context-dependent (number, percentage, text)
     - AND/OR conjunction toggle between rules
     - Remove signal button (X)
   - Live preview shows matching securities (50/500 match)
   - Example templates: "Momentum", "Value", "Growth", "Quality"

3. **Step 3: Entry & Exit Conditions**
   - Radio selection:
     - "Buy when signal is true, sell when signal becomes false"
     - "Custom entry/exit rules"
   - Custom rules:
     - Entry conditions: same rule builder as signals
     - Exit conditions: rule builder
     - Hold period: optional (e.g., "hold for 30 days minimum")
     - Holding period: maximum holding time before forced exit

4. **Step 4: Position Sizing**
   - Sizing method dropdown:
     - Equal-weight: each position 1/N of portfolio
     - Market-cap-weighted: weight by company size
     - Volatility-adjusted: inverse volatility weighting
     - Custom: formula input
   - Position limits:
     - Min position: 0.5%
     - Max position: 10%
     - Max sector exposure: 30%
   - Leverage: allow/disallow margin

5. **Step 5: Rebalance Schedule**
   - Rebalance frequency: dropdown (daily, weekly, monthly, quarterly, annual)
   - Rebalance on specific dates: optional date picker
   - Drift tolerance: rebalance only if weights drift > X%
   - Rebalance method: optional (which positions to adjust)

6. **Step 6: Constraints**
   - Add constraint button
   - Constraint templates:
     - Max drawdown: [value]%
     - Max turnover: [value]% per period
     - Min position size: [value]
     - Max position size: [value]
     - Sector limits: {sector: max%}
   - Priority order: drag-to-reorder which constraints matter most
   - Violation handling: "Skip rebalance" vs "Scale down sizes"

7. **Step 7: Review & Backtest**
   - Summary table:
     - Strategy name
     - Universe
     - Number of signals
     - Rebalance frequency
     - Constraints
   - Live preview metrics:
     - Securities in universe: [N]
     - Securities passing signals: [N]
     - Avg position size: [%]
     - Estimated annual turnover: [%]
   - Buttons: "Save as Draft", "Run Backtest"

**Canvas Mode Alternative:**
- Visual node-based editor
- Nodes: Universe, Signal, Entry/Exit, Sizing, Rebalance, Constraints
- Drag to connect nodes
- Click node to edit parameters
- Live preview on right
- Less structured but more visual

**Mock Data Shape:**

```typescript
interface Strategy {
  id: string;
  name: string;
  description?: string;
  status: 'draft' | 'backtested' | 'approved' | 'staging' | 'live';
  universe: {
    type: 'preset' | 'custom';
    preset?: 'sp500' | 'russell2000' | 'tech100';
    tickers?: string[];
    maxPositions: number;
  };
  signals: Signal[];
  entryExit: {
    type: 'simple' | 'custom';
    entryConditions?: Rule[];
    exitConditions?: Rule[];
    holdPeriodDays?: number;
  };
  sizing: {
    method: 'equal' | 'market_cap' | 'volatility' | 'custom';
    minPosition: number;
    maxPosition: number;
    maxSectorExposure: number;
    formula?: string;
  };
  rebalance: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
    driftTolerance?: number;
  };
  constraints: Constraint[];
  backtests: Backtest[];
  createdAt: Date;
  updatedAt: Date;
}

interface Signal {
  id: string;
  name: string;
  rules: Rule[];
  conjunction: 'AND' | 'OR';
}

interface Rule {
  id: string;
  field: string;
  operator: string;
  value: any;
  conjunction?: 'AND' | 'OR';
}

interface Constraint {
  id: string;
  type: string;
  value: number;
  unit?: string;
  priority: number;
}
```

---

### 5.8 Backtest Results (/strategies/:id/backtests/:backtestId)

**Route:** `/strategies/:id/backtests/:backtestId`

**Layout:**

```
┌─────────────────────────────────────────────┐
│ PageHeader: Backtest Results                 │
│ Strategy: Growth Momentum | Period: 2020-2024│
│ [Promote to Paper] [Promote to Staging]      │
├─────────────────────────────────────────────┤
│                                              │
│ Summary Hero (4 columns)                     │
│ ┌──────────┬────────┬──────────┬──────────┐ │
│ │ Total    │ CAGR   │ Sharpe   │ Max DD   │ │
│ │ Return   │        │          │          │ │
│ │ +156.3%  │ 15.2%  │ 1.45     │ -18.5%   │ │
│ └──────────┴────────┴──────────┴──────────┘ │
│                                              │
│ Comparison vs Benchmark                     │
│ ┌──────────┬────────┬──────────┬──────────┐ │
│ │ Strategy │ S&P500 │ Alpha    │ Beta     │ │
│ │ +156.3%  │ +98.2% │ +58.1%   │ 1.05     │ │
│ └──────────┴────────┴──────────┴──────────┘ │
│                                              │
│ Equity Curve                                  │
│ ┌──────────────────────────────────────────┐ │
│ │ [Time series chart with benchmark]       │ │
│ │ Strategy (blue) | Benchmark (gray)       │ │
│ │ Drawdown shading below                   │ │
│ │ [Zoom controls] [Download data]          │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Robustness Analysis                          │ │ Tab Nav: [Robustness] [Trades] [Warnings]   │
│ │                                              │
│ │ Regime Analysis                              │
│ │ ┌─────────────┬─────────┬─────────────┐    │
│ │ │ Regime      │ Return  │ Trades      │    │
│ │ │ Bull Market │ +210%   │ 450 trades  │    │
│ │ │ Bear Market │ +35%    │ 120 trades  │    │
│ │ │ Sideways    │ +50%    │ 85 trades   │    │
│ │ └─────────────┴─────────┴─────────────┘    │
│                                              │
│ Sensitivity Heatmap                         │
│ │ [2D heatmap: signal threshold vs          │
│ │  position sizing effect on returns]       │
│ │ Green = good sensitivity                  │
│ │ Red = unstable                             │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Trade Log (Trades Tab)                       │
│ ┌──────────────────────────────────────────┐ │
│ │ Ticker│Entry Date│Exit Date│Return │Dur  │ │
│ │ AAPL  │2020-03-15│2020-05-20│+12.5%│66d  │ │
│ │ MSFT  │2020-03-10│2020-08-01│+35.2%│144d│ │
│ │ ...   │...       │...       │...   │...  │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Warnings (Warnings Tab)                      │
│ │ ⚠ Overfit Risk: High                       │
│ │   Suggestion: Test on out-of-sample data  │
│ │                                             │
│ │ ⚠ Survivorship Bias:                       │
│ │   3 companies delisted during backtest    │ │   Results may be overstated                   │
│ │                                             │
│ │ ⚠ Data Quality: 2.3% missing data          │
│ │   Suggestion: Review historical data gaps │
│ └──────────────────────────────────────────┘ │
│                                              │
└─────────────────────────────────────────────┘
```

**Components & Interactions:**

1. **Summary Metrics Cards**
   - Total Return, CAGR, Sharpe Ratio, Max Drawdown, Volatility, Beta, Win Rate, Profit Factor
   - Color-coded: green (good), amber (warning), red (poor)
   - Hover: tooltip with formula/definition

2. **Equity Curve Chart**
   - Interactive time series
   - Crosshair on hover
   - Benchmark overlay toggle
   - Drawdown shading (light gray area below zero)
   - Annotations: major events (strategy rule changes, crisis periods)
   - Zoom/pan support
   - Download button: export as CSV

3. **Robustness Analysis**

   **Regime Analysis Table:**
   - Rows: Bull Market, Bear Market, Sideways, Tech Correction, etc.
   - Columns: Return %, Sharpe, Max DD, Number of trades
   - Shows strategy performance in different market conditions
   - Color-coded: green if outperforms benchmark in regime

   **Sensitivity Heatmap:**
   - 2D grid showing how changes to key strategy parameters affect returns
   - X-axis: signal threshold values (e.g., RSI level)
   - Y-axis: position sizing % (e.g., 1-10%)
   - Color intensity: return % (green = high, red = low)
   - Hover: tooltip shows exact return for that parameter combo

4. **Trade Log Table**
   - Columns: Ticker, Entry Date, Exit Date, Entry Price, Exit Price, Return $, Return %, Holding Days
   - Sortable, filterable
   - Expandable rows: show entry/exit signals, rationale
   - Color-code: green row (winning trade), red (losing)
   - Pagination: 50 trades per page
   - Export button: download as CSV

5. **Warnings Panel**
   - Alert messages for data quality, overfitting risk, survivorship bias, etc.
   - Each warning: severity indicator, message, suggestion
   - Collapsible details for each warning
   - Links to more information

6. **Promote Actions**
   - "Promote to Paper Trading" button:
     - Opens workflow modal
     - Select accounts to apply strategy to (paper accounts only)
     - Set target allocation
     - Schedule start date
     - Confirmation modal
   - "Promote to Staging" button:
     - Same flow but for staging (small real money)
     - Requires approval

**Mock Data Shape:**

```typescript
interface BacktestResult {
  id: string;
  strategyId: string;
  period: DateRange;
  metrics: {
    totalReturn: number;
    cagr: number;
    sharpe: number;
    sortino: number;
    maxDrawdown: number;
    volatility: number;
    beta: number;
    winRate: number;
    profitFactor: number;
    averageWinLoss: number;
  };
  benchmark: {
    name: string;
    return: number;
    alpha: number;
  };
  equityCurve: { date: Date; value: number; benchmark: number }[];
  regimeAnalysis: RegimeMetrics[];
  sensitivityHeatmap: number[][];  // 2D array of returns
  trades: BacktestTrade[];
  warnings: BacktestWarning[];
  createdAt: Date;
}

interface BacktestTrade {
  ticker: string;
  entryDate: Date;
  exitDate: Date;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  returnPercent: number;
  returnDollars: number;
  holdingDays: number;
  entrySignal: string;
  exitSignal: string;
}

interface RegimeMetrics {
  regime: string;
  return: number;
  sharpe: number;
  maxDrawdown: number;
  tradeCount: number;
  percentOfPeriod: number;
}

interface BacktestWarning {
  id: string;
  severity: 'low' | 'medium' | 'high';
  type: string;  // 'overfitting', 'survivorship_bias', 'data_quality', etc.
  message: string;
  suggestion: string;
}
```

---

### 5.9 Order Planner (/execution/planner)

**Route:** `/execution/planner`

**Layout:**

```
┌──────────────────────────────────────────────┐
│ PageHeader: Order Planner                    │
│ [Submit for Approval] [Cancel]               │
├──────────────────────────────────────────────┤
│                                               │
│ Source: [Strategy v] / [Manual v]             │
│ Target Portfolio: [My Portfolio v]            │
│ Strategy: Growth Momentum | Period: Monthly   │
│                                               │
│ Current vs Target Allocation                  │
│ ┌──────────────────────────────────────────┐  │
│ │ Allocation Comparison (Pie Charts)       │  │
│ │ [Current]          [Target After]        │  │
│ │  AAPL: 25%  ─→     AAPL: 22%            │  │
│ │  MSFT: 18%  ─→     MSFT: 20%            │  │
│ │  GOOGL: 15% ─→     GOOGL: 18%           │  │
│ │  Cash: 42%  ─→     Cash: 5%             │  │
│ │ [Drift Warnings: 37% allocation change] │  │
│ └──────────────────────────────────────────┘  │
│                                               │
│ Proposed Trades Table                         │
│ ┌──────────────────────────────────────────┐  │
│ │ Ticker│Action│Shares│Price │  Cost  │ Tax  │ │ │ AAPL  │ SELL │  150 │ $175│-$26.2K│$2.1K│ │ │ MSFT  │ BUY  │  100 │ $410│+$41.0K│  $0 │ │ │ CASH  │ MOVE │  ─   │  ─  │-$14.8K│  $0 │ │ │ Total Impact:      │           │ -$0.5K│$2.1K│ │ └──────────────────────────────────────────┘  │                                               │ │ Constraint Violations                       │ │ ┌──────────────────────────────────────────┐  │ │ ✓ Max drawdown: SAFE (current: -5%, max: -15%)  │ │ ✓ Turnover limit: SAFE (est: 22%, max: 35%)    │ │ ⚠ Liquidity: WARN (MSFT order > 50% daily vol) │ │ ✓ Sector limit: SAFE (Tech: 42%, max: 50%)     │ │ ✗ Min notional: FAIL (BUY order $5K, min: $10K)│ │                                          │ │ Estimated Impact:                        │ │ • Execution cost: ~$8,500 (0.35% of AUM)     │ │ • Tax impact: $2,100 (long-term gains)       │ │ • Expected return: +0.8% (next 30 days) │ │ • New portfolio risk: -0.3% volatility       │ │ └──────────────────────────────────────────┘  │ │                                               │ │ Approval Workflow                            │ │ ┌──────────────────────────────────────────┐  │ │ Current Status: READY FOR SUBMISSION     │  │ │ Approver: [Your Wealth Manager]          │  │ │ [Submit for Approval]      [Cancel]      │  │ │ ⓘ All constraints satisfied. Ready to go.   │  │ └──────────────────────────────────────────┘  │                                               │ └──────────────────────────────────────────────┘
```

**Components & Interactions:**

1. **Source Selector**
   - Dropdown: "Strategy" or "Manual"
   - If Strategy: select strategy name from list
   - Displays: "Growth Momentum | Monthly Rebalance"
   - If Manual: show "Manual order entry" (simple form)

2. **Portfolio Selector**
   - Dropdown: list of portfolios
   - Shows total value for each
   - Selected: display current allocation

3. **Current vs Target Comparison**
   - Side-by-side donut charts
   - Left: Current allocation (last synced holdings)
   - Right: Target allocation (after executing orders)
   - Connecting lines/arrows showing changes
   - Color-coded: green (increase good), red (decrease/concern)
   - Summary: "37% allocation change"

4. **Proposed Trades Table**
   - Columns:
     - Ticker (clickable → security detail)
     - Action (BUY, SELL, MOVE)
     - Shares (number)
     - Price (current market or limit order)
     - Amount (dollar value, bold)
     - Tax impact (if applicable)
     - Actions: edit order, remove from plan
   - Expandable rows: show rationale (from strategy)
   - Summary rows:
     - Total cash outflow
     - Total cash inflow
     - Net impact
     - Total estimated tax impact

5. **Constraint Violations Panel**
   - Traffic light system:
     - ✓ Green: Constraint satisfied
     - ⚠ Amber: Constraint warning (near limit)
     - ✗ Red: Constraint violated
   - Each constraint shows:
     - Name (e.g., "Max drawdown")
     - Current value vs limit
     - Recommendation if violated

6. **Estimated Impact Panel**
   - Execution costs: estimated commission + market impact
   - Tax impact: realized gains/losses, tax-loss harvesting opportunities
   - Expected performance: projected return for next period (if strategy backtest data available)
   - Portfolio risk: change in volatility
   - Liquidity impact: warning if order size > typical daily volume

7. **Approval Workflow**
   - Status display: "READY FOR SUBMISSION" | "PENDING APPROVAL" | "APPROVED" | "REJECTED"
   - Approver name (if applicable)
   - Submit button: disabled if violations present or constraints not met
   - Cancel button: discard order plan
   - On submit: opens confirmation dialog with final summary

8. **Confirmation Dialog**
   - Summary of all orders
   - Total investment: $XXX
   - Estimated total cost/tax impact
   - Acknowledge checkbox: "I understand the risks"
   - Confirm button: actually submits orders for approval

**Mock Data Shape:**

```typescript
interface OrderPlan {
  id: string;
  portfolioId: string;
  sourceType: 'strategy' | 'manual';
  sourceId?: string;  // Strategy ID if source is strategy
  orders: ProposedOrder[];
  currentAllocation: AllocationBreakdown;
  targetAllocation: AllocationBreakdown;
  constraints: ConstraintValidation[];
  estimatedImpact: {
    executionCost: number;
    taxImpact: number;
    expectedReturn?: number;
    riskChange?: number;
  };
  status: 'draft' | 'ready' | 'pending_approval' | 'approved' | 'rejected' | 'executing';
  approverNotes?: string;
  createdAt: Date;
  submittedAt?: Date;
  approvedAt?: Date;
}

interface ProposedOrder {
  id: string;
  ticker: string;
  action: 'buy' | 'sell';
  shares: number;
  limitPrice?: number;
  estimatedCost: number;
  taxImpact: number;
  rationale?: string;
}

interface ConstraintValidation {
  constraintId: string;
  name: string;
  currentValue: number;
  limit: number;
  status: 'satisfied' | 'warning' | 'violated';
  message: string;
  recommendation?: string;
}
```

---

### 5.10 Execution Monitor (/execution/active)

**Route:** `/execution/active`

**Layout:**

```
┌──────────────────────────────────────────────┐
│ PageHeader: Active Orders                    │
│ [Kill Switch - STOP ALL] [History]           │
│ Execution Status: 8/12 filled, 4 pending     │
├──────────────────────────────────────────────┤
│                                               │
│ ┌────────────────────────────────────────┐   │
│ │ ✓ Execution: +$2,450 | -3.2% P&L       │   │
│ │ Status: ACTIVE | Started: 2024-12-20   │   │
│ │ [Resume] [Pause] [Modify]               │   │
│ └────────────────────────────────────────┘   │
│                                               │
│ Active Orders Table                          │
│ ┌──────────────────────────────────────────┐ │
│ │ # │Ticker│Action│ Shares│Filled │Status  │ │
│ │ 1 │ AAPL │ SELL │  150  │ 150   │ ✓Filled│ │
│ │ 2 │ MSFT │ BUY  │  100  │  75   │ ▮▮▮ 75%│ │ │ 3 │GOOGL │ SELL │   85  │   0   │ ⧗ Pend │ │ │ 4 │ AMZN │ BUY  │  200  │ 180   │ ▮▮▮ 90%│ │ │ 5 │ META │ BUY  │  120  │   0   │ ⧗ Pend │ │
│ │                                           │
│ │ [Pause Execution] [Cancel Pending]        │
│ │ [Modify Order 2] [Cancel Order 3]         │
│ └──────────────────────────────────────────┘ │
│                                               │
│ Fill Progress (Visual Timeline)              │
│ ┌──────────────────────────────────────────┐ │
│ │ [████░░░░] 12/15 orders (80% complete)  │ │
│ │ Estimated completion: 2 hours            │ │
│ └──────────────────────────────────────────┘ │
│                                               │
│ Performance Summary                           │
│ ┌──────────────────────────────────────────┐ │
│ │ Avg execution price vs target:            │ │
│ │ • AAPL: $175.25 (target $175) ✓ Better   │ │
│ │ • MSFT: $411.50 (target $410) ✗ Worse    │ │
│ │ • Total slippage: $250 (0.08%)            │ │
│ │ • Estimated P&L impact: -$250            │ │
│ └──────────────────────────────────────────┘ │
│                                               │
│ ┌────────────────────────────────────────┐   │
│ │ KILL SWITCH - STOP ALL EXECUTION       │   │
│ │ [🛑 EMERGENCY STOP - ALL ORDERS]        │   │
│ │ ⓘ Use only in emergency situations      │   │
│ │ [Click to Confirm]                      │   │
│ └────────────────────────────────────────┘   │
│                                               │
│ Audit Log                                    │
│ ┌──────────────────────────────────────────┐ │
│ │ 14:25:32 │ Order 4 (AMZN BUY) │ Partial  │ │
│ │ 14:23:15 │ Order 1 (AAPL SELL) │ Filled  │ │
│ │ 14:21:47 │ Order 2 (MSFT BUY) │ Placed  │ │
│ │ 14:20:01 │ Execution started   │ OK      │ │
│ │ 13:45:22 │ Orders approved     │ Approved│ │
│ └──────────────────────────────────────────┘ │
│                                               │
└──────────────────────────────────────────────┘
```

**Components & Interactions:**

1. **Execution Status Header**
   - Summary: "8/12 orders filled, 4 pending"
   - Execution performance: net P&L since execution started
   - Timestamp: when execution started
   - Status badge: ACTIVE, PAUSED, COMPLETED, ERROR
   - Action buttons: Resume, Pause, Modify orders

2. **Active Orders Table**
   - Columns:
     - Order # (sequential)
     - Ticker (clickable)
     - Action (BUY/SELL)
     - Target shares
     - Filled shares
     - Status + fill progress bar
     - Avg execution price vs limit
     - Actions: pause, modify limit price, cancel
   - Row states:
     - Completed (grayed out)
     - Partial fill (progress bar shows %)
     - Pending (striped background)
     - Error (red background)

3. **Fill Progress Timeline**
   - Horizontal bar showing order fill progress
   - Percentage: "80% complete"
   - Estimated remaining time
   - Visual: filled portion in primary color, remaining in light gray

4. **Performance Summary**
   - For each order: actual avg execution price vs intended target
   - Slippage indicator: better/worse than target
   - Total slippage across all orders
   - Estimated P&L impact from slippage

5. **Kill Switch Button**
   - Large, prominent red button
   - Label: "🛑 EMERGENCY STOP - ALL ORDERS"
   - Hover state: darker red, appears more urgent
   - On click: confirmation dialog:
     - "Stop all execution? This cannot be undone."
     - "Active orders will be cancelled."
     - Cancel / Confirm buttons
   - On confirm: immediately cancels all pending orders, pauses execution
   - Notification: email + in-app alert to user + compliance team

6. **Audit Log**
   - Chronological log of all execution events
   - Columns: Timestamp (HH:MM:SS), Event, Status, Details
   - Events: order placed, filled, partial fill, cancelled, error
   - Sortable, filterable by order
   - Expandable rows: show full order details
   - Export button: download as CSV

7. **Order Status Notifications**
   - Real-time updates as fills occur
   - Toast notifications on fill events
   - Example: "MSFT order 25 shares filled @ $411.25"
   - Click to see order detail

**Mock Data Shape:**

```typescript
interface ActiveExecution {
  id: string;
  portfolioId: string;
  orders: ActiveOrder[];
  status: 'active' | 'paused' | 'completed' | 'error';
  startedAt: Date;
  completedAt?: Date;
  estimatedCompletionTime?: Date;
  totalSlippage: number;
  estimatedPnL: number;
}

interface ActiveOrder {
  id: string;
  ticker: string;
  action: 'buy' | 'sell';
  targetShares: number;
  filledShares: number;
  remainingShares: number;
  avgExecutionPrice: number;
  targetPrice?: number;
  status: 'pending' | 'partial' | 'filled' | 'cancelled' | 'error';
  fills: OrderFill[];
  errorMessage?: string;
}

interface OrderFill {
  timestamp: Date;
  shares: number;
  price: number;
  commission?: number;
}

interface ExecutionAuditLog {
  timestamp: Date;
  event: string;
  orderId?: string;
  status: string;
  details?: string;
}
```

---

## 6. Interaction Patterns & Micro-interactions

### 6.1 Chart Interactions

**Tooltip on Hover:**
- Appears 100ms after hover
- Shows: date, values for all series, change %
- Positioned near cursor, stays within viewport
- Fade in 100ms, fade out on mouse leave

**Crosshair on Hover:**
- Vertical line following cursor
- Shows on all time series charts
- Snap to nearest data point
- Subtle animation (no flashing)

**Zoom/Pan:**
- Click and drag on chart to zoom to date range
- Double-click to reset
- Pinch on mobile to zoom
- Momentum-based pan on touch

**Legend Interaction:**
- Click legend item to toggle series visibility
- Fade out removed series (200ms)
- Remember toggle state in localStorage

### 6.2 Form Interactions

**Auto-save:**
- Save on blur (after 500ms debounce)
- Show "saving..." indicator (subtle, not intrusive)
- Show "saved" checkmark (2s, then fade)
- Show error toast on save failure

**Validation:**
- Real-time validation on blur (not on keystroke)
- Show error message below field in red
- Disable submit button if form invalid
- Highlight invalid fields with red border

**Autocomplete:**
- Show suggestions on focus (if input empty)
- Filter on keystroke (case-insensitive)
- Keyboard navigation: ↑↓ arrows, Enter to select, Esc to close
- Debounce API calls (300ms)

### 6.3 Table Interactions

**Row Hover:**
- Subtle background highlight (#f9fafb)
- Show expand icon and action buttons
- No bold or color change (keeps visual calm)

**Expandable Rows:**
- Click row or expand icon to open detail
- Slide down animation (200ms ease-out)
- Related content fades in
- Click again to collapse

**Sort:**
- Click column header to sort
- Up arrow (↑) for ascending, down (↓) for descending
- Multi-column sort: Shift+click
- Visual indicator: primary color arrow

**Filter:**
- Click filter icon in header
- Dropdown menu or modal
- Apply filter immediately (live updating)
- Show filter pills in toolbar with X to clear

**Virtualization:**
- For tables > 100 rows
- Render only visible rows + buffer (50px above/below viewport)
- Scroll feels natural despite virtualization
- Show skeleton cells while scrolling for data rows being fetched

### 6.4 Modal & Drawer Animations

**Open:**
- Fade in backdrop (100ms)
- Slide up from bottom (200ms ease-out) on mobile
- Slide in from right (200ms ease-out) on desktop
- Scale up from center (150ms ease-out) for small modals

**Close:**
- Reverse animation (150ms ease-in)
- Disable page scroll while open

**Stacking:**
- Multiple modals stack (second appears behind first)
- Backdrop darkens additively if multiple modals open

### 6.5 Loading States

**Skeleton Screens:**
- Never spinners for main content (poor UX for data apps)
- Skeleton matches content shape (table, card, chart)
- Subtle pulse animation (#e5e7eb → #d1d5db)
- Pulse duration: 1.5s infinite

**Progressive Loading:**
- Load above-the-fold content first (dashboard hero)
- Load charts and tables sequentially
- Use stream rendering (Next.js) for server components

**Optimistic Updates:**
- Update UI immediately on user action
- Request in background
- Revert on error with toast notification
- Example: adding tag to thesis, removing filter

### 6.6 Keyboard Shortcuts

**Global:**
- `⌘K` / `Ctrl+K`: Open command palette
- `⌘/` / `Ctrl+/`: Open help
- `⌘B` / `Ctrl+B`: Toggle sidebar
- `Esc`: Close current modal/panel

**Contextual:**
- Within thesis editor: `⌘S` / `Ctrl+S`: Save
- Within table: `↑↓`: navigate rows, `Enter`: expand
- Within modal: `Esc`: cancel, `Ctrl+Enter`: submit

**Accessibility:**
- All shortcuts accessible from help menu
- No hidden shortcuts (discoverable)
- Don't trap users (shortcuts don't prevent form submission)

### 6.7 Toast Notifications

**Behavior:**
- Bottom-right corner, 16px from edge
- Auto-dismiss: 5 seconds (configurable)
- Stack vertically if multiple toasts
- Slide up animation (150ms ease-out)

**Types:**
- **Success** (green): "Strategy saved"
- **Error** (red): "Failed to fetch data" + Retry button
- **Warning** (amber): "Stale data, tap to refresh"
- **Info** (blue): "New feature available"

**Interaction:**
- Click toast to dismiss immediately
- Hover pauses auto-dismiss timer
- Action button: "Undo", "Retry", "Learn more"

### 6.8 Empty States

**Design:**
- Icon or illustration (200px)
- Clear headline ("No portfolios yet")
- Descriptive subtitle (1-2 sentences)
- Primary CTA button ("Create Portfolio")
- Optional: secondary link ("Browse templates")

**Animation:**
- Fade in (200ms) when content loads
- Icon/illustration has subtle motion (e.g., float animation)

### 6.9 Drag & Drop

**Visual Feedback:**
- Drag item becomes slightly transparent (0.7 opacity)
- Drop target highlights (light primary background)
- Cursor changes to grab/grabbing
- Smooth reorder animation (150ms) on drop

**Touch Support:**
- Long-press to initiate drag (500ms)
- Visual feedback on long-press (haptic + elevation)
- Drag while touching shows preview below finger
- Drop on release

**Undo Support:**
- Drag-drop actions are undoable
- Toast with "Undo" action button (5s timeout)

---

## 7. Data Flow & State Management

### 7.1 Global State (Zustand)

```typescript
import { create } from 'zustand';

interface AppStore {
  // UI State
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  activePortfolioId: string | null;
  commandPaletteOpen: boolean;

  // User Preferences
  theme: 'light' | 'dark';
  dateFormat: 'US' | 'ISO' | 'EU';
  numberFormat: 'en-US' | 'de-DE' | 'fr-FR';
  defaultChartPeriod: '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y';

  // Notification State
  notificationCount: number;
  unreadThesisCount: number;

  // Actions
  toggleSidebar: () => void;
  setActivePortfolio: (id: string) => void;
  toggleRightPanel: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  // Initial state
  sidebarOpen: true,
  rightPanelOpen: false,
  activePortfolioId: null,
  commandPaletteOpen: false,
  theme: 'light',
  dateFormat: 'US',
  numberFormat: 'en-US',
  defaultChartPeriod: 'YTD',
  notificationCount: 0,
  unreadThesisCount: 0,

  // Actions
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setActivePortfolio: (id) => set({ activePortfolioId: id }),
  // ... rest of actions
}));
```

### 7.2 Server State (TanStack Query)

```typescript
// Portfolio queries
export const usePortfolios = () => {
  return useQuery({
    queryKey: ['portfolios'],
    queryFn: () => fetch('/api/portfolios').then(r => r.json()),
    staleTime: 30 * 1000,  // 30 seconds
    cacheTime: 5 * 60 * 1000,  // 5 minutes
  });
};

export const usePortfolio = (id: string) => {
  return useQuery({
    queryKey: ['portfolio', id],
    queryFn: () => fetch(`/api/portfolios/${id}`).then(r => r.json()),
    staleTime: 30 * 1000,
    enabled: !!id,
  });
};

export const usePortfolioHoldings = (id: string) => {
  return useQuery({
    queryKey: ['portfolio', id, 'holdings'],
    queryFn: () => fetch(`/api/portfolios/${id}/holdings`).then(r => r.json()),
    staleTime: 60 * 1000,
  });
};

// Optimistic updates
export const useUpdateHolding = () => {
  const queryClient = useQueryClient();

  return useMutation(
    (holding: Holding) => fetch(`/api/holdings/${holding.id}`, {
      method: 'PATCH',
      body: JSON.stringify(holding),
    }),
    {
      onMutate: (newHolding) => {
        // Optimistically update cache
        queryClient.setQueryData(
          ['portfolio', newHolding.portfolioId, 'holdings'],
          (old: Holding[]) =>
            old.map(h => h.id === newHolding.id ? newHolding : h)
        );
      },
      onError: (err, newHolding) => {
        // Revert on error
        queryClient.invalidateQueries(
          ['portfolio', newHolding.portfolioId, 'holdings']
        );
      },
    }
  );
};
```

### 7.3 Form State (React Hook Form + Zod)

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const ThesisSchema = z.object({
  ticker: z.string().min(1, 'Ticker required'),
  hypothesis: z.string().min(10, 'Min 10 characters'),
  evidenceFor: z.string().optional(),
  evidenceAgainst: z.string().optional(),
  conviction: z.enum(['high', 'medium', 'low']),
  priceTargets: z.object({
    bull: z.number().positive(),
    base: z.number().positive(),
    bear: z.number().positive(),
  }),
});

type ThesisFormData = z.infer<typeof ThesisSchema>;

function ThesisForm({ initialData }: { initialData?: Thesis }) {
  const { register, handleSubmit, formState: { errors }, watch } = useForm<ThesisFormData>({
    resolver: zodResolver(ThesisSchema),
    defaultValues: initialData,
    mode: 'onBlur',  // Validate on blur, not onChange
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('ticker')} />
      {errors.ticker && <span>{errors.ticker.message}</span>}

      {/* Rest of form */}
    </form>
  );
}
```

### 7.4 URL State (Next.js searchParams)

```typescript
// /portfolios page with filters
import { useSearchParams } from 'next/navigation';

export default function PortfoliosPage() {
  const searchParams = useSearchParams();
  const ticker = searchParams.get('ticker');
  const sortBy = searchParams.get('sort') || 'value';
  const page = parseInt(searchParams.get('page') || '1');

  return (
    <div>
      {/* Show filtered results based on searchParams */}
    </div>
  );
}

// Update URL when filters change
function updateFilters(filters: FilterState) {
  const params = new URLSearchParams(searchParams);
  params.set('ticker', filters.ticker);
  params.set('sort', filters.sortBy);
  params.set('page', '1');

  router.push(`?${params.toString()}`);
}
```

### 7.5 Cache Strategy

**Data Freshness Guidelines:**
- **Portfolio value**: 30 seconds (refresh frequently)
- **Holdings**: 60 seconds
- **Performance data**: 5 minutes (relatively static)
- **Market data (prices)**: 5 minutes
- **Settings**: 30 minutes (rarely changes)
- **User profile**: 60 minutes

**Background Refetch:**
- TanStack Query refetches stale data when window regains focus
- Refetch when user returns to portfolio after 5+ minutes away
- Don't refetch if tab inactive (check with Page Visibility API)

---

## 8. Performance Budget

### 8.1 Core Web Vitals

- **First Contentful Paint (FCP):** < 1.2s
- **Largest Contentful Paint (LCP):** < 2.5s
- **Cumulative Layout Shift (CLS):** < 0.1
- **First Input Delay (FID):** < 100ms (or Interaction to Next Paint < 200ms)
- **Time to Interactive (TTI):** < 3.5s

### 8.2 Bundle Size Budget

```
Target Total: < 200KB gzipped initial JS

Breakdown:
├─ Next.js runtime:          ~35KB
├─ React 19:                 ~42KB
├─ React Router (TanStack):  ~0KB (URL-based, built-in)
├─ shadcn/ui (5-8 comps):   ~20KB
├─ Tailwind CSS:             ~15KB
├─ TanStack Query:           ~15KB
├─ Recharts (basic):         ~35KB
├─ Framer Motion:            ~28KB
├─ date-fns:                 ~13KB
├─ React Hook Form:          ~8KB
├─ Zod:                      ~7KB
└─ App code + utilities:     ~40KB
────────────────────────────────────
Total (uncompressed):        ~258KB
Total (gzipped):            ~87KB target
```

**Code Splitting Strategy:**
- **Lightweight Charts:** Lazy load on /performance page (20KB, load on demand)
- **Strategy Builder:** Dynamic import when /strategies/builder loaded (30KB)
- **Chart detail views:** Code split per chart type (Recharts variants)
- **PDF export:** Load PDFKit only when export button clicked (15KB)

**Asset Optimization:**
- Compress all images (PNG → WebP with fallback)
- SVG icons: inline (no HTTP request)
- Fonts: use system fonts or minimal Google Fonts (Inter + JetBrains Mono)
- Images: lazy load below-the-fold (loading="lazy")

### 8.3 Runtime Performance Targets

**Chart Rendering:**
- Standard Recharts: < 100ms for 5 years of daily data
- Lightweight Charts (candlestick): < 50ms
- Allocation donut: < 50ms

**Table Rendering:**
- Virtual

ized table: smooth 60fps scroll with 1000+ rows
- DataTable sort: < 100ms
- Filter: < 200ms with API call

**Page Transitions:**
- Route change: < 300ms to interactive
- Modal open/close: 200ms animation + < 50ms layout
- Chart zoom: < 100ms redraw

**API Response Times:**
- Portfolio data: < 500ms (cached 30s)
- Holdings: < 800ms
- Performance analytics: < 2s (more compute-heavy)
- Search/filter: < 800ms

### 8.4 Caching Strategy

**HTTP Caching:**
- Static assets: 1 year (cache busting via versioning)
- API responses: 30s-5min (via Cache-Control headers)
- HTML: no-cache (always fetch, but validate with ETag)

**Browser Caching:**
- Service Worker for offline support
- Cache API for offline-first strategies
- IndexedDB for larger datasets (trade history)

**CDN:**
- CloudFlare or Vercel Edge Network
- Cache invalidation on data updates
- Stale-while-revalidate pattern for frequently accessed data

---

## 9. Accessibility Requirements

### 9.1 WCAG 2.1 Level AA Compliance

**Color Contrast:**
- Normal text: 4.5:1 ratio (white text on primary-500 = OK)
- Large text (18px+): 3:1 ratio
- UI components: 3:1 ratio for borders/edges
- Non-text elements (charts): 3:1 ratio

**Color Dependencies:**
- Don't rely on color alone to convey information
- Always use icons, text, or patterns in addition
- Example: "Green = positive, Red = negative" + ↑ or ↓ symbol

**Focus Indicators:**
- All interactive elements: visible focus ring (2px primary-500)
- Focus trap in modals
- Focus outline never hidden (no outline: none)
- Focus visible on keyboard navigation only (not mouse)

**Keyboard Navigation:**
- All functionality accessible via keyboard
- Tab order logical and intuitive (left-to-right, top-to-bottom)
- Skip links to main content
- Shortcuts disclosed (in help menu or tooltip)

### 9.2 Screen Reader Support

**ARIA Labels:**
```html
<!-- Example from portfolio table -->
<th scope="col" aria-label="Ticker Symbol">Ticker</th>
<button aria-label="Sort by value, ascending">
  Value <span aria-hidden="true">↑</span>
</button>

<!-- Chart with accessible table fallback -->
<figure>
  <div role="img" aria-label="Portfolio performance 2024">
    {/* Chart */}
  </div>
  <table aria-label="Performance data backing chart">
    {/* Accessible table with data */}
  </table>
</figure>

<!-- Form -->
<label htmlFor="ticker-input">Ticker Symbol</label>
<input id="ticker-input" aria-describedby="ticker-help" />
<span id="ticker-help">Enter 1-5 character ticker (e.g., AAPL)</span>
```

**Live Regions:**
- Toast notifications: `role="status" aria-live="polite"`
- Loading states: `aria-busy="true"`
- Form errors: announce via `aria-invalid="true"` + error message

**Semantic HTML:**
- Use `<button>` for buttons (not `<div>`)
- Use `<nav>` for navigation
- Use `<main>` for main content
- Use `<article>` for blog/thesis content
- Headings: `<h1>` → `<h6>` in proper hierarchy

### 9.3 Motion & Vestibular Accessibility

**Reduced Motion Support:**
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- Disable animations for users with `prefers-reduced-motion: reduce`
- Animations still functional but instant
- Charts: allow instant render toggle

**Flashing/Strobing:**
- No flashing content (> 3 per second)
- Pulse animations slow (1-2 second duration minimum)

### 9.4 Text & Readability

**Font Sizes:**
- Minimum: 14px for body text
- Headings: 20px+
- Form labels: 14px+
- User can scale browser up to 200% without loss of functionality

**Line Height & Spacing:**
- Line height: 1.5 minimum for body text
- Paragraph spacing: 1.5x line height
- Letter spacing: allow adjustment via user CSS

**Language:**
- Plain language (avoid jargon)
- Abbreviations: define first use or via `<abbr title="">`
- Reading level: 8th-10th grade equivalent

### 9.5 Testing Checklist

- [ ] Use keyboard only to navigate entire app
- [ ] Test with screen reader (NVDA, JAWS, VoiceOver)
- [ ] Check color contrast with WebAIM tool
- [ ] Verify focus indicators visible
- [ ] Test at 200% zoom
- [ ] Verify with reduced motion enabled
- [ ] Run Lighthouse accessibility audit
- [ ] Test with accessibility testing tools (Axe, Pa11y)

---

## 10. Mock Data Schemas

### 10.1 Portfolio & Holdings

```typescript
interface Portfolio {
  id: string;
  name: string;
  description?: string;
  totalValue: number;
  cashBalance: number;
  costBasis: number;
  unrealizedGain: number;
  unrealizedGainPercent: number;
  dayChange: number;
  dayChangePercent: number;
  accountCount: number;
  linkedAccounts: string[];
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt: Date;
}

interface Holding {
  id: string;
  portfolioId: string;
  ticker: string;
  securityName: string;
  quantity: number;
  currentPrice: number;
  marketValue: number;
  percentOfPortfolio: number;
  costBasis: number;
  costBasisPerShare: number;
  unrealizedGain: number;
  unrealizedGainPercent: number;
  dayChange: number;
  dayChangePercent: number;
  currency: string;
  accountId: string;  // Which account this holding is in
  priceChart: { date: Date; price: number }[];
  linkedThesis?: string;  // Thesis ID if applicable
}

interface Transaction {
  id: string;
  portfolioId: string;
  date: Date;
  type: 'trade' | 'dividend' | 'interest' | 'fee' | 'corp_action';
  ticker?: string;
  action?: 'buy' | 'sell';
  quantity?: number;
  price?: number;
  amount: number;
  fee?: number;
  currency: string;
  accountId: string;
  notes?: string;
  brokerReference?: string;
}

interface CorporateAction {
  id: string;
  ticker: string;
  date: Date;
  type: 'split' | 'dividend' | 'spinoff' | 'merger' | 'other';
  ratio?: number;  // For splits
  amount?: number;  // For dividends
  description: string;
}
```

### 10.2 Performance & Analytics

```typescript
interface PerformanceMetrics {
  period: DateRange;
  startDate: Date;
  endDate: Date;
  startValue: number;
  endValue: number;
  twr: number;  // Time-Weighted Return
  mwr: number;  // Money-Weighted Return (IRR)
  cagr?: number;  // Compound Annual Growth Rate (for multi-year)
  totalReturn: number;
  annualizedReturn?: number;
  benchmark: BenchmarkMetrics;
  alpha: number;
  beta: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  volatility: number;
  winningDays: number;
  losingDays: number;
  winRate: number;
}

interface BenchmarkMetrics {
  name: string;
  ticker: string;
  return: number;
  alpha: number;
  beta: number;
  correlation: number;
}

interface Attribution {
  benchmarkReturn: number;
  allocationEffect: number;  // Over/underweight positions
  selectionEffect: number;   // Security selection
  interactionEffect: number;
  feeImpact: number;
  totalReturn: number;
  byCategory: AttributionCategory[];
  bySector: AttributionCategory[];
}

interface AttributionCategory {
  name: string;
  allocationEffect: number;
  selectionEffect: number;
  interactionEffect: number;
  totalEffect: number;
}

interface Drawdown {
  date: Date;
  peakValue: number;
  troughValue: number;
  drawdownPercent: number;
  durationDays: number;
}
```

### 10.3 Research & Theses

```typescript
interface Thesis {
  id: string;
  userId: string;
  ticker: string;
  securityName: string;
  title: string;
  hypothesis: string;
  conviction: 'high' | 'medium' | 'low';
  timeHorizon: string;
  status: 'active' | 'tested' | 'abandoned' | 'archived';
  evidenceForText: string;
  evidenceAgainstText: string;
  risksText: string;
  catalystsList: Catalyst[];
  priceTargets: {
    bull: number;
    base: number;
    bear: number;
    targetDate?: Date;
  };
  linkedEvidence: Evidence[];
  linkedTrades: string[];  // Trade IDs
  linkedJournalEntries: string[];
  healthScore: number;  // 0-100
  createdAt: Date;
  updatedAt: Date;
  lastReviewDate?: Date;
}

interface Catalyst {
  id: string;
  date: Date;
  dateEnd?: Date;
  description: string;
  probability?: number;  // 0-1
  impact?: 'high' | 'medium' | 'low';
  occurred?: boolean;
  outcomeNotes?: string;
}

interface Evidence {
  id: string;
  thesisId: string;
  type: 'article' | 'transcript' | 'chart' | 'data' | 'custom';
  title: string;
  source: string;
  url?: string;
  content?: string;
  datePublished?: Date;
  dateAdded: Date;
  summary?: string;
  sentiment?: 'bullish' | 'neutral' | 'bearish';
}

interface Watchlist {
  id: string;
  userId: string;
  name: string;
  description?: string;
  tickers: WatchlistItem[];
  createdAt: Date;
  updatedAt: Date;
}

interface WatchlistItem {
  ticker: string;
  priceTarget?: number;
  priceTargetReason?: string;
  alertPrice?: number;
  linkedThesis?: string;
  dateAdded: Date;
  notes?: string;
}

interface JournalEntry {
  id: string;
  userId: string;
  date: Date;
  ticker: string;
  action: 'buy' | 'sell' | 'hold';
  price?: number;
  rationale: string;
  conviction: 'high' | 'medium' | 'low';
  timeHorizon: string;
  expectedOutcome: string;
  linkedThesis?: string;
  linkedTrade?: string;
  tags: string[];
  outcome?: {
    actualReturn: number;
    result: 'correct' | 'incorrect' | 'partial';
    reviewedAt: Date;
    reflection: string;
    lessonsLearned: string;
  };
  reviewDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### 10.4 Strategies & Backtesting

```typescript
interface Strategy {
  id: string;
  userId: string;
  name: string;
  description?: string;
  status: 'draft' | 'backtested' | 'approved' | 'staging' | 'live' | 'archived';
  universe: StrategyUniverse;
  signals: Signal[];
  entryExit: EntryExitRules;
  sizing: SizingRules;
  rebalance: RebalanceRules;
  constraints: Constraint[];
  backtests: Backtest[];
  liveExecution?: LiveExecution;
  createdAt: Date;
  updatedAt: Date;
  backtestCount: number;
  winRate?: number;  // From latest backtest
}

interface StrategyUniverse {
  type: 'preset' | 'custom';
  preset?: 'sp500' | 'russell2000' | 'tech100' | 'etf_list';
  customTickers?: string[];
  maxPositions: number;
  excludeTickers?: string[];
}

interface Signal {
  id: string;
  name: string;
  description?: string;
  rules: Rule[];
  conjunction: 'AND' | 'OR';
}

interface Rule {
  id: string;
  field: string;
  fieldType: 'price' | 'technical' | 'fundamental' | 'market' | 'custom';
  operator: string;  // '>', '<', '=', 'crosses_above', 'crosses_below', etc.
  value: any;
  conjunction?: 'AND' | 'OR';
}

interface EntryExitRules {
  type: 'simple' | 'custom';
  entrySignalId?: string;  // Simple: reference signal
  exitSignalId?: string;
  entryConditions?: Rule[];  // Custom: custom rules
  exitConditions?: Rule[];
  holdPeriodDays?: number;
  maxHoldingDays?: number;
}

interface SizingRules {
  method: 'equal' | 'market_cap' | 'volatility' | 'custom';
  minPosition: number;  // Percentage
  maxPosition: number;
  maxSectorExposure: number;
  formula?: string;  // For custom sizing
  leverage: {
    allowed: boolean;
    maxMarginRatio?: number;
  };
}

interface RebalanceRules {
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  driftTolerance?: number;  // Rebalance if drift > X%
  rebalanceDates?: Date[];
}

interface Constraint {
  id: string;
  type: 'max_position' | 'min_notional' | 'sector_limit' | 'drawdown_limit' | 'turnover_limit' | 'custom';
  name: string;
  value: number;
  unit?: '%' | '$' | 'shares';
  details?: Record<string, any>;
  enabled: boolean;
  priority: number;  // Constraints evaluated in priority order
}

interface Backtest {
  id: string;
  strategyId: string;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress?: number;  // 0-100
  metrics: BacktestMetrics;
  equityCurve: { date: Date; value: number; benchmark: number }[];
  trades: BacktestTrade[];
  regimeAnalysis: RegimeMetrics[];
  sensitivityAnalysis: SensitivityAnalysis;
  warnings: BacktestWarning[];
  createdAt: Date;
  completedAt?: Date;
}

interface BacktestMetrics {
  totalReturn: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  volatility: number;
  beta: number;
  alpha: number;
  winRate: number;
  profitFactor: number;
  tradeCount: number;
  avgHoldDays: number;
  benchmark: {
    name: string;
    return: number;
  };
}

interface BacktestTrade {
  ticker: string;
  entryDate: Date;
  entryPrice: number;
  exitDate: Date;
  exitPrice: number;
  shares: number;
  returnPercent: number;
  returnDollars: number;
  holdingDays: number;
  entrySignal: string;
  exitSignal: string;
}

interface RegimeMetrics {
  regime: string;
  startDate: Date;
  endDate: Date;
  return: number;
  sharpe: number;
  maxDrawdown: number;
  tradeCount: number;
  percentOfTotalReturn: number;
}

interface SensitivityAnalysis {
  parameters: SensitivityParameter[];
  heatmap: number[][];  // 2D array of returns for different param combos
}

interface SensitivityParameter {
  name: string;
  values: number[];
}

interface BacktestWarning {
  id: string;
  severity: 'low' | 'medium' | 'high';
  type: string;  // 'overfit', 'survivorship_bias', 'data_quality', etc.
  message: string;
  suggestion: string;
}

interface LiveExecution {
  id: string;
  strategyId: string;
  status: 'pending' | 'active' | 'paused' | 'completed';
  portfolioIds: string[];
  startDate: Date;
  lastRebalanceDate: Date;
  trades: ExecutedTrade[];
}

interface ExecutedTrade {
  id: string;
  ticker: string;
  action: 'buy' | 'sell';
  quantity: number;
  executedPrice: number;
  executedAt: Date;
  commission: number;
  brokerRef: string;
}
```

### 10.5 Execution & Orders

```typescript
interface OrderPlan {
  id: string;
  portfolioId: string;
  sourceType: 'strategy' | 'manual';
  sourceId?: string;
  orders: ProposedOrder[];
  currentAllocation: AllocationBreakdown;
  targetAllocation: AllocationBreakdown;
  constraints: ConstraintValidation[];
  estimatedImpact: {
    executionCost: number;
    taxImpact: number;
    expectedReturn?: number;
    riskChange?: number;
  };
  status: 'draft' | 'ready' | 'pending_approval' | 'approved' | 'rejected' | 'executing';
  approver?: string;
  approverNotes?: string;
  createdAt: Date;
  submittedAt?: Date;
  approvedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
}

interface ProposedOrder {
  id: string;
  ticker: string;
  action: 'buy' | 'sell';
  targetShares: number;
  limitPrice?: number;
  estimatedCost: number;
  rationale?: string;
  taxImpact: number;
}

interface ConstraintValidation {
  constraintId: string;
  name: string;
  currentValue: number;
  limit: number;
  status: 'satisfied' | 'warning' | 'violated';
  message: string;
  recommendation?: string;
}

interface ActiveExecution {
  id: string;
  portfolioId: string;
  status: 'active' | 'paused' | 'completed' | 'error';
  orders: ActiveOrder[];
  startedAt: Date;
  estimatedCompletionTime?: Date;
  completedAt?: Date;
  totalSlippage: number;
  estimatedPnL: number;
}

interface ActiveOrder {
  id: string;
  ticker: string;
  action: 'buy' | 'sell';
  targetShares: number;
  filledShares: number;
  remainingShares: number;
  avgExecutionPrice: number;
  targetPrice?: number;
  status: 'pending' | 'partial' | 'filled' | 'cancelled' | 'error';
  fills: OrderFill[];
  errorMessage?: string;
}

interface OrderFill {
  timestamp: Date;
  shares: number;
  price: number;
  commission?: number;
}

interface ExecutionAuditLog {
  id: string;
  timestamp: Date;
  executionId: string;
  event: string;  // 'order_submitted', 'order_filled', 'order_cancelled', etc.
  orderId?: string;
  status: string;
  details?: string;
}
```

---

## 11. Prototype Build Checklist

### Phase 1: Foundation (Week 1)

- [ ] **Environment Setup**
  - [ ] Initialize Next.js 15 project with TypeScript
  - [ ] Install all dependencies (see Tech Stack section)
  - [ ] Configure ESLint, Prettier
  - [ ] Set up Tailwind CSS v4
  - [ ] Configure Shadcn/ui for project

- [ ] **Design Tokens**
  - [ ] Create CSS custom properties file (colors, spacing, typography, shadows)
  - [ ] Set up Tailwind config to use design tokens
  - [ ] Create color utility components (colored backgrounds, text, borders)
  - [ ] Test design token documentation page

- [ ] **Layout Primitives**
  - [ ] AppShell component (header, sidebar, content area, right panel)
  - [ ] Sidebar navigation (collapsible, icons, labels)
  - [ ] TopBar (search, notifications, user menu)
  - [ ] Responsive breakpoint testing (desktop, tablet, mobile)

### Phase 2: Component Library (Week 1-2)

- [ ] **Layout Components**
  - [ ] PageHeader (title, subtitle, breadcrumbs, actions)
  - [ ] ContentArea (padding, max-width)
  - [ ] Panel (card, borders, shadows)
  - [ ] SplitView (responsive two-column)

- [ ] **Navigation**
  - [ ] Breadcrumbs
  - [ ] TabNav (underline, pills, segment variants)
  - [ ] CommandPalette (⌘K, search, commands)

- [ ] **Data Display**
  - [ ] StatCard (metric, change, trend)
  - [ ] MetricTile (with optional mini-chart)
  - [ ] DataTable (TanStack Table integration, sorting, filtering, virtualization)
  - [ ] SparklineCell (inline sparkline)
  - [ ] PerformanceBadge (color-coded return %)
  - [ ] ReconciliationIndicator (sync status)

- [ ] **Charts**
  - [ ] TimeSeriesChart (Recharts wrapper, interactive)
  - [ ] AllocationDonut (pie/donut)
  - [ ] DrawdownChart (area chart)
  - [ ] AttributionWaterfall
  - [ ] HeatmapGrid
  - [ ] CandlestickChart (Lightweight Charts)

- [ ] **Forms**
  - [ ] SearchInput (debounced)
  - [ ] FilterBar (multiple filters)
  - [ ] DateRangePicker (calendar UI)
  - [ ] TickerAutocomplete
  - [ ] TagInput
  - [ ] SliderInput
  - [ ] RuleBuilder (drag-drop conditions)

- [ ] **Feedback**
  - [ ] Toast notifications
  - [ ] Alert (inline)
  - [ ] EmptyState
  - [ ] LoadingSkeleton
  - [ ] ProgressIndicator
  - [ ] ConfirmationDialog

- [ ] **Specialized**
  - [ ] ThesisCard
  - [ ] JournalEntry
  - [ ] StrategyLifecycleBadge
  - [ ] OrderRow
  - [ ] ConstraintEditor
  - [ ] KillSwitchButton

### Phase 3: Pages (Week 2-3)

**Navigation & Setup**
- [ ] Create routing structure (/portfolios, /research, /strategies, /execution, etc.)
- [ ] Implement sidebar navigation with active states
- [ ] Create 404 page

**Dashboard (/)**
- [ ] Net worth hero card with sparkline
- [ ] Portfolio summary grid
- [ ] Quick actions row
- [ ] Activity feed timeline
- [ ] Market movers section
- [ ] Loading states + empty states

**Portfolio Detail (/portfolios/:id)**
- [ ] Portfolio header (name, value, period selector)
- [ ] Holdings tab
  - [ ] DataTable with sortable/filterable columns
  - [ ] Sparkline cells
  - [ ] Expandable row details
- [ ] Performance tab
  - [ ] Time series chart vs benchmark
  - [ ] Metrics cards
- [ ] Allocation tab
  - [ ] Donut chart with drill-down
  - [ ] Drift visualization
- [ ] Transactions tab
  - [ ] Paginated table
  - [ ] Type/date filters
- [ ] Alerts tab
  - [ ] Active alerts list
  - [ ] New alert form

**Performance Deep Dive (/performance)**
- [ ] Period selector buttons
- [ ] Metrics grid (TWR, MWR, Sharpe, etc.)
- [ ] Equity curve chart (interactive)
- [ ] Attribution waterfall chart
- [ ] Drawdown chart
- [ ] Regime analysis table
- [ ] Sensitivity heatmap
- [ ] Benchmark comparison table

**Account Linking (/accounts)**
- [ ] Connected accounts list
- [ ] Account status indicators (synced, stale, error)
- [ ] Add account flow (4-step wizard)
  - [ ] Institution search
  - [ ] OAuth/credentials
  - [ ] Account selection
  - [ ] Confirmation
- [ ] Reconciliation dashboard
  - [ ] Match percentage
  - [ ] Unmatched positions
  - [ ] Manual match UI

**Thesis Workspace (/research/theses/:id)**
- [ ] Thesis header (ticker, status, conviction, time horizon)
- [ ] Split view (editor left, evidence panel right)
- [ ] Structured sections
  - [ ] Hypothesis (rich text)
  - [ ] Evidence For/Against (with citations)
  - [ ] Catalysts (timeline)
  - [ ] Risks (bullet list)
  - [ ] Price Targets (bull/base/bear)
- [ ] Evidence panel
  - [ ] Linked evidence items
  - [ ] Add evidence modal
  - [ ] Drag-to-editor
- [ ] Linked trades & journal entries
- [ ] Health score gauge

**Decision Journal (/research/journal)**
- [ ] Timeline view of entries
- [ ] Entry cards with action, rationale, conviction
- [ ] Filter bar (outcome, ticker, date range)
- [ ] View full entry modal
- [ ] New entry form
- [ ] Outcome review flow
- [ ] Decision metrics

**Strategy Builder (/strategies/builder)**
- [ ] Wizard mode: 7-step form
  - [ ] Step 1: Name & Universe
  - [ ] Step 2: Signals (rule builder)
  - [ ] Step 3: Entry/Exit conditions
  - [ ] Step 4: Position Sizing
  - [ ] Step 5: Rebalance Schedule
  - [ ] Step 6: Constraints
  - [ ] Step 7: Review & Backtest
- [ ] Canvas mode (toggle)
  - [ ] Visual node editor
  - [ ] Drag-to-connect
  - [ ] Live preview
- [ ] Save/run backtest buttons

**Backtest Results (/strategies/:id/backtests/:backtestId)**
- [ ] Summary metrics cards
- [ ] Equity curve chart with benchmark
- [ ] Robustness analysis panel
  - [ ] Regime analysis table
  - [ ] Sensitivity heatmap
- [ ] Turnover chart
- [ ] Trade log table (sortable, expandable)
- [ ] Warnings panel
- [ ] Promote to paper/staging buttons
- [ ] Lifecycle badge

**Order Planner (/execution/planner)**
- [ ] Source selector (strategy or manual)
- [ ] Portfolio selector
- [ ] Current vs target allocation (pie charts)
- [ ] Proposed trades table
- [ ] Constraint violations panel
- [ ] Estimated impact summary
- [ ] Approval workflow status
- [ ] Submit/cancel buttons
- [ ] Confirmation dialog

**Execution Monitor (/execution/active)**
- [ ] Execution status header
- [ ] Active orders table
  - [ ] Status indicators
  - [ ] Fill progress bars
  - [ ] Fill % display
- [ ] Fill progress timeline
- [ ] Performance summary (slippage, execution price)
- [ ] Kill switch button
- [ ] Audit log
- [ ] Real-time update notifications

**Settings (/settings)**
- [ ] Profile section
- [ ] Integrations section
- [ ] Notification preferences
- [ ] Security (2FA)
- [ ] Data export/deletion

### Phase 4: Data & Interactions (Week 3-4)

**Mock Data**
- [ ] Create mock data generators for all entities
- [ ] Seed database/localStorage with realistic data
- [ ] Create API route handlers that return mock data
- [ ] Implement API delay simulation (200-500ms) for realism

**State Management**
- [ ] Set up Zustand store for global app state
- [ ] Implement sidebar open/close state
- [ ] Implement active portfolio context
- [ ] Set up TanStack Query for server state
- [ ] Configure query cache strategies (30s, 5min, 1hr)
- [ ] Implement optimistic updates for mutations

**Form Management**
- [ ] Integrate React Hook Form
- [ ] Set up Zod validation schemas
- [ ] Implement auto-save on blur
- [ ] Add form error display
- [ ] Create reusable form field components

**URL State**
- [ ] Implement search params for filters
- [ ] Preserve filter state in URL
- [ ] Implement pagination via URL
- [ ] Browser back/forward navigation support

**Interactions & Animations**
- [ ] Implement page transitions (fade 150ms)
- [ ] Implement modal animations (slide up, fade)
- [ ] Implement panel slide animations (200ms)
- [ ] Implement chart zoom/pan
- [ ] Implement table row expand animation
- [ ] Add loading skeleton animations
- [ ] Add hover states for all interactive elements
- [ ] Implement drag-and-drop (rule builder, constraint reordering)

**Keyboard Shortcuts**
- [ ] Implement ⌘K command palette
- [ ] Implement ⌘B sidebar toggle
- [ ] Implement ⌘S save (in forms)
- [ ] Implement Esc to close modals
- [ ] Add shortcuts help page

**Real-time Features**
- [ ] WebSocket setup (optional, for real-time order updates)
- [ ] Server-Sent Events for order fills
- [ ] Background refetch on window focus
- [ ] Service Worker for offline support (optional)

### Phase 5: Polish & Optimization (Week 4)

**Performance**
- [ ] Audit bundle size (target < 200KB gzipped)
- [ ] Code-split lazy-loadable pages
- [ ] Implement image optimization (WebP, srcset)
- [ ] Run Lighthouse audit (target 90+ scores)
- [ ] Test Core Web Vitals (FCP, LCP, CLS)
- [ ] Implement request caching strategy
- [ ] Add loading/skeleton states

**Accessibility**
- [ ] Run Axe accessibility audit
- [ ] Test keyboard navigation throughout
- [ ] Test with screen reader (NVDA/JAWS)
- [ ] Verify color contrast ratios
- [ ] Check focus indicators
- [ ] Test at 200% zoom
- [ ] Test with reduced motion enabled
- [ ] Add ARIA labels where needed
- [ ] Verify semantic HTML

**Responsiveness**
- [ ] Test on desktop (1280px+, 1920px)
- [ ] Test on tablet (768px-1279px)
- [ ] Test on mobile (< 768px)
- [ ] Test on small phones (320px)
- [ ] Test orientation changes
- [ ] Verify touch targets (min 44px)
- [ ] Test form inputs on mobile
- [ ] Verify horizontal scrolling avoided

**Cross-browser Testing**
- [ ] Test on Chrome/Chromium
- [ ] Test on Firefox
- [ ] Test on Safari (Mac + iOS)
- [ ] Test on Edge
- [ ] Verify CSS Grid/Flexbox support
- [ ] Verify CSS custom properties support
- [ ] Test fonts render correctly

**Visual Polish**
- [ ] Review component design consistency
- [ ] Check spacing/alignment on all pages
- [ ] Verify color contrast throughout
- [ ] Review typography hierarchy
- [ ] Check icon sizes and alignment
- [ ] Review button hover/active states
- [ ] Check form input states (focused, disabled, error)
- [ ] Review empty states and loading states

**Documentation**
- [ ] Component storybook (Storybook.js)
- [ ] API documentation
- [ ] Navigation map
- [ ] Data schema documentation
- [ ] Keyboard shortcuts documentation
- [ ] README for setup/development

### Phase 6: Testing (Week 4-5)

**Unit Tests**
- [ ] Test utility functions (calculations, formatting)
- [ ] Test data transformations
- [ ] Test form validation
- [ ] Aim for 80%+ coverage on utilities

**Component Tests**
- [ ] Test component rendering
- [ ] Test component interactions (clicks, typing)
- [ ] Test conditional rendering
- [ ] Test prop variations
- [ ] Aim for 70%+ coverage on components

**Integration Tests**
- [ ] Test data flow (fetch, update, display)
- [ ] Test form submission
- [ ] Test navigation
- [ ] Test error handling
- [ ] Test loading states

**E2E Tests**
- [ ] Test full user journeys
  - [ ] Portfolio view → filter holdings → view performance
  - [ ] Create thesis → add evidence → link trade
  - [ ] Build strategy → run backtest → view results
  - [ ] Create order plan → approve → execute → monitor
- [ ] Test error scenarios
- [ ] Test on target browsers

### Deliverables Checklist

- [ ] Fully functional Next.js prototype
- [ ] All 11 pages implemented and interactive
- [ ] 30+ reusable components
- [ ] Mock API endpoints
- [ ] Global navigation and routing
- [ ] Responsive design (mobile-first)
- [ ] Accessibility compliance (WCAG 2.1 AA)
- [ ] Performance optimizations
- [ ] Component documentation
- [ ] Data schemas documentation
- [ ] UX patterns documentation
- [ ] Test coverage (unit, component, integration, E2E)
- [ ] Deployment-ready (Vercel or equivalent)

---

## Appendix: Resources & References

### Design Tools
- Figma (for design handoff, prototyping)
- Storybook (for component documentation)
- Chromatic (for visual regression testing)

### Development Tools
- VS Code with extensions (Tailwind CSS IntelliSense, ES7+ React/Redux/React-Native snippets)
- GitHub for version control
- Vercel for deployment and previews
- Sentry for error tracking

### Documentation
- Next.js 15 docs: https://nextjs.org/docs
- React 19 docs: https://react.dev
- Tailwind CSS v4 docs: https://tailwindcss.com/docs
- Shadcn/ui docs: https://ui.shadcn.com
- TanStack Query docs: https://tanstack.com/query/latest
- TanStack Table docs: https://tanstack.com/table/latest

### Testing Libraries
- Vitest (unit testing)
- React Testing Library (component testing)
- Playwright (E2E testing)
- Accessibility Insights (accessibility testing)

---

**Document End**

*This specification provides a comprehensive blueprint for building Atlas Wealth's interactive prototype. Each section is detailed enough to guide development while maintaining flexibility for creative iteration. The document should be treated as a living resource—update it as design decisions evolve and as the prototype develops.*

