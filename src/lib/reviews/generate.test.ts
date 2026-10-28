import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { generateReview } from './generate';
import type { WeekBounds } from './types';
import type { JournalEntry } from '@/types/trade';

const BOUNDS: WeekBounds = {
    id: 'wk:2026-05-04',
    weekStart: '2026-05-04T07:00:00.000Z',
    weekEnd: '2026-05-08T23:00:00.000Z',
};

function entry(patch: Partial<JournalEntry> = {}): JournalEntry {
    return {
        id: 'j-policy-1',
        ticker: 'NVDA',
        side: 'buy',
        quantity: 10,
        entryPrice: 500,
        exitPrice: 540,
        notionalUsd: 5_000,
        realizedPnlUsd: 400,
        holdingPeriodDays: 2,
        openedAt: '2026-05-05T16:00:00.000Z',
        closedAt: '2026-05-06T16:00:00.000Z',
        rationale: {
            thesisId: 'seed-nvda',
            setupType: 'conviction_add',
            conviction: 8,
            mood: 'calm',
            rationale: 'Adding after thesis-confirming demand signal.',
            capturedAt: '2026-05-05T15:55:00.000Z',
            timeToDecisionMs: 45_000,
        },
        ...patch,
    };
}

describe('generateReview', () => {
    test('counts captured policy exceptions in weekly review stats and narrative', () => {
        const review = generateReview([
            entry({
                policyExceptions: [
                    {
                        ruleType: 'bucket_allocation',
                        symbol: 'NVDA',
                        reason: 'Intentional exception for test coverage.',
                        currentPct: 24,
                        postPct: 25.1,
                        thresholdPct: 20,
                        message: 'Active idea exposure worsens beyond policy.',
                        capturedAt: '2026-05-05T15:59:00.000Z',
                    },
                    {
                        ruleType: 'theme_factor_allocation',
                        symbol: 'NVDA',
                        reason: 'Intentional exception for test coverage.',
                        currentPct: 34,
                        postPct: 35.2,
                        thresholdPct: 35,
                        message: 'AI infrastructure exposure worsens beyond policy.',
                        capturedAt: '2026-05-05T15:59:00.000Z',
                    },
                ],
            }),
        ], BOUNDS);

        assert.equal(review.stats.ruleAdherence, 100);
        assert.equal(review.stats.policyExceptions, 2);
        assert.equal(review.stats.sellDisciplineEvents, 0);
        assert.equal(review.stats.churnWarnings, 0);
        assert.equal(review.stats.exceptions, 2);
        assert.match(review.narrative, /2 exceptions \(2 policy exceptions\)/);
    });

    test('counts sell-discipline audit actions in weekly review stats and narrative', () => {
        const review = generateReview([
            entry({
                sellDisciplineEvents: [
                    {
                        id: 'sell-aapl-snoozed',
                        type: 'snoozed',
                        reason: 'Reviewed after earnings.',
                        createdAt: '2026-05-05T18:00:00.000Z',
                    },
                    {
                        id: 'sell-aapl-resolved',
                        type: 'resolved',
                        reason: 'Trim completed.',
                        createdAt: '2026-05-06T18:00:00.000Z',
                    },
                ],
            }),
        ], BOUNDS);

        assert.equal(review.stats.sellDisciplineEvents, 2);
        assert.match(review.narrative, /2 sell-discipline actions/);
    });

    test('includes churn warnings in weekly review stats and narrative', () => {
        const review = generateReview([
            entry({
                id: 'j-churn-1',
                ticker: 'NVDA',
                side: 'buy',
                notionalUsd: 10_000,
                closedAt: '2026-05-05T16:00:00.000Z',
                holdingPeriodDays: 3,
                rationale: {
                    thesisId: '',
                    setupType: 'conviction_add',
                    conviction: 4,
                    mood: 'fomo',
                    rationale: 'Chasing the move.',
                    capturedAt: '2026-05-05T15:55:00.000Z',
                    timeToDecisionMs: 8_000,
                },
            }),
            entry({
                id: 'j-churn-2',
                ticker: 'NVDA',
                side: 'sell',
                notionalUsd: 9_000,
                closedAt: '2026-05-06T16:00:00.000Z',
                holdingPeriodDays: 1,
            }),
        ], BOUNDS);

        assert.equal(review.stats.churnWarnings, 1);
        assert.deepEqual(review.stats.churnSymbols, ['NVDA']);
        assert.match(review.narrative, /1 churn warning \(NVDA\)/);
    });

    test('measures P&L against the net worth given, and leaves the share out without one', () => {
        const withNav = generateReview([entry()], BOUNDS, { nav: 40_000 });
        assert.equal(withNav.stats.navPctChange, 1);
        assert.match(withNav.narrative, /Realised P&L of \+\$400 \(\+1\.0% of net worth\)\./);

        const without = generateReview([entry()], BOUNDS);
        assert.equal(without.stats.navPctChange, null);
        assert.match(without.narrative, /Realised P&L of \+\$400\./);
        assert.doesNotMatch(without.narrative, /net worth|NAV/);
        assert.equal(generateReview([entry()], BOUNDS, { nav: 0 }).stats.navPctChange, null);
    });

    test('scores only trades with a rationale recorded on Trade (launch item i51)', () => {
        const unrecorded = entry({ id: 'j-imported', rationale: undefined, realizedPnlUsd: -50 });
        const review = generateReview([unrecorded], BOUNDS);
        assert.equal(review.stats.ruleAdherence, null);
        assert.equal(review.stats.exceptions, 0);
        assert.equal(review.stats.tradeCount.total, 1);
        assert.match(review.narrative, /^This week you closed 1 trade\./);
        assert.doesNotMatch(review.narrative, /adherence/);

        // Mixed: the unrecorded trade neither raises nor lowers the score.
        const mixed = generateReview([unrecorded, entry({ rationale: { ...entry().rationale!, conviction: 3 } })], BOUNDS);
        assert.equal(mixed.stats.ruleAdherence, 67);
        assert.equal(mixed.stats.exceptions, 1);
    });

    test('breaks closed trades down only when they were of more than one kind', () => {
        assert.match(generateReview([entry(), entry({ id: 'j-2' })], BOUNDS).narrative, /^This week you closed 2 trades\./);
        assert.match(
            generateReview([entry(), entry({ id: 'j-short', side: 'sell' })], BOUNDS).narrative,
            /^This week you closed 2 trades \(1 long, 1 short\)\./,
        );
    });

    test('a week with no closed trades still scores 100 and says so', () => {
        const review = generateReview([], BOUNDS);
        assert.equal(review.stats.ruleAdherence, 100);
        assert.match(review.narrative, /no trades closed/);
    });
});
