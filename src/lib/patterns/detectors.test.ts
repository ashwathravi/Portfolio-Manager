import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { JournalEntry } from '@/types/trade';

import { runAllDetectors } from './detectors';

const CTX = { now: '2026-10-27T16:00:00.000Z', nav: 10_000, sectorByTicker: {}, sectorTargets: {} };

/** A losing closed trade from imported history: dates only, nothing recorded about it. */
function imported(i: number): JournalEntry {
    const day = String(1 + i).padStart(2, '0');
    return {
        id: `t-${i}`,
        ticker: 'AAPL',
        side: 'buy',
        quantity: 1,
        entryPrice: 100,
        exitPrice: 90,
        notionalUsd: 100,
        realizedPnlUsd: -10,
        holdingPeriodDays: 1,
        openedAt: `2026-10-${day}T12:00:00.000Z`,
        closedAt: `2026-10-${day}T12:00:00.000Z`,
        dateOnly: true,
    };
}

describe('runAllDetectors', () => {
    test('trades with nothing recorded raise no hour, setup or mood patterns (launch item i51)', () => {
        const patterns = runAllDetectors(Array.from({ length: 12 }, (_, i) => imported(i)), CTX);
        for (const detector of ['late_day_losses', 'high_win_setup', 'negative_mood_cost', 'sector_drift']) {
            assert.equal(patterns.filter((p) => p.detector === detector).length, 0, detector);
        }
    });

    test('an empty journal raises nothing', () => {
        assert.deepEqual(runAllDetectors([], CTX), []);
    });
});
