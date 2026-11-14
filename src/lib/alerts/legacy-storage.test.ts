import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { FORMERLY_SHARED_KEYS } from '@/lib/storage/shared-keys';

import { ALERTS_STORAGE_KEY } from './legacy-storage';

describe('ALERTS_STORAGE_KEY (launch item i57)', () => {
    test('is the key alerts were kept under in this browser, so an old copy can still be found', () => {
        assert.equal(ALERTS_STORAGE_KEY, 'atlas-alerts');
    });

    test('stays among the formerly shared keys, which deleting an account clears from this browser', () => {
        assert.ok((FORMERLY_SHARED_KEYS as readonly string[]).includes(ALERTS_STORAGE_KEY));
    });
});
