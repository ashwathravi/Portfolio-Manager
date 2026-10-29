import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { JournalEntry, Mood } from '@/types/trade';

import { moodBreakdown, totalTaggedTrades } from './mood';

const NOW = Date.parse('2026-10-27T16:00:00.000Z');

function trade(id: string, pnl: number, mood?: Mood): JournalEntry {
    return {
        id,
        ticker: 'AAPL',
        side: 'buy',
        quantity: 1,
        entryPrice: 100,
        exitPrice: 100 + pnl,
        notionalUsd: 100,
        realizedPnlUsd: pnl,
        holdingPeriodDays: 3,
        openedAt: '2026-10-20T12:00:00.000Z',
        closedAt: '2026-10-23T12:00:00.000Z',
        dateOnly: true,
        ...(mood ? {
            rationale: {
                thesisId: '',
                setupType: 'other',
                conviction: 5,
                mood,
                rationale: 'Why',
                capturedAt: '2026-10-20T10:00:00.000Z',
                timeToDecisionMs: 10_000,
            },
        } : {}),
    };
}

describe('moodBreakdown', () => {
    test('counts only trades with a mood recorded on Trade (launch item i51)', () => {
        const stats = moodBreakdown([trade('a', 50, 'calm'), trade('b', -20, 'fomo'), trade('c', -500), trade('d', 10, 'calm')], null, NOW);
        assert.equal(totalTaggedTrades(stats), 3);
        const calm = stats.find((s) => s.mood === 'calm')!;
        assert.deepEqual([calm.tradeCount, calm.totalPnlUsd, calm.winRate], [2, 60, 1]);
        assert.equal(stats.find((s) => s.mood === 'fomo')!.totalPnlUsd, -20);
    });

    test('a journal with no moods has six empty rows', () => {
        const stats = moodBreakdown([trade('a', 50), trade('b', -20)], null, NOW);
        assert.equal(stats.length, 6);
        assert.equal(totalTaggedTrades(stats), 0);
    });
});
