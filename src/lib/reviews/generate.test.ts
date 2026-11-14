import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { generateReview } from './generate';
import type { WeekBounds } from './types';
import type { JournalEntry } from '@/types/trade';

// The week of Mon 2026-05-04 in New York (EDT): src/lib/reviews/weeks.ts.
const BOUNDS: WeekBounds = {
    id: 'wk:2026-05-04',
    weekStart: '2026-05-04T04:00:00.000Z',
    weekEnd: '2026-05-11T04:00:00.000Z',
    closesAt: '2026-05-08T20:00:00.000Z',
    firstDay: '2026-05-04',
    lastDay: '2026-05-10',
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

    test('counts a trade with only a date on that date, Monday to Sunday (launch item i51)', () => {
        const week: WeekBounds = {
            id: 'wk:2026-10-19',
            weekStart: '2026-10-19T04:00:00.000Z',
            weekEnd: '2026-10-26T04:00:00.000Z',
            closesAt: '2026-10-23T20:00:00.000Z',
            firstDay: '2026-10-19',
            lastDay: '2026-10-25',
        };
        const dated = (id: string, opened: string, closed: string, pnl: number) => entry({
            id,
            rationale: undefined,
            dateOnly: true,
            openedAt: `${opened}T12:00:00.000Z`,
            closedAt: `${closed}T12:00:00.000Z`,
            realizedPnlUsd: pnl,
        });
        const friday = dated('fri', '2026-10-22', '2026-10-23', -100);
        // Entered by hand with a weekend date: still that week's, not lost between two.
        const saturday = dated('sat', '2026-10-22', '2026-10-24', 15);
        const sundayBefore = dated('sun', '2026-10-16', '2026-10-18', 40);
        const nextMonday = dated('mon', '2026-10-23', '2026-10-26', 25);
        const review = generateReview([friday, saturday, sundayBefore, nextMonday], week);
        assert.equal(review.stats.tradeCount.total, 2);
        assert.equal(review.stats.realizedPnlUsd, -85);

        // Sold and bought back the same Friday: churn sees the trades the week counted.
        const churn = generateReview([friday, dated('fri-2', '2026-10-23', '2026-10-23', -20)], week);
        assert.equal(churn.stats.tradeCount.total, 2);
        assert.deepEqual(churn.stats.churnSymbols, ['NVDA']);

        // A trade with a time of day counts by that time: the next Monday 00:00 ET is the next week's.
        const timed = (closedAt: string) => ({ ...friday, dateOnly: undefined, closedAt });
        assert.equal(generateReview([timed('2026-10-26T03:59:59.000Z')], week).stats.tradeCount.total, 1);
        assert.equal(generateReview([timed('2026-10-26T04:00:00.000Z')], week).stats.tradeCount.total, 0);
        assert.equal(generateReview([timed('2026-10-19T03:59:59.000Z')], week).stats.tradeCount.total, 0);
    });

    test('churn reaches every trade of a week an hour longer than seven days', () => {
        // Clocks fall back Sun 2026-11-01: Mon Oct 26 00:00 EDT to Mon Nov 2 00:00 EST is 169 hours.
        const week: WeekBounds = {
            id: 'wk:2026-10-26',
            weekStart: '2026-10-26T04:00:00.000Z',
            weekEnd: '2026-11-02T05:00:00.000Z',
            closesAt: '2026-10-30T20:00:00.000Z',
            firstDay: '2026-10-26',
            lastDay: '2026-11-01',
        };
        const first = entry({ id: 'j-first', closedAt: '2026-10-26T04:30:00.000Z', holdingPeriodDays: 1 });
        const last = entry({ id: 'j-last', side: 'sell', closedAt: '2026-11-02T04:30:00.000Z', holdingPeriodDays: 1 });
        const review = generateReview([first, last], week);
        assert.equal(review.stats.tradeCount.total, 2);
        assert.deepEqual(review.stats.churnSymbols, ['NVDA']);
    });

    test('a week with no closed trades still scores 100 and says so', () => {
        const review = generateReview([], BOUNDS);
        assert.equal(review.stats.ruleAdherence, 100);
        assert.match(review.narrative, /no trades closed/);
    });
});
