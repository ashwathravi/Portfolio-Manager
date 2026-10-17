# Open Questions

- Where should Schwab OAuth access and refresh tokens be stored, and how is user/account scoping supposed to work?
- Which pages are expected to become database-backed first after dashboard and holdings?
- Should portfolio analytics remain request-time calculations, or move into persisted snapshots/materialized aggregates?
- How should account linking reconcile broker accounts with the current single `portfolios` table?
- Are tags, strategies, theses, watchlists, and journal entries meant to become first-class database entities, or remain client-side for now?
