import { test } from 'node:test';
import assert from 'node:assert/strict';

import { plaidSyncMessage } from './sync-summary';

const account = (fields: Partial<Parameters<typeof plaidSyncMessage>[0][number]> = {}) => ({
    name: 'Fidelity Individual', positions: 12, transactionsAdded: 236, transactionsPending: false, holdingsSkipped: 0, costUnknown: 0, ...fields,
});

test('plaidSyncMessage - one account, by name', () => {
    assert.equal(plaidSyncMessage([account()]), 'Fidelity Individual: 12 positions and 236 new transactions.');
    assert.equal(plaidSyncMessage([account({ positions: 1, transactionsAdded: 1 })]), 'Fidelity Individual: 1 position and 1 new transaction.');
});

test('plaidSyncMessage - several accounts, added up', () => {
    assert.equal(plaidSyncMessage([account(), account({ name: 'Roth IRA', positions: 3, transactionsAdded: 1200 })]), '2 accounts: 15 positions and 1,436 new transactions.');
});

test('plaidSyncMessage - says what is still to come, and what was left out', () => {
    assert.equal(
        plaidSyncMessage([account({ transactionsAdded: 0, transactionsPending: true, holdingsSkipped: 2, costUnknown: 1 })]),
        'Fidelity Individual: 12 positions and 0 new transactions. Transactions follow once the institution has them ready. '
        + "2 holdings without a ticker, or in another currency, weren't brought in. 1 position without a reported cost is held at its price.",
    );
    assert.match(plaidSyncMessage([account({ holdingsSkipped: 1, costUnknown: 3 })]), /1 holding without a ticker, or in another currency, wasn't brought in\. 3 positions without a reported cost are held at their price\.$/);
});

test('plaidSyncMessage - a connection without an investment account', () => {
    assert.equal(plaidSyncMessage([]), 'No investment accounts to sync on this connection.');
});

test('plaidSyncMessage - picked accounts past the account limit say so', () => {
    assert.equal(
        plaidSyncMessage([account()], ['Fidelity Roth IRA']),
        "Fidelity Individual: 12 positions and 236 new transactions. Fidelity Roth IRA wasn't added: you already have as many accounts as Atlas keeps. Delete one on Accounts to make room.",
    );
    assert.equal(
        plaidSyncMessage([], ['A', 'B']),
        "2 accounts weren't added: you already have as many accounts as Atlas keeps. Delete one on Accounts to make room.",
    );
});
