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

-- Reference data for user A's holdings (the securities master, launch item
-- i34), as the nightly job stores it: sector from the SIC code. AMZN's code
-- is catalog retail, so it's Consumer, where the old ticker map said Tech.
-- No bars: these stay unpriced.
INSERT INTO securities (symbol, name, type, primary_exchange, sector, industry, sic_code, reference_updated_at)
VALUES
  ('AAPL', 'Apple Inc.', 'CS', 'XNAS', 'Tech', 'ELECTRONIC COMPUTERS', '3571', now()),
  ('MSFT', 'Microsoft Corp', 'CS', 'XNAS', 'Tech', 'SERVICES-PREPACKAGED SOFTWARE', '7372', now()),
  ('NVDA', 'Nvidia Corp', 'CS', 'XNAS', 'Tech', 'SEMICONDUCTORS & RELATED DEVICES', '3674', now()),
  ('GOOGL', 'Alphabet Inc. Class A', 'CS', 'XNAS', 'Tech', 'SERVICES-COMPUTER PROGRAMMING, DATA PROCESSING, ETC.', '7370', now()),
  ('TSLA', 'Tesla, Inc. Common Stock', 'CS', 'XNAS', 'Auto', 'MOTOR VEHICLES & PASSENGER CAR BODIES', '3711', now()),
  ('AMZN', 'Amazon.Com Inc', 'CS', 'XNAS', 'Consumer', 'RETAIL-CATALOG & MAIL-ORDER HOUSES', '5961', now())
ON CONFLICT (symbol) DO NOTHING;

-- Attribution (launch item i50). KO and PG, in user A's valuation history,
-- get their securities-master profiles (both Consumer). The eleven SPDR
-- sector ETFs and SPY get three months of closes to Aug 28, 2026, SPY
-- moving as a fixed blend of the sectors (Technology 32%, Consumer 16%, ...),
-- so the S&P 500's sector weights can be estimated from them. On the
-- valuation dates every sector ETF moves as SPY's closes from the Returns
-- fixtures above (Aug 31, Sep 30, Oct 1): any blend fits those days, and
-- the benchmark matches SPY's +3.02%. Expected for user A:
--   All accounts: your return +9.3%, benchmark +3.0%, beat it by 6.3 pp;
--   Consumer weight 93.2%, Cash 6.8%
--   Main: your return +8.6%, Consumer weight 86.3%
UPDATE securities SET type = 'CS', sector = 'Consumer', reference_updated_at = now() WHERE symbol IN ('KO', 'PG');

INSERT INTO securities (symbol, name, type)
VALUES
  ('XLK', 'Technology Select Sector SPDR Fund', 'ETF'),
  ('XLC', 'Communication Services Select Sector SPDR Fund', 'ETF'),
  ('XLY', 'Consumer Discretionary Select Sector SPDR Fund', 'ETF'),
  ('XLP', 'Consumer Staples Select Sector SPDR Fund', 'ETF'),
  ('XLF', 'Financial Select Sector SPDR Fund', 'ETF'),
  ('XLV', 'Health Care Select Sector SPDR Fund', 'ETF'),
  ('XLI', 'Industrial Select Sector SPDR Fund', 'ETF'),
  ('XLE', 'Energy Select Sector SPDR Fund', 'ETF'),
  ('XLB', 'Materials Select Sector SPDR Fund', 'ETF'),
  ('XLRE', 'Real Estate Select Sector SPDR Fund', 'ETF'),
  ('XLU', 'Utilities Select Sector SPDR Fund', 'ETF')
ON CONFLICT (symbol) DO NOTHING;

WITH days AS (
  SELECT d::date AS date, (row_number() OVER (ORDER BY d))::int AS t
  FROM generate_series(date '2026-06-01', date '2026-08-28', interval '1 day') AS d
  WHERE extract(isodow FROM d) < 6
), etfs(symbol, i, w) AS (
  VALUES ('XLK', 0, 0.32), ('XLC', 1, 0.10), ('XLY', 2, 0.10), ('XLP', 3, 0.06), ('XLF', 4, 0.13), ('XLV', 5, 0.10),
         ('XLI', 6, 0.08), ('XLE', 7, 0.03), ('XLB', 8, 0.02), ('XLRE', 9, 0.02), ('XLU', 10, 0.04)
), daily AS (
  SELECT e.symbol, e.w, d.date, d.t,
         CASE WHEN d.t = 1 THEN 0 ELSE 0.01 * sin(1.3 * d.t + e.i) + 0.003 * cos(0.7 * d.t * (e.i + 1)) END AS r
  FROM etfs e CROSS JOIN days d
), closes AS (
  SELECT symbol, date, 100 * exp(sum(ln(1 + r)) OVER (PARTITION BY symbol ORDER BY t)) AS close FROM daily
  UNION ALL
  SELECT 'SPY', date, 500 * exp(sum(ln(1 + r)) OVER (ORDER BY t))
  FROM (SELECT date, t, sum(w * r) AS r FROM daily GROUP BY date, t) AS spy
)
INSERT INTO price_bars (symbol, date, open, high, low, close, volume, source)
SELECT symbol, date, close, close, close, close, 1000, 'e2e' FROM closes
ON CONFLICT (symbol, date) DO NOTHING;

INSERT INTO price_bars (symbol, date, open, high, low, close, volume, source)
SELECT etf.symbol, spy.date, etf.close * spy.close / base.close, etf.close * spy.close / base.close,
       etf.close * spy.close / base.close, etf.close * spy.close / base.close, 1000, 'e2e'
FROM price_bars AS etf
JOIN price_bars AS base ON base.symbol = 'SPY' AND base.date = '2026-08-28'
JOIN price_bars AS spy ON spy.symbol = 'SPY' AND spy.date IN ('2026-08-31', '2026-09-30', '2026-10-01')
WHERE etf.date = '2026-08-28'
  AND etf.symbol IN ('XLK', 'XLC', 'XLY', 'XLP', 'XLF', 'XLV', 'XLI', 'XLE', 'XLB', 'XLRE', 'XLU')
ON CONFLICT (symbol, date) DO NOTHING;
