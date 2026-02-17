## 2025-02-16 - Memoization of List Items
**Learning:** Functional components used in lists (like `PortfolioCard` and `ActivityFeed` in `Dashboard`) are not memoized by default and will re-render on every parent state change (e.g., `allocationView` toggle).
**Action:** Wrap these components in `React.memo` if their props are stable (e.g., mock data constants) to prevent unnecessary re-renders.
