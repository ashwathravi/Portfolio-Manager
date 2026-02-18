## 2025-02-17 - Table Performance: SVG vs. Libraries & Algorithmic Complexity

**Learning:** Rendering heavy charting libraries (Recharts) inside tables creates massive DOM overhead. Replacing them with lightweight, memoized SVG sparklines significantly improves render performance. Additionally, ensure aggregate calculations (min/max) happen *outside* render loops to avoid O(N²) complexity (N items * N points).
**Action:** Use custom SVG for simple table visualizations and pre-calculate data bounds.

## 2025-02-16 - Memoization of List Items

**Learning:** Functional components used in lists (like `PortfolioCard` and `ActivityFeed` in `Dashboard`) are not memoized by default and will re-render on every parent state change (e.g., `allocationView` toggle).
**Action:** Wrap these components in `React.memo` if their props are stable (e.g., mock data constants) to prevent unnecessary re-renders.

## 2025-02-17 - Filter Logic Memoization & Array Spreading

**Learning:** Client-side filtering and aggregation logic in `HoldingsTable` was running on every render, even when only UI state (like `showFilters`) changed. This causes unnecessary recalculation for large lists. Also, `Math.min(...data)` spread syntax in `SparklineCell` poses a stack overflow risk for large datasets and is less performant than a simple loop.
**Action:** Use `useMemo` for filtering/aggregation results and replace spread syntax with explicit loops in data processing utilities.
