import { test } from 'node:test';
import assert from 'node:assert/strict';

import { contentExternalId, transactionAmount, transactionTimestamp } from './transactions';

test('transactionAmount - given, or quantity × price for a trade, always positive and in cents', () => {
    assert.equal(transactionAmount({ type: 'BUY', quantity: 3, price: 10.005 }), 30.02);
    assert.equal(transactionAmount({ type: 'SELL', quantity: -2, price: 5, amount: -9.99 }), 9.99);
    assert.equal(transactionAmount({ type: 'DEPOSIT', amount: 1000 }), 1000);
    assert.equal(transactionAmount({ type: 'DIVIDEND', quantity: 1 }), 0);
});

test('transactionTimestamp - noon UTC on the date, so it reads as that date everywhere', () => {
    assert.equal(transactionTimestamp('2026-03-05').toISOString(), '2026-03-05T12:00:00.000Z');
});

test('contentExternalId - the same row gives the same ID; a repeat in the file counts apart', () => {
    const row = { type: 'BUY' as const, date: '2026-03-05', symbol: 'AAPL', quantity: 10, price: 180.5, amount: null, fees: null };
    assert.equal(contentExternalId(row, 0), contentExternalId({ ...row }, 0));
    assert.notEqual(contentExternalId(row, 0), contentExternalId(row, 1));
    assert.notEqual(contentExternalId(row, 0), contentExternalId({ ...row, quantity: 11 }, 0));
});

test('regression: contentExternalId - the same row in another currency is another transaction', () => {
    // The Codex finding on PR #154: a CAD deposit was skipped as a copy of a USD one.
    const deposit = { type: 'DEPOSIT' as const, date: '2026-03-05', amount: 100 };
    assert.notEqual(contentExternalId({ ...deposit, currency: 'USD' }, 0), contentExternalId({ ...deposit, currency: 'CAD' }, 0));
    // No currency given is USD, as stored.
    assert.equal(contentExternalId(deposit, 0), contentExternalId({ ...deposit, currency: 'USD' }, 0));
});

