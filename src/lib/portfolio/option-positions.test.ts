import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    chooseOptionMark,
    describeOptionContract,
    isCalendarDate,
    isOptionStrike,
    optionContractTicker,
    parseOptionContract,
    toOptionRiskPosition,
    type LoadedOptionPosition,
} from './option-positions';

const AAPL_CALL = { underlying: 'AAPL', contractType: 'call', strike: 250, expiry: '2027-01-15' } as const;

describe('optionContractTicker', () => {
    test("names a contract as Massive does: root, YYMMDD, C or P, strike × 1000 in eight digits", () => {
        assert.equal(optionContractTicker(AAPL_CALL), 'O:AAPL270115C00250000');
        assert.equal(optionContractTicker({ underlying: 'SPY', contractType: 'put', strike: 552.5, expiry: '2026-12-18' }), 'O:SPY261218P00552500');
        assert.equal(optionContractTicker({ underlying: 'F', contractType: 'call', strike: 12.375, expiry: '2027-06-17' }), 'O:F270617C00012375');
    });

    test('a share class drops its dot, as OCC roots do', () => {
        assert.equal(optionContractTicker({ underlying: 'BRK.B', contractType: 'call', strike: 500, expiry: '2027-01-15' }), 'O:BRKB270115C00500000');
    });
});

describe('parseOptionContract', () => {
    const cases: Array<[string, string]> = [
        ['OCC with the root padded', 'AAPL  270115C00250000'],
        ['OCC without padding', 'AAPL270115C00250000'],
        ["Massive's ticker", 'O:AAPL270115C00250000'],
        ['Fidelity', '-AAPL270115C250'],
        ['Schwab', 'AAPL 01/15/2027 250.00 C'],
        ['Interactive Brokers', 'AAPL 15JAN27 250 C'],
        ['E*TRADE', "AAPL Jan 15 '27 $250 Call"],
        ['lower case and extra spaces', '  aapl   01/15/2027  250 c '],
    ];
    for (const [format, raw] of cases) {
        test(`reads ${format}: ${raw.trim()}`, () => {
            assert.deepEqual(parseOptionContract(raw), AAPL_CALL);
        });
    }

    test('puts, fractional strikes and short roots', () => {
        assert.deepEqual(parseOptionContract('-SPY261218P552.5'), { underlying: 'SPY', contractType: 'put', strike: 552.5, expiry: '2026-12-18' });
        assert.deepEqual(parseOptionContract('F 06/17/2027 12.50 P'), { underlying: 'F', contractType: 'put', strike: 12.5, expiry: '2027-06-17' });
        assert.deepEqual(parseOptionContract("RIVN Jan 15 '27 $25 Put"), { underlying: 'RIVN', contractType: 'put', strike: 25, expiry: '2027-01-15' });
    });

    test('a stock ticker, a cash line or a date that does not exist is not a contract', () => {
        for (const raw of ['AAPL', 'BRK.B', 'SPAXX**', 'Cash & Cash Investments', '', 'AAPL 02/30/2027 250 C', 'AAPL271315C00250000', 'AAPL 15FOO27 250 C']) {
            assert.equal(parseOptionContract(raw), null, raw);
        }
    });

    test('a strike of 0 is not a contract', () => {
        assert.equal(parseOptionContract('AAPL 01/15/2027 0 C'), null);
        assert.equal(parseOptionContract('AAPL270115C00000000'), null);
    });
});

describe('validation helpers', () => {
    test('isCalendarDate accepts only real YYYY-MM-DD dates', () => {
        assert.equal(isCalendarDate('2027-01-15'), true);
        assert.equal(isCalendarDate('2028-02-29'), true);
        for (const value of ['2027-02-29', '2027-1-15', '2027-13-01', '15/01/2027', '']) assert.equal(isCalendarDate(value), false, value);
    });

    test('isOptionStrike: above 0, under 100,000, at most three decimals', () => {
        for (const strike of [0.5, 12.375, 250, 99_999]) assert.equal(isOptionStrike(strike), true, String(strike));
        for (const strike of [0, -5, 12.3755, 100_000, Number.NaN]) assert.equal(isOptionStrike(strike), false, String(strike));
    });
});

describe('describeOptionContract', () => {
    test('reads the contract as a person would', () => {
        assert.equal(describeOptionContract(AAPL_CALL), 'AAPL Jan 15 2027 250 call');
        assert.equal(describeOptionContract({ underlying: 'SPY', contractType: 'put', strike: 552.5, expiry: '2026-12-18' }), 'SPY Dec 18 2026 552.5 put');
    });
});

describe('chooseOptionMark', () => {
    test('the stored close, when there is no price of the user’s own', () => {
        assert.deepEqual(chooseOptionMark({ premium: 18.2, close: 21.4, closeDate: '2026-10-16' }), { source: 'close', price: 21.4, date: '2026-10-16' });
    });

    test("the newer of the close and the user's price; the close on the same day", () => {
        const base = { premium: 18.2, close: 21.4, closeDate: '2026-10-14' };
        assert.deepEqual(chooseOptionMark({ ...base, userMark: 20, userMarkDate: '2026-10-15' }), { source: 'user', price: 20, date: '2026-10-15' });
        assert.deepEqual(chooseOptionMark({ ...base, userMark: 20, userMarkDate: '2026-10-13' }), { source: 'close', price: 21.4, date: '2026-10-14' });
        assert.deepEqual(chooseOptionMark({ ...base, userMark: 20, userMarkDate: '2026-10-14' }), { source: 'close', price: 21.4, date: '2026-10-14' });
    });

    test('regression: without any price a position is marked at what was paid, never at $0', () => {
        assert.deepEqual(chooseOptionMark({ premium: 18.2 }), { source: 'cost', price: 18.2 });
        assert.deepEqual(chooseOptionMark({ premium: 18.2, close: null, closeDate: null }), { source: 'cost', price: 18.2 });
    });

    test('a close of $0 (a worthless contract) is a price, not a missing one', () => {
        assert.deepEqual(chooseOptionMark({ premium: 4.4, close: 0, closeDate: '2026-10-16' }), { source: 'close', price: 0, date: '2026-10-16' });
    });
});

describe('toOptionRiskPosition', () => {
    const loaded: LoadedOptionPosition = {
        ...AAPL_CALL,
        id: 'p1',
        portfolioId: 'acct-1',
        account: 'Brokerage',
        contract: 'O:AAPL270115C00250000',
        quantity: 3,
        premium: 18.2,
        multiplier: 100,
        openedAt: '2026-02-01',
        userMark: null,
        userMarkDate: null,
        thesisId: 'thesis-1',
        thesisTitle: 'Services margin expansion',
        expiryTest: 'Services re-rate earnings by 2027.',
        exitRule: 'Exit if premium halves.',
        mark: { source: 'close', price: 21.4, date: '2026-10-16' },
        underlyingPrice: 231.5,
    };

    test('the ledger reads what was paid, the mark, the thesis and the rules', () => {
        assert.deepEqual(toOptionRiskPosition(loaded), {
            id: 'p1',
            underlying: 'AAPL',
            contractType: 'call',
            strike: 250,
            expiry: '2027-01-15',
            quantity: 3,
            premiumPaid: 18.2,
            currentPremium: 21.4,
            underlyingPrice: 231.5,
            contractMultiplier: 100,
            linkedThesisId: 'thesis-1',
            thesisTitle: 'Services margin expansion',
            whatMustBeTrueByExpiry: 'Services re-rate earnings by 2027.',
            plannedExitRule: 'Exit if premium halves.',
            account: 'Brokerage',
            openedAt: '2026-02-01',
        });
    });

    test('regression: a link to a deleted thesis counts as none, so the ledger asks for one', () => {
        const position = toOptionRiskPosition({ ...loaded, thesisTitle: null, expiryTest: '', exitRule: '', openedAt: null, underlyingPrice: null });
        assert.equal(position.linkedThesisId, undefined);
        assert.equal(position.whatMustBeTrueByExpiry, undefined);
        assert.equal(position.plannedExitRule, undefined);
        assert.equal(position.underlyingPrice, undefined);
    });
});
