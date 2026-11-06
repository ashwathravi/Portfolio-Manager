import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { emailPreferencesInputSchema, unsubscribeSchema } from './email';

const TOKEN = 'a'.repeat(21) + '-_' + 'Z9'.repeat(10);

describe('emailPreferencesInputSchema (launch item i58)', () => {
    test('takes one switch or both', () => {
        assert.deepEqual(emailPreferencesInputSchema.parse({ alerts: true }), { alerts: true });
        assert.deepEqual(emailPreferencesInputSchema.parse({ weeklyReview: false }), { weeklyReview: false });
        assert.deepEqual(emailPreferencesInputSchema.parse({ alerts: false, weeklyReview: true }), { alerts: false, weeklyReview: true });
    });

    test('refuses nothing to change, a switch that isn\'t true or false, and anything else', () => {
        const empty = emailPreferencesInputSchema.safeParse({});
        assert.equal(empty.success, false);
        if (!empty.success) assert.equal(empty.error.issues[0].message, 'Send alerts, weeklyReview or both');
        assert.equal(emailPreferencesInputSchema.safeParse({ alerts: 'yes' }).success, false);
        const extra = emailPreferencesInputSchema.safeParse({ alerts: true, address: 'someone@example.test' });
        assert.equal(extra.success, false);
        if (!extra.success) assert.equal(extra.error.issues[0].code, 'unrecognized_keys');
    });
});

describe('unsubscribeSchema', () => {
    test('takes a 43-character base64url token and a list', () => {
        assert.equal(TOKEN.length, 43);
        assert.deepEqual(unsubscribeSchema.parse({ token: TOKEN, list: 'weekly_review' }), { token: TOKEN, list: 'weekly_review' });
    });

    test('refuses other tokens and lists', () => {
        for (const token of ['', 'short', `${TOKEN}x`, `${TOKEN.slice(0, 42)}=`, `${TOKEN.slice(0, 42)}/`]) {
            assert.equal(unsubscribeSchema.safeParse({ token, list: 'alerts' }).success, false, token);
        }
        assert.equal(unsubscribeSchema.safeParse({ token: TOKEN, list: 'all' }).success, false);
        assert.equal(unsubscribeSchema.safeParse({ token: null, list: null }).success, false);
    });
});
