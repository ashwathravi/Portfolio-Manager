import { test, describe } from 'node:test';
import assert from 'node:assert';
import type { JournalEntry } from '@/types/trade';
import { getSeedJournal, seedJournalAnchorMs } from './seed';

const newestClose = (entries: readonly JournalEntry[]) => entries.map((e) => e.closedAt).sort().at(-1);

describe('example journal', () => {
    test('regression: dates anchor to the start of the UTC day, not module-load time', () => {
        // A module-load Date.now() differed between a long-running server and
        // the browser, so 30-day windows disagreed and /strategies failed hydration.
        const anchor = seedJournalAnchorMs();
        assert.strictEqual(anchor % 86_400_000, 0);
        assert.ok(Date.now() - anchor < 86_400_000);
        assert.strictEqual(seedJournalAnchorMs(Date.parse('2026-09-25T23:59:00Z')), Date.parse('2026-09-25T00:00:00Z'));
    });

    test('regression: a long-running process re-anchors after UTC midnight', () => {
        // The anchor used to be computed once at module load, so a server that
        // loaded the module just before midnight kept rendering the previous
        // day's dates while the browser computed the new day.
        const lateOnDayN = getSeedJournal(Date.parse('2026-09-25T23:59:00Z'));
        const earlyOnDayN1 = getSeedJournal(Date.parse('2026-09-26T00:01:00Z'));
        assert.strictEqual(newestClose(lateOnDayN), '2026-09-17T00:00:00.000Z');
        assert.strictEqual(newestClose(earlyOnDayN1), '2026-09-18T00:00:00.000Z');
    });

    test('returns the same entries for every call within a UTC day', () => {
        const morning = getSeedJournal(Date.parse('2026-09-30T00:01:00Z'));
        const night = getSeedJournal(Date.parse('2026-09-30T23:59:00Z'));
        assert.strictEqual(morning, night);
    });

    test('every entry closes on or before the anchor', () => {
        const now = Date.parse('2026-09-30T12:00:00Z');
        const entries = getSeedJournal(now);
        assert.ok(entries.length >= 10);
        for (const e of entries) assert.ok(Date.parse(e.closedAt) <= seedJournalAnchorMs(now), e.id);
    });
});
