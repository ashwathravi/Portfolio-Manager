## 2025-02-17 - Table Performance: SVG vs. Libraries & Algorithmic Complexity
**Learning:** Rendering heavy charting libraries (Recharts) inside tables creates massive DOM overhead. Replacing them with lightweight, memoized SVG sparklines significantly improves render performance. Additionally, ensure aggregate calculations (min/max) happen *outside* render loops to avoid O(N²) complexity (N items * N points).
**Action:** Use custom SVG for simple table visualizations and pre-calculate data bounds.
