import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { accountDeletionSchema } from './account';

describe('accountDeletionSchema', () => {
    test('takes the typed confirmation', () => {
        assert.deepEqual(accountDeletionSchema.parse({ confirm: 'DELETE' }), { confirm: 'DELETE' });
    });

    test('refuses anything else, with the message the dialog shows', () => {
        for (const body of [{}, { confirm: 'delete' }, { confirm: 'DELETE ' }, { confirm: true }, { confirm: 'DELETE', userId: 'someone-else' }]) {
            const result = accountDeletionSchema.safeParse(body);
            assert.equal(result.success, false, JSON.stringify(body));
        }
        const result = accountDeletionSchema.safeParse({ confirm: 'delete' });
        assert.ok(!result.success && result.error.issues[0].message === 'Type DELETE to confirm');
    });
});
