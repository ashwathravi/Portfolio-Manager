import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { currentWeekBounds, listRecentWeeks, pastWeekBounds } from './weeks';

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
