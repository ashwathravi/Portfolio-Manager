import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { topHoldings, type TopHoldingsHandValuedRow, type TopHoldingsRow } from './top-holdings';

const ticker = (symbol: string, quantity: number, price: number, avgCost = price): TopHoldingsRow => ({
    id: `h-${symbol}`, symbol, name: `${symbol} Sample Inc`, quantity, avgCost, currentPrice: price, marketValue: quantity * price,
});
const byHand = (name: string, value: number, fields: Partial<TopHoldingsHandValuedRow> = {}): TopHoldingsHandValuedRow => ({
    id: `m-${name}`, name, quantity: null, value, costBasis: null, ...fields,
});
const noQuotes = () => undefined;

describe('topHoldings', () => {
    test('regression: a book of only holdings valued by hand lists them by value, not as no holdings', () => {
        const { lines, total } = topHoldings([], [byHand('Stable Value Fund', 10_000), byHand('Target 2055 Trust', 90_000, { quantity: 1200.5, costBasis: 80_000 })], noQuotes, 6);
        assert.equal(total, 2);
        assert.deepEqual(lines, [
            {
                id: 'm-Target 2055 Trust', symbol: null, name: 'Target 2055 Trust', quantity: 1200.5, marketValue: 90_000,
                todayChangePercent: null, totalReturnPercent: 12.5, allocationPercent: 90, handValued: true,
            },
            {
                id: 'm-Stable Value Fund', symbol: null, name: 'Stable Value Fund', quantity: null, marketValue: 10_000,
                // No cost given: no return to show.
                todayChangePercent: null, totalReturnPercent: null, allocationPercent: 10, handValued: true,
            },
        ]);
    });

    test('ranks both kinds together, each line\'s share of every holding, listed or not', () => {
        const { lines, total } = topHoldings(
            [ticker('AAPL', 10, 100), ticker('MSFT', 1, 50)],
            [byHand('Sample Collective Trust', 2_000), byHand('Sample 529 Portfolio', 900)],
            noQuotes,
            2,
        );
        assert.equal(total, 4);
        assert.deepEqual(lines.map((l) => [l.symbol ?? l.name, l.marketValue, l.allocationPercent]), [
            ['Sample Collective Trust', 2_000, (2_000 / 3_950) * 100],
            ['AAPL', 1_000, (1_000 / 3_950) * 100],
        ]);
    });

    test('a ticker is priced at its quote, with today\'s move only from today\'s quote', () => {
        const quotes: Record<string, { price: number; todayChangePercent: number | null }> = {
            AAPL: { price: 110, todayChangePercent: 1.5 },
            MSFT: { price: 60, todayChangePercent: null },
        };
        const { lines } = topHoldings([ticker('AAPL', 10, 100), ticker('MSFT', 10, 50), ticker('VTI', 1, 200, 0)], [], (s) => quotes[s], 6);
        assert.deepEqual(lines.map((l) => [l.symbol, l.marketValue, l.todayChangePercent, l.totalReturnPercent, l.handValued]), [
            ['AAPL', 1_100, 1.5, 10, false],
            ['MSFT', 600, null, 20, false],
            // No quote: the server's price; no cost: no gain claimed, as before.
            ['VTI', 200, null, 0, false],
        ]);
    });

    test('nothing held is an empty list', () => {
        assert.deepEqual(topHoldings([], [], noQuotes, 6), { lines: [], total: 0 });
    });
});
