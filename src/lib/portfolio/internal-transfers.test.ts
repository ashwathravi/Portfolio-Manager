import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { matchInternalTransfers, TRANSFER_WINDOW_DAYS, type TransferLeg } from './internal-transfers';

/** A deposit or withdrawal; the account's ID is its name unless given. */
function leg(id: string, side: string, account: string, value: number, date: string, extra: Partial<TransferLeg> = {}): TransferLeg {
    return { id, side, accountId: account, account, value, currency: 'USD', date: `${date}T12:00:00.000Z`, ...extra };
}

/** Each transfer as "withdrawal→deposit", sorted. */
function pairs(legs: readonly TransferLeg[]): string[] {
    const matches = matchInternalTransfers(legs);
    return [...matches].filter(([, t]) => t.direction === 'out').map(([id, t]) => `${id}→${t.otherId}`).sort();
}

describe('matchInternalTransfers', () => {
    test('pairs a withdrawal and a deposit of the same amount in two accounts, both sides', () => {
        const matches = matchInternalTransfers([
            leg('w', 'WITHDRAWAL', 'Brokerage', 2500, '2026-03-02'),
            leg('d', 'DEPOSIT', 'Roth IRA', 2500, '2026-03-04'),
        ]);
        assert.deepEqual(matches.get('w'), { direction: 'out', otherId: 'd', otherAccountId: 'Roth IRA', otherAccount: 'Roth IRA' });
        assert.deepEqual(matches.get('d'), { direction: 'in', otherId: 'w', otherAccountId: 'Brokerage', otherAccount: 'Brokerage' });
    });

    test(`pairs them up to ${TRANSFER_WINDOW_DAYS} days apart, in either order`, () => {
        assert.deepEqual(pairs([
            leg('w', 'WITHDRAWAL', 'A', 100, '2026-03-02'),
            leg('d', 'DEPOSIT', 'B', 100, '2026-03-07'),
        ]), ['w→d']);
        // The deposit can post first.
        assert.deepEqual(pairs([
            leg('w', 'WITHDRAWAL', 'A', 100, '2026-03-04'),
            leg('d', 'DEPOSIT', 'B', 100, '2026-03-03'),
        ]), ['w→d']);
        assert.deepEqual(pairs([
            leg('w', 'WITHDRAWAL', 'A', 100, '2026-03-02'),
            leg('d', 'DEPOSIT', 'B', 100, '2026-03-08'),
        ]), []);
    });

    test('never pairs within one account', () => {
        assert.deepEqual(pairs([
            leg('w', 'WITHDRAWAL', 'A', 100, '2026-03-02'),
            leg('d', 'DEPOSIT', 'A', 100, '2026-03-02'),
        ]), []);
    });

    test('regression: two accounts with the same name are two accounts', () => {
        assert.deepEqual(pairs([
            leg('w', 'WITHDRAWAL', 'Brokerage', 100, '2026-03-02', { accountId: 'p1' }),
            leg('d', 'DEPOSIT', 'Brokerage', 100, '2026-03-02', { accountId: 'p2' }),
        ]), ['w→d']);
    });

    test('needs the same amount to the cent, in the same currency', () => {
        assert.deepEqual(pairs([
            leg('w', 'WITHDRAWAL', 'A', 100, '2026-03-02'),
            leg('d', 'DEPOSIT', 'B', 100.01, '2026-03-02'),
        ]), []);
        assert.deepEqual(pairs([
            leg('w', 'WITHDRAWAL', 'A', 100, '2026-03-02'),
            leg('d', 'DEPOSIT', 'B', 100, '2026-03-02', { currency: 'CAD' }),
        ]), []);
        // Floating-point noise isn't a different amount.
        assert.deepEqual(pairs([
            leg('w', 'WITHDRAWAL', 'A', 0.1 + 0.2, '2026-03-02'),
            leg('d', 'DEPOSIT', 'B', 0.3, '2026-03-02'),
        ]), ['w→d']);
    });

    test('pairs each transaction once, with the closest deposit in time', () => {
        assert.deepEqual(pairs([
            leg('w1', 'WITHDRAWAL', 'A', 100, '2026-03-02'),
            leg('w2', 'WITHDRAWAL', 'A', 100, '2026-03-05'),
            leg('far', 'DEPOSIT', 'B', 100, '2026-03-06'),
            leg('near', 'DEPOSIT', 'C', 100, '2026-03-03'),
        ]), ['w1→near', 'w2→far']);
        // One deposit for two withdrawals: the older withdrawal has it.
        assert.deepEqual(pairs([
            leg('w1', 'WITHDRAWAL', 'A', 100, '2026-03-02'),
            leg('w2', 'WITHDRAWAL', 'C', 100, '2026-03-03'),
            leg('d', 'DEPOSIT', 'B', 100, '2026-03-03'),
        ]), ['w1→d']);
    });

    test('of two deposits as close, takes the older', () => {
        assert.deepEqual(pairs([
            leg('w', 'WITHDRAWAL', 'A', 100, '2026-03-04'),
            leg('after', 'DEPOSIT', 'B', 100, '2026-03-05'),
            leg('before', 'DEPOSIT', 'C', 100, '2026-03-03'),
        ]), ['w→before']);
    });

    test('only deposits and withdrawals of some amount are transfers', () => {
        assert.deepEqual(pairs([
            leg('s', 'SELL', 'A', 100, '2026-03-02'),
            leg('b', 'BUY', 'B', 100, '2026-03-02'),
            leg('w', 'WITHDRAWAL', 'A', 0, '2026-03-02'),
            leg('d', 'DEPOSIT', 'B', 0, '2026-03-02'),
            leg('div', 'DIVIDEND', 'B', 100, '2026-03-02'),
        ]), []);
        assert.equal(matchInternalTransfers([]).size, 0);
    });
});
