import { test, describe } from 'node:test';
import assert from 'node:assert';
import { SEED_JOURNAL, SEED_JOURNAL_ANCHOR_MS } from './seed';

describe('example journal', () => {
    test('regression: dates anchor to the start of the UTC day, not module-load time', () => {
        // A module-load Date.now() differed between a long-running server and
        // the browser, so 30-day windows disagreed and /strategies failed hydration.
        assert.strictEqual(SEED_JOURNAL_ANCHOR_MS % 86_400_000, 0);
        assert.ok(Date.now() - SEED_JOURNAL_ANCHOR_MS < 86_400_000);
    });

    test('every entry closes on or before the anchor', () => {
        assert.ok(SEED_JOURNAL.length >= 10);
        for (const e of SEED_JOURNAL) assert.ok(Date.parse(e.closedAt) <= SEED_JOURNAL_ANCHOR_MS, e.id);
    });
});
