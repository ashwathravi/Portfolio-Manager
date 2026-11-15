import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import type { JournalEntry } from '@/types/trade';
import { generateReview } from './generate';
import { currentWeekBounds, formatWeekRange, listRecentWeeks, pastWeekBounds } from './weeks';

/** Runs `fn` with the process (the "browser") in another time zone. */
function inZone<T>(zone: string, fn: () => T): T {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    try {
        return fn();
    } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
    }
}

const ZONES = ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo', 'Pacific/Auckland'];

function timedSale(closedAt: string): JournalEntry {
    return {
        id: `sale-${closedAt}`,
        ticker: 'NVDA',
        side: 'buy',
        quantity: 10,
        entryPrice: 100,
        exitPrice: 90,
        notionalUsd: 1_000,
        realizedPnlUsd: -100,
        holdingPeriodDays: 1,
        openedAt: closedAt,
        closedAt,
    };
}

// Instants are UTC, so these hold wherever the tests run.
describe('review weeks', () => {
    test('after the Friday close the week just ended is the one to review, a New York calendar week', () => {
        // Sat 2026-10-24 10:00 AM EDT.
        const week = currentWeekBounds(new Date('2026-10-24T14:00:00Z'));
        assert.deepEqual(week, {
            id: 'wk:2026-10-19',
            weekStart: '2026-10-19T04:00:00.000Z', // Monday 00:00 EDT
            weekEnd: '2026-10-26T04:00:00.000Z', // the next Monday 00:00 EDT
            closesAt: '2026-10-23T20:00:00.000Z', // Friday 4:00 PM EDT
            firstDay: '2026-10-19',
            lastDay: '2026-10-25',
        });
    });

    test('before the Friday close it is the week before', () => {
        // Fri 2026-10-23 3:59 PM EDT.
        assert.equal(currentWeekBounds(new Date('2026-10-23T19:59:00Z')).id, 'wk:2026-10-12');
        assert.equal(currentWeekBounds(new Date('2026-10-23T20:00:00Z')).id, 'wk:2026-10-19');
    });

    test('earlier weeks keep their own days', () => {
        const now = new Date('2026-10-24T14:00:00Z');
        const two = pastWeekBounds(2, now);
        assert.deepEqual(
            { id: two.id, firstDay: two.firstDay, lastDay: two.lastDay },
            { id: 'wk:2026-10-05', firstDay: '2026-10-05', lastDay: '2026-10-11' },
        );
        assert.deepEqual(listRecentWeeks(3, now).map((w) => w.id), ['wk:2026-10-19', 'wk:2026-10-12', 'wk:2026-10-05']);
    });

    test('regression (x23): the week is New York\'s, not the browser\'s time zone', () => {
        // Fri 2026-11-13 3:30 PM EST: the session is still open, so the review
        // ready is the week before. London's clock (20:30) is past 4 PM.
        const midSession = new Date('2026-11-13T20:30:00Z');
        // Sat 2026-11-14 10:00 AM EST.
        const weekend = new Date('2026-11-14T15:00:00Z');
        for (const zone of ZONES) {
            inZone(zone, () => {
                assert.equal(currentWeekBounds(midSession).id, 'wk:2026-11-02', zone);
                assert.deepEqual(currentWeekBounds(weekend), {
                    id: 'wk:2026-11-09',
                    weekStart: '2026-11-09T05:00:00.000Z',
                    weekEnd: '2026-11-16T05:00:00.000Z',
                    closesAt: '2026-11-13T21:00:00.000Z',
                    firstDay: '2026-11-09',
                    lastDay: '2026-11-15',
                }, zone);
                assert.equal(formatWeekRange(currentWeekBounds(weekend)), 'Nov 9–13', zone);
            });
        }
    });

    test('regression (x23): a trade timed during Friday\'s session counts in its week in every time zone', () => {
        // East of New York, Friday 4 PM local came before this sale, and the
        // next week started at Monday 00:00 local: it was in neither review.
        const sale = timedSale('2026-11-13T20:30:00.000Z');
        for (const zone of ZONES) {
            inZone(zone, () => {
                const weeks = listRecentWeeks(2, new Date('2026-11-21T15:00:00Z'));
                const counted = weeks.map((week) => generateReview([sale], week).stats.tradeCount.total);
                assert.deepEqual(weeks.map((week) => week.id), ['wk:2026-11-16', 'wk:2026-11-09'], zone);
                assert.deepEqual(counted, [0, 1], zone);
            });
        }
    });

    test('weeks meet: every moment, a Friday evening or a weekend included, is in exactly one', () => {
        const weeks = listRecentWeeks(12, new Date('2026-11-14T15:00:00Z'));
        for (let i = 1; i < weeks.length; i++) {
            assert.equal(weeks[i].weekEnd, weeks[i - 1].weekStart, weeks[i].id);
        }
        // Friday 6:00 PM EST and Sunday night: in the week just ended, and only it.
        const afterHours = timedSale('2026-11-13T23:00:00.000Z');
        const sundayNight = timedSale('2026-11-16T04:59:00.000Z');
        const nextMonday = timedSale('2026-11-16T05:00:00.000Z');
        const counts = (entry: JournalEntry) => weeks.map((week) => generateReview([entry], week).stats.tradeCount.total);
        assert.deepEqual(counts(afterHours).slice(0, 2), [1, 0]);
        assert.deepEqual(counts(sundayNight).slice(0, 2), [1, 0]);
        assert.deepEqual(counts(nextMonday).reduce((a, b) => a + b, 0), 0);
    });

    test('regression (x23): a week whose Friday is a holiday is ready at Thursday\'s close', () => {
        const cases: Array<[week: string, closesAt: string]> = [
            ['wk:2026-03-30', '2026-04-02T20:00:00.000Z'], // Good Friday 2026-04-03
            ['wk:2026-06-15', '2026-06-18T20:00:00.000Z'], // Juneteenth 2026-06-19
            ['wk:2026-06-29', '2026-07-02T20:00:00.000Z'], // Independence Day observed 2026-07-03
            ['wk:2026-12-21', '2026-12-24T18:00:00.000Z'], // Christmas 2026-12-25; Dec 24 closes at 1 PM
            ['wk:2026-12-28', '2026-12-31T21:00:00.000Z'], // New Year's Day 2027-01-01
            ['wk:2027-03-22', '2027-03-25T20:00:00.000Z'], // Good Friday 2027-03-26
            ['wk:2027-06-14', '2027-06-17T20:00:00.000Z'], // Juneteenth observed 2027-06-18
            ['wk:2027-12-20', '2027-12-23T21:00:00.000Z'], // Christmas observed 2027-12-24
        ];
        for (const [id, closesAt] of cases) {
            const close = Date.parse(closesAt);
            const ready = currentWeekBounds(new Date(close));
            assert.equal(ready.id, id, closesAt);
            assert.equal(ready.closesAt, closesAt, id);
            // A minute before the close it is still the week before.
            assert.notEqual(currentWeekBounds(new Date(close - 60_000)).id, id, closesAt);
        }
        // Thu 2026-04-02 6:00 PM EDT: the Good Friday week's review is ready.
        assert.equal(currentWeekBounds(new Date('2026-04-02T22:00:00Z')).id, 'wk:2026-03-30');
    });

    test('regression (x23): the day after Thanksgiving the review is ready at the 1:00 PM close', () => {
        // Fri 2026-11-27 1:30 PM EST; the market closed at 1:00.
        assert.equal(currentWeekBounds(new Date('2026-11-27T18:30:00Z')).id, 'wk:2026-11-23');
        assert.equal(currentWeekBounds(new Date('2026-11-27T17:59:00Z')).id, 'wk:2026-11-16');
        assert.equal(currentWeekBounds(new Date('2027-11-26T18:00:00Z')).closesAt, '2027-11-26T18:00:00.000Z');
    });

    test('a week across a daylight-saving change starts and ends at midnight in New York', () => {
        // Clocks fall back Sun 2026-11-01 and spring forward Sun 2026-03-08.
        const fallBack = pastWeekBounds(0, new Date('2026-10-31T12:00:00Z'));
        assert.equal(fallBack.weekStart, '2026-10-26T04:00:00.000Z');
        assert.equal(fallBack.weekEnd, '2026-11-02T05:00:00.000Z');
        const springForward = pastWeekBounds(0, new Date('2026-03-07T12:00:00Z'));
        assert.equal(springForward.weekStart, '2026-03-02T05:00:00.000Z');
        assert.equal(springForward.weekEnd, '2026-03-09T04:00:00.000Z');
    });

    test('a week is named by its Monday to Friday, in any time zone', () => {
        for (const zone of ZONES) {
            inZone(zone, () => {
                const now = new Date('2026-04-04T15:00:00Z');
                assert.equal(formatWeekRange(currentWeekBounds(now)), 'Mar 30 – Apr 3', zone);
                assert.equal(formatWeekRange(pastWeekBounds(1, now)), 'Mar 23–27', zone);
            });
        }
    });
});
