-- E2E fixtures, applied by scripts/e2e/prepare-database.ts as the database
-- owner after migrations. Two users so tenant isolation can be checked: user A
-- owns three portfolios; user B owns one sentinel portfolio A must never see.

DO $$
BEGIN
  BEGIN
    INSERT INTO portfolios (id, user_id, name)
    VALUES ('00000000-0000-4000-8000-0000000000f1', NULL, 'Invalid owner fixture');
    RAISE EXCEPTION 'portfolios.user_id unexpectedly accepted NULL';
  EXCEPTION WHEN not_null_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO portfolios (id, user_id, name)
    VALUES ('00000000-0000-4000-8000-0000000000f2', 'missing-auth-user', 'Invalid owner fixture');
    RAISE EXCEPTION 'portfolios.user_id unexpectedly accepted an unmatched owner';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END $$;

INSERT INTO auth_users (id, name, email, email_verified)
VALUES
  ('00000000-0000-4000-8000-00000000a001', 'E2E User A', 'e2e-a@example.test', now()),
  ('00000000-0000-4000-8000-00000000a002', 'E2E User B', 'e2e-b@example.test', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth_sessions (session_token, user_id, expires)
VALUES
  ('e2e-session-user-a', '00000000-0000-4000-8000-00000000a001', '2099-01-01T00:00:00Z'),
  ('e2e-session-user-b', '00000000-0000-4000-8000-00000000a002', '2099-01-01T00:00:00Z')
ON CONFLICT (session_token) DO UPDATE
SET user_id = EXCLUDED.user_id, expires = EXCLUDED.expires;

INSERT INTO portfolios (id, user_id, name, description, total_value, cash_balance)
VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000a001', 'Main Portfolio', 'Long-term growth portfolio', 487250.32, 12450.00),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000a001', 'Growth Portfolio', 'High-growth technology stocks', 152340.50, 5240.00),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000a001', 'Dividend Income', 'Dividend-focused investments', 98765.25, 3120.00),
  ('00000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-00000000a002', 'Other User Portfolio', 'Must never be visible to user A', 999.00, 0.00)
ON CONFLICT (id) DO NOTHING;

INSERT INTO holdings (
  id,
  portfolio_id,
  symbol,
  name,
  quantity,
  avg_cost,
  current_price,
  market_value,
  allocation
)
VALUES
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'AAPL', 'Apple Inc.', 500, 165.30, 182.45, 91225.00, 18.7),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001', 'MSFT', 'Microsoft Corporation', 300, 325.80, 378.25, 113475.00, 23.3),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001', 'NVDA', 'NVIDIA Corporation', 200, 425.50, 512.80, 102560.00, 21.1),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001', 'GOOGL', 'Alphabet Inc.', 400, 128.90, 141.25, 56500.00, 11.6),
  ('00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000001', 'TSLA', 'Tesla, Inc.', 250, 205.40, 248.75, 62187.50, 12.8),
  ('00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000001', 'AMZN', 'Amazon.com Inc.', 350, 142.30, 165.90, 58065.00, 11.9),
  ('00000000-0000-4000-8000-000000000109', '00000000-0000-4000-8000-000000000009', 'XUSR', 'Cross Tenant Sentinel', 1, 1.00, 999.00, 999.00, 100.0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO transactions (id, portfolio_id, timestamp, type, symbol, quantity, price, amount, notes)
VALUES
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000001', now(), 'BUY', 'AAPL', 1, 182.45, 182.45, 'User A fixture'),
  ('00000000-0000-4000-8000-000000000209', '00000000-0000-4000-8000-000000000009', now(), 'BUY', 'XUSR', 1, 999.00, 999.00, 'Cross tenant sentinel')
ON CONFLICT (id) DO NOTHING;

-- Two stored closes for a symbol nobody holds, ending on the Eastern date the
-- fixtures were applied: the position detail page has a closing quote from
-- "today" to label, and to stop labelling once the date moves on.
INSERT INTO securities (symbol, name, history_start_date)
VALUES ('IBM', 'International Business Machines', (now() AT TIME ZONE 'America/New_York')::date - 1)
ON CONFLICT (symbol) DO NOTHING;

INSERT INTO price_bars (symbol, date, open, high, low, close, volume, source)
VALUES
  ('IBM', (now() AT TIME ZONE 'America/New_York')::date - 1, 200, 202, 198, 200, 1000, 'e2e'),
  ('IBM', (now() AT TIME ZONE 'America/New_York')::date, 200, 206, 199, 205, 1000, 'e2e')
ON CONFLICT (symbol, date) DO NOTHING;

-- Valuation history for user A (launch item i49), on fixed past sessions so
-- Performance › Returns has known numbers. Main holds 100 KO and 1,000 cash,
-- Growth 50 PG; on Oct 1 Main moves 500 of cash to Growth, which must not
-- count as a return. Dividend Income has no history. Nobody holds KO or PG
-- today, so the bars don't price any current holding. SPY and QQQ have a
-- close on every date; IWM and DIA have none, so they aren't offered.
--   All accounts: 14,500 -> 15,100 -> 15,850, +9.31% (no money came in)
--   Main:  +8.57% (KO +10% on 7,000, then flat), value 7,000 -> 7,100
--   Growth: +10.00% (PG +10% on Oct 1), value 7,500 -> 8,750
--   S&P 500 (SPY) +3.02%, NASDAQ-100 (QQQ) +5.00%
INSERT INTO securities (symbol, name, history_start_date)
VALUES
  ('KO', 'The Coca-Cola Company', '2026-08-31'),
  ('PG', 'Procter & Gamble', '2026-08-31'),
  ('SPY', 'SPDR S&P 500 ETF Trust', '2026-08-31'),
  ('QQQ', 'Invesco QQQ Trust', '2026-08-31')
ON CONFLICT (symbol) DO NOTHING;

INSERT INTO price_bars (symbol, date, open, high, low, close, volume, source)
VALUES
  ('KO', '2026-08-31', 60, 60, 60, 60, 1000, 'e2e'),
  ('KO', '2026-09-30', 66, 66, 66, 66, 1000, 'e2e'),
  ('KO', '2026-10-01', 66, 66, 66, 66, 1000, 'e2e'),
  ('PG', '2026-08-31', 150, 150, 150, 150, 1000, 'e2e'),
  ('PG', '2026-09-30', 150, 150, 150, 150, 1000, 'e2e'),
  ('PG', '2026-10-01', 165, 165, 165, 165, 1000, 'e2e'),
  ('SPY', '2026-08-31', 500, 500, 500, 500, 1000, 'e2e'),
  ('SPY', '2026-09-30', 510, 510, 510, 510, 1000, 'e2e'),
  ('SPY', '2026-10-01', 515.1, 515.1, 515.1, 515.1, 1000, 'e2e'),
  ('QQQ', '2026-08-31', 400, 400, 400, 400, 1000, 'e2e'),
  ('QQQ', '2026-09-30', 420, 420, 420, 420, 1000, 'e2e'),
  ('QQQ', '2026-10-01', 420, 420, 420, 420, 1000, 'e2e')
ON CONFLICT (symbol, date) DO NOTHING;

INSERT INTO portfolio_snapshots (portfolio_id, date, holdings_value, cash, total_value, cost_basis, positions)
VALUES
  ('00000000-0000-4000-8000-000000000001', '2026-08-31', 6000, 1000, 7000, 5500, 1),
  ('00000000-0000-4000-8000-000000000001', '2026-09-30', 6600, 1000, 7600, 5500, 1),
  ('00000000-0000-4000-8000-000000000001', '2026-10-01', 6600, 500, 7100, 5500, 1),
  ('00000000-0000-4000-8000-000000000002', '2026-08-31', 7500, 0, 7500, 7000, 1),
  ('00000000-0000-4000-8000-000000000002', '2026-09-30', 7500, 0, 7500, 7000, 1),
  ('00000000-0000-4000-8000-000000000002', '2026-10-01', 8250, 500, 8750, 7000, 1)
ON CONFLICT (portfolio_id, date) DO NOTHING;

INSERT INTO portfolio_snapshot_positions (portfolio_id, date, symbol, quantity, cost_basis, close, close_date, market_value)
VALUES
  ('00000000-0000-4000-8000-000000000001', '2026-08-31', 'KO', 100, 5500, 60, '2026-08-31', 6000),
  ('00000000-0000-4000-8000-000000000001', '2026-09-30', 'KO', 100, 5500, 66, '2026-09-30', 6600),
  ('00000000-0000-4000-8000-000000000001', '2026-10-01', 'KO', 100, 5500, 66, '2026-10-01', 6600),
  ('00000000-0000-4000-8000-000000000002', '2026-08-31', 'PG', 50, 7000, 150, '2026-08-31', 7500),
  ('00000000-0000-4000-8000-000000000002', '2026-09-30', 'PG', 50, 7000, 150, '2026-09-30', 7500),
  ('00000000-0000-4000-8000-000000000002', '2026-10-01', 'PG', 50, 7000, 165, '2026-10-01', 8250)
ON CONFLICT (portfolio_id, date, symbol) DO NOTHING;
