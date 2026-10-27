import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { ActivityRow } from './activity';
import { closedTrades, offScale, tickersLeftOut } from './closed-trades';

let seq = 0;
function trade(date: string, side: 'BUY' | 'SELL', symbol: string, quantity: number, price: number, extra: Partial<ActivityRow> = {}): ActivityRow {
    seq += 1;
    return {
        id: `t${seq}`,
        date: `${date}T15:00:00.000Z`,
        symbol,
        side,
        quantity,
        price,
        value: Math.abs(quantity * price),
        account: 'Brokerage',
        notes: null,
        fees: null,
        currency: 'USD',
        ...extra,
    };
}

describe('closedTrades', () => {
    test('a sale is matched against the earliest buys first', () => {
        const [sale] = closedTrades([
            trade('2026-01-05', 'BUY', 'KO', 10, 50),
            trade('2026-02-05', 'BUY', 'KO', 10, 60),
            trade('2026-03-05', 'SELL', 'KO', 15, 70),
        ]);
        assert.deepEqual(
            { quantity: sale.quantity, costBasis: sale.costBasis, proceeds: sale.proceeds, realizedPnl: sale.realizedPnl },
            { quantity: 15, costBasis: 800, proceeds: 1050, realizedPnl: 250 },
        );
        assert.equal(sale.openedAt, '2026-01-05T15:00:00.000Z');
        assert.equal(sale.closedAt, '2026-03-05T15:00:00.000Z');
    });

    test('the rest of a lot carries over to the next sale; newest first', () => {
        const trades = closedTrades([
            trade('2026-03-05', 'SELL', 'KO', 15, 70),
            trade('2026-01-05', 'BUY', 'KO', 10, 50),
            trade('2026-04-05', 'SELL', 'KO', 5, 40),
            trade('2026-02-05', 'BUY', 'KO', 10, 60),
        ]);
        assert.deepEqual(trades.map((t) => [t.closedAt.slice(0, 10), t.realizedPnl]), [
            ['2026-04-05', -100],
            ['2026-03-05', 250],
        ]);
    });

    test('fees add to the cost and come out of the proceeds', () => {
        const [sale] = closedTrades([
            trade('2026-01-05', 'BUY', 'KO', 10, 50, { fees: 10 }),
            trade('2026-02-05', 'SELL', 'KO', 10, 60, { fees: 5 }),
        ]);
        assert.equal(sale.costBasis, 510);
        assert.equal(sale.proceeds, 595);
        assert.equal(sale.realizedPnl, 85);
    });

    test('shares sold with no buy before them are left out', () => {
        const [sale, ...rest] = closedTrades([
            trade('2026-01-05', 'BUY', 'KO', 4, 50),
            trade('2026-02-05', 'SELL', 'KO', 10, 60, { fees: 10 }),
        ]);
        assert.equal(rest.length, 0);
        assert.equal(sale.quantity, 4);
        assert.equal(sale.proceeds, 236); // 4 × 60, less 4/10 of the fees
        assert.equal(closedTrades([trade('2026-02-05', 'SELL', 'PG', 10, 60)]).length, 0);
    });

    test('accounts, tickers and currencies are kept apart; other activity is ignored', () => {
        const trades = closedTrades([
            trade('2026-01-05', 'BUY', 'KO', 10, 50, { account: 'IRA' }),
            trade('2026-01-06', 'SELL', 'KO', 10, 60, { account: 'Brokerage' }),
            trade('2026-01-05', 'BUY', 'SAP', 10, 100, { currency: 'EUR' }),
            trade('2026-01-06', 'SELL', 'SAP', 10, 120, { currency: 'EUR' }),
            { ...trade('2026-01-07', 'BUY', 'KO', 1, 1), side: 'DIVIDEND' },
        ]);
        assert.deepEqual(trades, []);
    });

    test('regression: a buy and a sale either side of a split are left out, not matched on different scales', () => {
        // 10 bought at $100, a 2-for-1 split, 20 sold at $60: neither a $400 loss nor a guessed gain.
        const rows = [trade('2026-01-05', 'BUY', 'KO', 10, 100), trade('2026-03-05', 'SELL', 'KO', 20, 60), trade('2026-01-05', 'BUY', 'PG', 10, 150), trade('2026-03-05', 'SELL', 'PG', 10, 160)];
        const adjusted: Record<string, number> = { 'KO 2026-01-05': 50.5, 'KO 2026-03-05': 59, 'PG 2026-01-05': 151, 'PG 2026-03-05': 158 };
        const adjustedClose = (symbol: string, date: string) => adjusted[`${symbol} ${date}`] ?? null;
        assert.deepEqual(closedTrades(rows, { adjustedClose }).map((t) => [t.symbol, t.realizedPnl]), [['PG', 100]]);
        assert.deepEqual(tickersLeftOut(rows, { adjustedClose }), ['KO']);
    });

    test('regression: a volatile day is never read as a split; without closes nothing is left out', () => {
        // Bought at $100 on a day that closed at $70, sold at $100 the next: no phantom gain.
        const rows = [trade('2026-01-05', 'BUY', 'XYZ', 10, 100), trade('2026-01-06', 'SELL', 'XYZ', 10, 100)];
        const adjustedClose = (_symbol: string, date: string) => (date === '2026-01-05' ? 70 : 100);
        assert.deepEqual(closedTrades(rows, { adjustedClose }), []);
        assert.deepEqual(tickersLeftOut(rows, { adjustedClose }), ['XYZ']);
        assert.equal(closedTrades(rows)[0].realizedPnl, 0);
        assert.deepEqual(tickersLeftOut(rows), []);
    });
});

describe('offScale', () => {
    test('more than a quarter from the close either way; nothing to tell without a close', () => {
        assert.equal(offScale(102, 100), false);
        assert.equal(offScale(124, 100), false);
        assert.equal(offScale(81, 100), false);
        assert.equal(offScale(130, 100), true);
        assert.equal(offScale(50, 100), true);
        assert.equal(offScale(100, null), false);
        assert.equal(offScale(0, 100), false);
    });
});
