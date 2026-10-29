import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_PLAID_ACCOUNTS_PER_ITEM, plaidLinkMetadataSchema, plaidSyncSchema } from './plaid-sync';

const ITEM = 'eVBnVMp7zdTJLkRNr33Rs6zr7KNJqBFL9DrE6';

describe('plaidSyncSchema', () => {
    test('accepts an item, with or without the accounts picked', () => {
        assert.deepEqual(plaidSyncSchema.parse({ itemId: ITEM }), { itemId: ITEM });
        assert.deepEqual(plaidSyncSchema.parse({ itemId: ITEM, plaidAccountIds: ['acc_1', 'BxBXxLj1m4HMXBm9WZZmCWVbPjX16EHwv99vp'] }).plaidAccountIds?.length, 2);
        // An empty pick is a pick: none of the item's accounts sync.
        assert.deepEqual(plaidSyncSchema.parse({ itemId: ITEM, plaidAccountIds: [] }).plaidAccountIds, []);
    });

    test('takes `reconnected: true` after Link\'s update mode, and nothing else for it', () => {
        assert.deepEqual(plaidSyncSchema.parse({ itemId: ITEM, reconnected: true }), { itemId: ITEM, reconnected: true });
        assert.equal(plaidSyncSchema.safeParse({ itemId: ITEM, reconnected: false }).success, false);
        assert.equal(plaidSyncSchema.safeParse({ itemId: ITEM, reconnected: 'yes' }).success, false);
    });

    test('refuses an ID that is not a Plaid ID', () => {
        for (const itemId of ['', 'has space', 'a/b', '<script>', 'x'.repeat(129)]) {
            const result = plaidSyncSchema.safeParse({ itemId });
            assert.equal(result.success, false, itemId);
            if (!result.success) assert.equal(result.error.issues[0].message, 'must be a Plaid ID');
        }
        assert.equal(plaidSyncSchema.safeParse({ itemId: ITEM, plaidAccountIds: ['ok', 'not ok'] }).success, false);
        // The longest ID allowed is fine.
        assert.equal(plaidSyncSchema.safeParse({ itemId: 'x'.repeat(128) }).success, true);
    });

    test('refuses more accounts than one connection has, and unknown fields', () => {
        const ids = (n: number) => Array.from({ length: n }, (_, i) => `acc_${i}`);
        assert.equal(plaidSyncSchema.safeParse({ itemId: ITEM, plaidAccountIds: ids(MAX_PLAID_ACCOUNTS_PER_ITEM) }).success, true);
        const over = plaidSyncSchema.safeParse({ itemId: ITEM, plaidAccountIds: ids(MAX_PLAID_ACCOUNTS_PER_ITEM + 1) });
        assert.equal(over.success, false);
        if (!over.success) assert.equal(over.error.issues[0].message, `At most ${MAX_PLAID_ACCOUNTS_PER_ITEM} accounts`);
        assert.equal(plaidSyncSchema.safeParse({ itemId: ITEM, accessToken: 'access-sandbox-x' }).success, false);
        assert.equal(plaidSyncSchema.safeParse({}).success, false);
    });
});

describe('plaidLinkMetadataSchema', () => {
    const metadata = {
        institution: { name: ' Fidelity ', institution_id: 'ins_12' },
        accounts: [{ id: 'acc-1', name: 'Brokerage', mask: '1234', type: 'investment', subtype: 'brokerage', verification_status: null }],
        link_session_id: 'session-1',
        status: 'connected',
        public_token: 'public-sandbox-1',
    };

    test('keeps what Link reports, trimmed, and drops the rest', () => {
        const parsed = plaidLinkMetadataSchema.parse(metadata);
        assert.deepEqual(parsed, {
            institution: { name: 'Fidelity', institution_id: 'ins_12' },
            accounts: [{ id: 'acc-1', name: 'Brokerage', mask: '1234', type: 'investment', subtype: 'brokerage', verification_status: null }],
            link_session_id: 'session-1',
        });
        assert.equal(plaidLinkMetadataSchema.safeParse({}).success, true);
        assert.equal(plaidLinkMetadataSchema.safeParse({ institution: null }).success, true);
    });

    test('refuses fields that aren\'t strings within their lengths', () => {
        const refused = [
            { institution: { name: { toString: 'x' } } },
            { institution: { name: 'x'.repeat(101) } },
            { institution: { institution_id: 'ins 12; drop' } },
            { accounts: [{ id: 'acc-1', name: 42 }] },
            { accounts: [{ id: '../acc', name: 'Brokerage' }] },
            { accounts: [{ id: 'acc-1', name: 'x'.repeat(201) }] },
            { accounts: Array.from({ length: MAX_PLAID_ACCOUNTS_PER_ITEM + 1 }, (_, i) => ({ id: `acc-${i}`, name: 'A' })) },
            { accounts: 'acc-1' },
        ];
        for (const value of refused) {
            assert.equal(plaidLinkMetadataSchema.safeParse(value).success, false, JSON.stringify(value).slice(0, 80));
        }
        assert.equal(plaidLinkMetadataSchema.safeParse({ institution: { name: 'x'.repeat(100) } }).success, true);
    });
});
