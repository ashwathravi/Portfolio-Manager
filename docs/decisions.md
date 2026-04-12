# Decisions

- Use Next.js App Router with React 19 and TypeScript for the full application surface.
- Keep a small normalized Postgres schema and store only snapshot-style portfolio, holding, and transaction data.
- Compute dashboard and holdings metrics at request time from DB rows plus live quotes when available, rather than storing derived analytics tables.
- Prefer graceful degradation over hard failure:
  - missing `DATABASE_URL` logs a warning
  - failed DB reads fall back to mock data in some pages
  - failed quote fetches fall back to stored prices or empty results.
- Put external brokerage and market-data calls behind thin provider clients instead of calling vendors directly from pages.
- Validate external inputs with Zod in API routes before broker or market-data calls.
- Persist only non-sensitive settings in browser storage; do not persist profile or security fields in the Zustand store.
- Ship the app as a standalone Next.js server image with security headers enabled in `next.config.ts`.
