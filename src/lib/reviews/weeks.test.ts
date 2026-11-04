import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { currentWeekBounds, easternWeekBounds, listRecentWeeks, pastWeekBounds } from './weeks';

// Dates are built from local parts, so these hold in any timezone.
describe('review weeks', () => {
    test('after the Friday close the week just ended is the one to review, Monday to Friday', () => {
        const week = currentWeekBounds(new Date(2026, 9, 24, 10));
        assert.equal(week.id, 'wk:2026-10-19');
        assert.equal(week.firstDay, '2026-10-19');
        assert.equal(week.lastDay, '2026-10-23');
        assert.equal(Date.parse(week.weekStart), new Date(2026, 9, 19).getTime());
        assert.equal(Date.parse(week.weekEnd), new Date(2026, 9, 23, 16).getTime());
    });

    test('before the Friday close it is the week before', () => {
        const week = currentWeekBounds(new Date(2026, 9, 23, 15, 59));
        assert.equal(week.id, 'wk:2026-10-12');
        assert.equal(week.lastDay, '2026-10-16');
    });

    test('earlier weeks keep their own days', () => {
        const now = new Date(2026, 9, 24, 10);
        assert.deepEqual(
            { id: pastWeekBounds(2, now).id, firstDay: pastWeekBounds(2, now).firstDay, lastDay: pastWeekBounds(2, now).lastDay },
            { id: 'wk:2026-10-05', firstDay: '2026-10-05', lastDay: '2026-10-09' },
        );
        assert.deepEqual(listRecentWeeks(3, now).map((w) => w.id), ['wk:2026-10-19', 'wk:2026-10-12', 'wk:2026-10-05']);
    });
});

describe('easternWeekBounds (launch item i58)', () => {
    test('Friday after 4 PM in New York it is the week just ended, Monday midnight to Friday 4 PM Eastern', () => {
        // Friday Oct 30, 2026 at 6:30 PM EDT: the nightly run's time.
        const week = easternWeekBounds(new Date('2026-10-30T22:30:00Z'));
        assert.deepEqual(week, {
            id: 'wk:2026-10-26',
            weekStart: '2026-10-26T04:00:00.000Z',
            weekEnd: '2026-10-30T20:00:00.000Z',
            firstDay: '2026-10-26',
            lastDay: '2026-10-30',
        });
    });

    test('before Friday\'s close in New York it is the week before, whatever the clock in UTC says', () => {
        // 8:30 PM UTC is 4:30 PM EDT, past the close; 7:59 PM UTC isn't.
        assert.equal(easternWeekBounds(new Date('2026-10-30T19:59:00Z')).id, 'wk:2026-10-19');
        assert.equal(easternWeekBounds(new Date('2026-10-30T20:00:00Z')).id, 'wk:2026-10-26');
        // Saturday 1 AM UTC is still Friday evening in New York.
        assert.equal(easternWeekBounds(new Date('2026-10-31T01:00:00Z')).id, 'wk:2026-10-26');
        // Monday evening: still last week's.
        assert.equal(easternWeekBounds(new Date('2026-11-02T22:30:00Z')).id, 'wk:2026-10-26');
    });

    test('in winter the week runs on Eastern Standard Time', () => {
        const week = easternWeekBounds(new Date('2026-12-05T12:00:00Z'));
        assert.equal(week.id, 'wk:2026-11-30');
        assert.equal(week.weekStart, '2026-11-30T05:00:00.000Z');
        assert.equal(week.weekEnd, '2026-12-04T21:00:00.000Z');
    });

    test('a week across a month end keeps its days', () => {
        const week = easternWeekBounds(new Date('2026-10-03T15:00:00Z'));
        assert.equal(week.firstDay, '2026-09-28');
        assert.equal(week.lastDay, '2026-10-02');
    });
});
