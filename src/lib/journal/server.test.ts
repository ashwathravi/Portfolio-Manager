import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { ActivityRow } from '@/lib/portfolio/activity';
import type { Order } from '@/types/execution';

import { loadClosedTrades, loadTradeJournal, loadTradeJournalForPage, type TradeJournalLoaders } from './server';

const NOW = new Date('2026-10-27T16:00:00.000Z');

function row(patch: Partial<ActivityRow> & Pick<ActivityRow, 'id' | 'date' | 'side'>): ActivityRow {
    return {
        symbol: 'AAPL',
        quantity: 10,
        price: 150,
        value: 1500,
        account: 'Main',
        notes: null,
        fees: null,
        currency: 'USD',
        ...patch,
    };
}

// AAPL bought at 150 and sold at 170 in Main; NVDA bought at 1,000 and sold
// at 120 (a 10-for-1 split between, which no stored split records); MSFT
// bought and still held.
const ACTIVITY: ActivityRow[] = [
    row({ id: 'b-aapl', date: '2026-10-01T12:00:00.000Z', side: 'BUY' }),
    row({ id: 's-aapl', date: '2026-10-15T12:00:00.000Z', side: 'SELL', quantity: -10, price: 170, value: 1700 }),
    row({ id: 'b-nvda', date: '2026-09-02T12:00:00.000Z', side: 'BUY', symbol: 'NVDA', quantity: 1, price: 1000, value: 1000 }),
    row({ id: 's-nvda', date: '2026-10-20T12:00:00.000Z', side: 'SELL', symbol: 'NVDA', quantity: -10, price: 120, value: 1200 }),
    row({ id: 'b-msft', date: '2026-10-02T12:00:00.000Z', side: 'BUY', symbol: 'MSFT', quantity: 2, price: 400, value: 800 }),
];

const CLOSES = new Map([
    ['AAPL', [{ date: '2026-10-01', close: 150 }, { date: '2026-10-15', close: 170 }]],
    ['NVDA', [{ date: '2026-09-02', close: 100 }, { date: '2026-10-20', close: 120 }]],
]);

const PLACED: Order = {
    id: 'plan-1',
    portfolioId: 'acct-main',
    instrumentType: 'equity',
    ticker: 'AAPL',
    side: 'buy',
    type: 'market',
    quantity: 10,
    timeInForce: 'day',
    status: 'placed',
    createdAt: '2026-10-01T13:00:00.000Z',
    updatedAt: '2026-10-01T15:00:00.000Z',
    rationale: {
        thesisId: 'thesis-aapl',
        setupType: 'breakout',
        conviction: 6,
        mood: 'focused',
        rationale: 'Breakout on volume.',
        capturedAt: '2026-10-01T13:00:00.000Z',
        timeToDecisionMs: 30_000,
    },
};

function loaders(patch: Partial<TradeJournalLoaders> = {}) {
    const calls: string[] = [];
    const fake: TradeJournalLoaders = {
        loadAccounts: async (userId) => {
            calls.push(`accounts:${userId}`);
            return [
                {
                    id: 'acct-main',
                    name: 'Main',
                    cashBalance: 1000,
                    holdings: [
                        // Valued at its stored price, and at cost before it has one.
                        { id: 'h-msft', symbol: 'MSFT', quantity: '2', avgCost: '400', currentPrice: 410, marketValue: null },
                        { id: 'h-new', symbol: 'NEW', quantity: '5', avgCost: '20', currentPrice: null, marketValue: null },
                    ],
                },
            ];
        },
        loadActivity: async (userId) => {
            calls.push(`activity:${userId}`);
            return ACTIVITY;
        },
        loadOrders: async (userId) => {
            calls.push(`orders:${userId}`);
            return [PLACED];
        },
        loadDecisions: async (userId) => {
            calls.push(`decisions:${userId}`);
            return [];
        },
        loadCloses: async (symbols, from, to) => {
            calls.push(`closes:${symbols.join(',')}:${from}:${to}`);
            return new Map([...CLOSES].filter(([symbol]) => symbols.includes(symbol)));
        },
        ...patch,
    };
    return { calls, fake };
}

describe('loadClosedTrades', () => {
    test('reads closes for the tickers sold from the first buy of one, and leaves out a ticker off its split-adjusted scale', async () => {
        const { calls, fake } = loaders();
        const { trades, leftOut } = await loadClosedTrades(ACTIVITY, fake.loadCloses, NOW);
        assert.deepEqual(calls, ['closes:AAPL,NVDA:2026-09-02:2026-10-27']);
        assert.deepEqual(trades.map((t) => [t.symbol, t.realizedPnl]), [['AAPL', 200]]);
        assert.deepEqual(leftOut, ['NVDA']);
    });

    test('reads nothing when nothing was sold', async () => {
        const { calls, fake } = loaders();
        assert.deepEqual(await loadClosedTrades(ACTIVITY.filter((r) => r.side === 'BUY'), fake.loadCloses, NOW), { trades: [], leftOut: [] });
        assert.deepEqual(calls, []);
    });
});

describe('loadTradeJournal', () => {
    test('the user\'s closed trades with the rationale from Trade, what was left out, and net worth at stored prices', async () => {
        const { calls, fake } = loaders();
        const journal = await loadTradeJournal('user-a', { now: NOW, sources: fake });
        assert.deepEqual(journal.entries.map((e) => [e.ticker, e.account, e.realizedPnlUsd, e.rationale?.mood, e.dateOnly]), [
            ['AAPL', 'Main', 200, 'focused', true],
        ]);
        assert.deepEqual(journal.leftOut, ['NVDA']);
        // 1,000 cash + 2 × 410 + 5 × 20 at cost.
        assert.equal(journal.netWorth, 1920);
        assert.deepEqual(calls.filter((c) => !c.startsWith('closes:')).sort(), ['accounts:user-a', 'activity:user-a', 'decisions:user-a', 'orders:user-a']);
    });

    test('uses the accounts and activity the page already loaded', async () => {
        const { calls, fake } = loaders();
        const journal = await loadTradeJournal('user-a', {
            now: NOW,
            sources: fake,
            accounts: [{ id: 'acct-main', name: 'Main', cashBalance: null, holdings: [] }],
            activity: ACTIVITY.slice(0, 2),
        });
        assert.equal(journal.entries.length, 1);
        assert.equal(journal.netWorth, 0);
        assert.ok(!calls.includes('accounts:user-a') && !calls.includes('activity:user-a'));
    });

    test('a user without sales has an empty journal', async () => {
        const { fake } = loaders({ loadActivity: async () => [] });
        assert.deepEqual((await loadTradeJournal('user-a', { now: NOW, sources: fake })).entries, []);
    });
});

describe('loadTradeJournalForPage', () => {
    test('reads nothing without a database', async () => {
        const { calls, fake } = loaders();
        assert.deepEqual(await loadTradeJournalForPage('user-a', { databaseConfigured: false, sources: fake }), { journal: null, unavailable: false });
        assert.deepEqual(calls, []);
    });

    test('a failed read is an outage, not an empty journal', async () => {
        const { fake } = loaders({ loadOrders: async () => { throw new Error('connect ECONNREFUSED'); } });
        const errors: unknown[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => { errors.push(args); };
        try {
            assert.deepEqual(await loadTradeJournalForPage('user-a', { databaseConfigured: true, now: NOW, sources: fake }), { journal: null, unavailable: true });
        } finally {
            console.error = original;
        }
        assert.equal(errors.length, 1);
    });
});
