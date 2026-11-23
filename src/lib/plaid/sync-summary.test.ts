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

test('plaidSyncMessage - option positions and holdings the institution values are counted with the positions', () => {
    assert.equal(plaidSyncMessage([account({ options: 2 })]), 'Fidelity Individual: 12 positions, 2 option positions and 236 new transactions.');
    assert.equal(
        plaidSyncMessage([account({ options: 1, valued: 3 })]),
        'Fidelity Individual: 12 positions, 1 option position, 3 holdings valued by the institution and 236 new transactions.',
    );
    assert.equal(
        plaidSyncMessage([account({ name: 'Workplace 401(k)', positions: 4, valued: 3, transactionsAdded: 18 })]),
        'Workplace 401(k): 4 positions, 3 holdings valued by the institution and 18 new transactions.',
    );
    assert.equal(
        plaidSyncMessage([account({ options: 2 }), account({ name: 'Roth IRA', positions: 3, transactionsAdded: 4, options: 1, valued: 1 })]),
        '2 accounts: 15 positions, 3 option positions, 1 holding valued by the institution and 240 new transactions.',
    );
});

test('plaidSyncMessage - says what is still to come, and why each holding was left out', () => {
    assert.equal(
        plaidSyncMessage([account({
            transactionsAdded: 0, transactionsPending: true, holdingsSkipped: 5,
            skipped: { option: 2, 'no-ticker': 1, 'other-currency': 1, short: 1 }, costUnknown: 1,
        })]),
        'Fidelity Individual: 12 positions and 0 new transactions. Transactions follow once the institution has them ready. '
        + "2 options or warrants without clear contract details weren't brought in. 1 holding with no ticker and no value wasn't brought in. "
        + "1 holding in another currency wasn't brought in. 1 short position wasn't brought in. 1 position without a reported cost is held at its price.",
    );
});

test('plaidSyncMessage - each reason, one and several, added up across accounts', () => {
    const skippedOnly = (skipped: Record<string, number>) => {
        const n = Object.values(skipped).reduce((a, b) => a + b, 0);
        return plaidSyncMessage([account({ holdingsSkipped: n, skipped })]).replace('Fidelity Individual: 12 positions and 236 new transactions. ', '');
    };
    assert.equal(skippedOnly({ option: 1 }), "1 option or warrant without clear contract details wasn't brought in.");
    assert.equal(skippedOnly({ option: 2 }), "2 options or warrants without clear contract details weren't brought in.");
    assert.equal(skippedOnly({ 'no-ticker': 1 }), "1 holding with no ticker and no value wasn't brought in.");
    assert.equal(skippedOnly({ 'no-ticker': 2 }), "2 holdings with no ticker and no value weren't brought in.");
    assert.equal(skippedOnly({ 'other-currency': 1 }), "1 holding in another currency wasn't brought in.");
    assert.equal(skippedOnly({ 'other-currency': 2 }), "2 holdings in other currencies weren't brought in.");
    assert.equal(skippedOnly({ short: 1 }), "1 short position wasn't brought in.");
    assert.equal(skippedOnly({ short: 2 }), "2 short positions weren't brought in.");
    assert.match(
        plaidSyncMessage([account({ holdingsSkipped: 1, skipped: { option: 1 } }), account({ name: 'Roth IRA', holdingsSkipped: 1, skipped: { option: 1 } })]),
        / 2 options or warrants without clear contract details weren't brought in\.$/,
    );
});

test('plaidSyncMessage - holdings left out for no reason given are counted as the rest', () => {
    // A server before the reasons sends the total alone.
    assert.match(plaidSyncMessage([account({ holdingsSkipped: 2 })]), / 2 holdings weren't brought in\.$/);
    assert.match(plaidSyncMessage([account({ holdingsSkipped: 1, costUnknown: 3 })]), / 1 holding wasn't brought in\. 3 positions without a reported cost are held at their price\.$/);
    assert.match(
        plaidSyncMessage([account({ holdingsSkipped: 2, skipped: { option: 1 } })]),
        / 1 option or warrant without clear contract details wasn't brought in\. 1 other holding wasn't brought in\.$/,
    );
});

test('plaidSyncMessage - transactions in another currency say they weren\'t recorded', () => {
    assert.match(
        plaidSyncMessage([account({ transactionsSkippedBy: { 'other-currency': 1, 'not-recorded': 4 } })]),
        /new transactions\. 1 transaction in another currency wasn't recorded\.$/,
    );
    assert.match(
        plaidSyncMessage([account({ transactionsSkippedBy: { 'other-currency': 2 } }), account({ name: 'Roth IRA', transactionsSkippedBy: { 'other-currency': 1 } })]),
        / 3 transactions in other currencies weren't recorded\.$/,
    );
    // Others left out (a corporate action, an option trade) aren't news.
    assert.equal(plaidSyncMessage([account({ transactionsSkippedBy: { option: 3, 'not-recorded': 2 } })]), 'Fidelity Individual: 12 positions and 236 new transactions.');
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
