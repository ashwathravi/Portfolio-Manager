import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  PortfolioAccessError,
  PortfolioValuationEngine,
  type PortfolioValuationQueries,
} from './portfolio-valuation-engine';
import { MarketDataNotConfiguredError } from '@/lib/providers/errors';
import type { MarketDataProvider, Quote } from '@/types/market-data';

const USER = 'user-a';
const PORTFOLIO = 'portfolio-1';

function queries(rows: Array<{ symbol: string; quantity: string; avgCost: string }>, owned = true): PortfolioValuationQueries {
  return {
    ownedPortfolio: async () => (owned ? [{ id: PORTFOLIO }] : []),
    ownedHoldings: async () => rows.map((row) => ({ ...row, name: row.symbol })),
  };
}

function provider(getBatchQuotes: (symbols: string[]) => Promise<Quote[]>): MarketDataProvider {
  const unused = async (): Promise<never> => {
    throw new Error('not used');
  };
  return { getBatchQuotes, getQuote: unused, getHistoricalPrices: unused, getFundamentals: unused, searchSymbol: unused };
}

function quote(symbol: string, price: number): Quote {
  return { symbol, price, change: 0, changePercent: 0, timestamp: '2026-07-02T20:00:00.000Z', isRealtime: false };
}

describe('PortfolioValuationEngine', () => {
  it('values holdings at their quotes and lists symbols without one', async () => {
    const engine = new PortfolioValuationEngine(
      provider(async (symbols) => symbols.filter((s) => s === 'AAPL').map((s) => quote(s, 150))),
      queries([
        { symbol: 'AAPL', quantity: '2', avgCost: '100' },
        { symbol: 'FXAIX', quantity: '1', avgCost: '50' },
      ]),
    );

    const valuation = await engine.value(PORTFOLIO, { userId: USER });

    assert.strictEqual(valuation.totalValue, 300);
    assert.deepStrictEqual(valuation.errors, ['FXAIX']);
    assert.strictEqual(valuation.holdings[0].currentPrice, 150);
  });

  it('records a failed batch as per-symbol errors', async () => {
    const engine = new PortfolioValuationEngine(
      provider(async () => {
        throw new Error('provider down');
      }),
      queries([{ symbol: 'AAPL', quantity: '1', avgCost: '100' }]),
    );

    const valuation = await engine.value(PORTFOLIO, { userId: USER });

    assert.deepStrictEqual(valuation.errors, ['AAPL']);
  });

  it('rejects when market data is not configured instead of valuing everything at zero', async () => {
    const engine = new PortfolioValuationEngine(
      provider(async () => {
        throw new MarketDataNotConfiguredError('POLYGON_API_KEY');
      }),
      queries([{ symbol: 'AAPL', quantity: '1', avgCost: '100' }]),
    );

    await assert.rejects(engine.value(PORTFOLIO, { userId: USER }), MarketDataNotConfiguredError);
  });

  it('refuses a portfolio the user does not own before pricing anything', async () => {
    let asked = false;
    const engine = new PortfolioValuationEngine(
      provider(async () => {
        asked = true;
        return [];
      }),
      queries([{ symbol: 'AAPL', quantity: '1', avgCost: '100' }], false),
    );

    await assert.rejects(engine.value(PORTFOLIO, { userId: USER }), PortfolioAccessError);
    assert.strictEqual(asked, false);
  });
});
