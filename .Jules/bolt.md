## 2025-02-17 - Table Performance: SVG vs. Libraries & Algorithmic Complexity

**Learning:** Rendering heavy charting libraries (Recharts) inside tables creates massive DOM overhead. Replacing them with lightweight, memoized SVG sparklines significantly improves render performance. Additionally, ensure aggregate calculations (min/max) happen *outside* render loops to avoid O(N²) complexity (N items * N points).
**Action:** Use custom SVG for simple table visualizations and pre-calculate data bounds.

## 2025-02-16 - Memoization of List Items

**Learning:** Functional components used in lists (like `PortfolioCard` and `ActivityFeed` in `Dashboard`) are not memoized by default and will re-render on every parent state change (e.g., `allocationView` toggle).
**Action:** Wrap these components in `React.memo` if their props are stable (e.g., mock data constants) to prevent unnecessary re-renders.

## 2025-02-17 - Filter Logic Memoization & Array Spreading

**Learning:** Client-side filtering and aggregation logic in `HoldingsTable` was running on every render, even when only UI state (like `showFilters`) changed. This causes unnecessary recalculation for large lists. Also, `Math.min(...data)` spread syntax in `SparklineCell` poses a stack overflow risk for large datasets and is less performant than a simple loop.
**Action:** Use `useMemo` for filtering/aggregation results and replace spread syntax with explicit loops in data processing utilities.

## 2025-02-18 - [Sparkline Calculation Optimization]

**Learning:** String interpolation with `toFixed(2)` is significantly faster than `Number(val.toFixed(2))` inside tight loops. Also, `Math.min(...data)` can cause stack overflow on large datasets; explicit loops are safer and faster.
**Action:** Use explicit loops for min/max calculation and avoid unnecessary type casting in critical render paths.

## 2025-02-19 - Filter & Reduce Fusion

**Learning:** Combining filter and reduce into a single pass loop avoids multiple iterations (O(3N) -> O(N)) and array allocations, significantly improving performance for derived state from large lists.
**Action:** Use single-pass loops for simultaneous filtering and aggregation when dealing with large datasets.

## 2026-02-23 - Date & Currency Formatting in Render Loops

**Learning:** Instantiating `new Date()` and calling `toLocaleDateString/toLocaleString` inside a list render loop is expensive and causes unnecessary object allocation per item. Manual string parsing (for fixed formats like YYYY-MM-DD) is significantly faster and avoids potential timezone hydration mismatches (server UTC vs client Local).
**Action:** Extract `Intl` formatters to static constants and use manual string parsing for simple date formats in high-frequency lists.
