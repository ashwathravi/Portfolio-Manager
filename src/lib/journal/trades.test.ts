import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { ClosedTrade } from '@/lib/portfolio/closed-trades';
import type { Order } from '@/types/execution';
import type { TradeRationale } from '@/types/trade';

import { NOTE_LOOKBACK_DAYS, tradeJournal, tradeReason, type TradeJournalSources } from './trades';

const ACCOUNTS = [
    { id: 'acct-main', name: 'Main' },
    { id: 'acct-ira', name: 'IRA' },
];

// 10 AAPL bought on Oct 1 for $1,505 with fees, sold Oct 15 for $1,695.
const CLOSED: ClosedTrade = {
    id: 'tx-sell-1',
    symbol: 'AAPL',
    account: 'Main',
    openedAt: '2026-10-01T12:00:00.000Z',
    closedAt: '2026-10-15T12:00:00.000Z',
    quantity: 10,
    costBasis: 1505,
    proceeds: 1695,
    realizedPnl: 190,
};

const RATIONALE: TradeRationale = {
    thesisId: 'thesis-aapl',
    setupType: 'conviction_add',
    conviction: 7,
    mood: 'calm',
    rationale: 'Services growth keeps compounding.',
    capturedAt: '2026-09-30T14:00:00.000Z',
    timeToDecisionMs: 40_000,
};

function order(patch: Partial<Order> = {}): Order {
    return {
        id: 'plan-1',
        portfolioId: 'acct-main',
        instrumentType: 'equity',
        ticker: 'AAPL',
        side: 'buy',
        type: 'market',
        quantity: 10,
        timeInForce: 'day',
        status: 'placed',
        createdAt: '2026-09-30T14:00:00.000Z',
        updatedAt: '2026-10-01T15:00:00.000Z',
        rationale: RATIONALE,
        ...patch,
    };
}

function sources(patch: Partial<TradeJournalSources> = {}): TradeJournalSources {
    return { accounts: ACCOUNTS, orders: [], decisions: [], ...patch };
}

describe('tradeJournal', () => {
    test('maps a closed trade: prices per share with fees, holding period, account, dates only', () => {
        const [entry] = tradeJournal([CLOSED], sources());
        assert.deepEqual(entry, {
            id: 'tx-sell-1',
            ticker: 'AAPL',
            account: 'Main',
            side: 'buy',
            quantity: 10,
            entryPrice: 150.5,
            exitPrice: 169.5,
            notionalUsd: 1505,
            realizedPnlUsd: 190,
            holdingPeriodDays: 14,
            openedAt: '2026-10-01T12:00:00.000Z',
            closedAt: '2026-10-15T12:00:00.000Z',
            dateOnly: true,
        });
        assert.equal(tradeReason(entry), null);
    });

    test('a placed buy drafted on Trade in the week before carries its rationale and policy exceptions', () => {
        const exception = {
            ruleType: 'bucket_allocation' as const,
            symbol: 'AAPL',
            reason: 'Sized up on purpose.',
            currentPct: 20,
            postPct: 22,
            thresholdPct: 20,
            message: 'Active ideas over the limit.',
            capturedAt: '2026-09-30T14:00:00.000Z',
        };
        const [entry] = tradeJournal([CLOSED], sources({
            orders: [order({ policy: { decision: 'override_required', summary: 'Over the limit', exceptions: [exception] } })],
        }));
        assert.equal(entry.orderId, 'plan-1');
        assert.deepEqual(entry.rationale, RATIONALE);
        assert.deepEqual(entry.policyExceptions, [exception]);
        assert.equal(tradeReason(entry), 'Services growth keeps compounding.');
    });

    test('the latest matching order wins; the day it was drafted counts in Eastern time', () => {
        const later = order({ id: 'plan-2', createdAt: '2026-10-01T23:30:00.000Z', rationale: { ...RATIONALE, mood: 'fomo' } });
        // 7:30 pm Eastern on Oct 1: still the day of the buy.
        const [entry] = tradeJournal([CLOSED], sources({ orders: [order(), later] }));
        assert.equal(entry.orderId, 'plan-2');
        assert.equal(entry.rationale?.mood, 'fomo');
    });

    test('orders that did not open the trade are not matched', () => {
        const notIt = [
            order({ id: 'other-account', portfolioId: 'acct-ira' }),
            order({ id: 'unknown-account', portfolioId: 'acct-gone' }),
            order({ id: 'other-ticker', ticker: 'MSFT' }),
            order({ id: 'sell', side: 'sell' }),
            order({ id: 'ready', status: 'ready' }),
            order({ id: 'cancelled', status: 'cancelled' }),
            order({ id: 'option', instrumentType: 'option' }),
            // The day after the buy (Eastern), and further back than the lookback.
            order({ id: 'after', createdAt: '2026-10-02T14:00:00.000Z' }),
            order({ id: 'too-early', createdAt: `2026-09-${String(30 - NOTE_LOOKBACK_DAYS).padStart(2, '0')}T14:00:00.000Z` }),
        ];
        const [entry] = tradeJournal([CLOSED], sources({ orders: notIt }));
        assert.equal(entry.orderId, undefined);
        assert.equal(entry.rationale, undefined);
        assert.equal(entry.policyExceptions, undefined);
    });

    test('an order without a rationale links the order but records no reason', () => {
        const [entry] = tradeJournal([CLOSED], sources({ orders: [order({ rationale: undefined })] }));
        assert.equal(entry.orderId, 'plan-1');
        assert.equal(entry.rationale, undefined);
    });

    test('an entry decision from Research › Journal in the week before is the reason when Trade has none', () => {
        const decision = { id: 'j-1', date: '2026-09-28', type: 'entry' as const, ticker: 'aapl', decision: 'Start a position', rationale: 'Buyback pace.', thesisId: null };
        const [entry] = tradeJournal([CLOSED], sources({ decisions: [decision] }));
        assert.deepEqual(entry.decision, { id: 'j-1', date: '2026-09-28', decision: 'Start a position', rationale: 'Buyback pace.' });
        assert.equal(tradeReason(entry), 'Start a position — Buyback pace.');

        // Trade's rationale comes first; the decision stays attached.
        const [both] = tradeJournal([CLOSED], sources({ orders: [order()], decisions: [{ ...decision, thesisId: 'thesis-aapl' }] }));
        assert.equal(tradeReason(both), 'Services growth keeps compounding.');
        assert.equal(both.decision?.thesisId, 'thesis-aapl');
    });

    test('exit and hold decisions, examples, other tickers and dates outside the week are not matched', () => {
        const base = { date: '2026-09-30', type: 'entry' as const, ticker: 'AAPL', decision: 'Buy', rationale: 'Why', thesisId: null };
        const [entry] = tradeJournal([CLOSED], sources({
            decisions: [
                { ...base, id: 'exit', type: 'exit' },
                { ...base, id: 'hold', type: 'hold' },
                { ...base, id: 'seed-journal-1' },
                { ...base, id: 'msft', ticker: 'MSFT' },
                { ...base, id: 'after', date: '2026-10-02' },
                { ...base, id: 'too-early', date: '2026-09-23' },
            ],
        }));
        assert.equal(entry.decision, undefined);
    });

    test('keeps the order of the closed trades it is given', () => {
        const older = { ...CLOSED, id: 'tx-sell-0', closedAt: '2026-10-10T12:00:00.000Z' };
        assert.deepEqual(tradeJournal([CLOSED, older], sources()).map((e) => e.id), ['tx-sell-1', 'tx-sell-0']);
        assert.deepEqual(tradeJournal([], sources()), []);
    });
});
