# Current Focus

- Working system today is centered on:
  - dashboard aggregation from portfolios + holdings
  - holdings table backed by DB with live quote enrichment
  - market data quote/history API routes
  - Schwab order submission endpoint.
- Database work is limited to portfolio/holding/transaction storage and seed/migration scripts.
- Execution flow exists, but the UI is still mostly local state and assumes one hard-coded portfolio/account context.
- Settings are implemented as local client state with persistence for UI preferences and tags.
- Research, strategies, performance, analytics, and most execution views are still prototype screens driven by mock arrays rather than database records or real services.
