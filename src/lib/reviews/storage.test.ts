import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reviewStateId } from './storage';

test('reviewStateId - the review of your trades keeps its state apart from the example review of the same week (launch item i51)', () => {
    assert.equal(reviewStateId('wk:2026-10-19', 'trades'), 'trades:wk:2026-10-19');
    // Example reviews keep the key they had before there were real ones.
    assert.equal(reviewStateId('wk:2026-10-19', 'example'), 'wk:2026-10-19');
});
