import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    OPTION_POSITION_LIMITS,
    optionContractRowSchema,
    optionImportRowsSchema,
    optionPositionCreateSchema,
    optionPositionSchema,
} from './option-position';

const ROW = { underlying: 'AAPL', contractType: 'call', strike: 250, expiry: '2027-01-15', quantity: 3, premium: 18.2 } as const;
const ACCOUNT = '00000000-0000-4000-8000-000000000001';

function firstMessage(result: { success: boolean; error?: { issues: Array<{ message: string }> } }): string | undefined {
    return result.success ? undefined : result.error?.issues[0]?.message;
}

describe('optionPositionSchema', () => {
    test('a contract with what was paid is enough; the rest defaults', () => {
        const result = optionPositionSchema.safeParse(ROW);
        assert.equal(result.success, true);
        assert.deepEqual(result.data, {
            ...ROW,
            multiplier: 100,
            openedAt: null,
            userMark: null,
            userMarkDate: null,
            thesisId: null,
            expiryTest: '',
            exitRule: '',
        });
    });

    test('keeps a written position (negative contracts), a price of the user’s own with its date, and the plan', () => {
        const result = optionPositionSchema.safeParse({
            ...ROW,
            quantity: -2,
            userMark: 21.4,
            userMarkDate: '2026-10-16',
            thesisId: 'thesis-1',
            expiryTest: '  Services re-rate earnings  ',
            exitRule: 'Exit at half',
            openedAt: '2026-02-01',
        });
        assert.equal(result.success, true);
        assert.equal(result.data?.quantity, -2);
        assert.equal(result.data?.expiryTest, 'Services re-rate earnings');
    });

    test('refuses each invalid field with a message that names it', () => {
        const cases: Array<[Record<string, unknown>, RegExp]> = [
            [{ underlying: 'aapl' }, /Ticker must be uppercase/],
            [{ contractType: 'straddle' }, /call or put/],
            [{ strike: 0 }, /strike above 0/],
            [{ strike: 12.3755 }, /three decimals/],
            [{ expiry: '2027-02-30' }, /expiry must be a date/],
            [{ quantity: 0 }, /number of contracts/],
            [{ quantity: 2e6 }, /quantity is out of range/],
            [{ premium: -1 }, /premium can't be negative/],
            [{ userMark: 5 }, /needs its date/],
            [{ userMarkDate: '2026-10-16' }, /needs its date/],
            [{ expiryTest: 'x'.repeat(OPTION_POSITION_LIMITS.expiryTest + 1) }, /at most 500/],
            [{ exitRule: '<script>' }, /invalid characters/],
            [{ multiplier: 0 }, /multiplier must be more than 0/],
        ];
        for (const [patch, message] of cases) {
            const result = optionPositionSchema.safeParse({ ...ROW, ...patch });
            assert.equal(result.success, false, JSON.stringify(patch));
            assert.match(firstMessage(result) ?? '', message, JSON.stringify(patch));
        }
    });

    test('refuses fields the form never sends', () => {
        assert.equal(optionPositionSchema.safeParse({ ...ROW, userId: 'someone-else' }).success, false);
    });
});

describe('optionPositionCreateSchema', () => {
    test('needs one of the user’s accounts by ID', () => {
        assert.equal(optionPositionCreateSchema.safeParse({ portfolioId: ACCOUNT, position: ROW }).success, true);
        assert.equal(firstMessage(optionPositionCreateSchema.safeParse({ portfolioId: 'brokerage', position: ROW })), 'Choose an account');
        assert.equal(optionPositionCreateSchema.safeParse({ portfolioId: ACCOUNT, position: ROW, extra: true }).success, false);
    });
});

describe('optionImportRowsSchema', () => {
    test('a CSV’s option rows, each contract once', () => {
        assert.equal(optionImportRowsSchema.safeParse([ROW, { ...ROW, strike: 300 }]).success, true);
        assert.equal(firstMessage(optionImportRowsSchema.safeParse([ROW, { ...ROW, quantity: 1 }])), 'Each option contract can appear only once');
    });

    test('at most the import limit, and only the contract columns', () => {
        const many = Array.from({ length: OPTION_POSITION_LIMITS.importRows + 1 }, (_, i) => ({ ...ROW, strike: i + 1 }));
        assert.match(firstMessage(optionImportRowsSchema.safeParse(many)) ?? '', /at most 500/);
        assert.equal(optionContractRowSchema.safeParse({ ...ROW, thesisId: 'x' }).success, false);
    });
});
