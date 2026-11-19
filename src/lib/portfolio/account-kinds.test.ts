import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    ACCOUNT_TYPES,
    DEFAULT_TAX_TREATMENT,
    accountKindLine,
    accountTypeForPlaid,
    taxTreatmentForPlaid,
} from './account-kinds';

describe('account kinds', () => {
    test("Plaid's investment subtypes as Atlas's kinds and tax treatment", () => {
        const cases: [string, string | null, string | null][] = [
            ['brokerage', 'brokerage', 'taxable'],
            ['401k', '401k', 'tax_deferred'],
            ['Roth 401k', '401k', 'tax_free'],
            ['ira', 'traditional_ira', 'tax_deferred'],
            ['roth', 'roth_ira', 'tax_free'],
            ['529', '529', 'tax_free'],
            ['hsa', 'hsa', 'tax_free'],
            ['stock plan', 'equity_comp', 'taxable'],
            ['crypto exchange', 'crypto', 'taxable'],
            ['checking', null, null],
            ['', null, null],
        ];
        for (const [subtype, type, tax] of cases) {
            assert.equal(accountTypeForPlaid(subtype), type, subtype);
            assert.equal(taxTreatmentForPlaid(subtype), tax, subtype);
        }
        assert.equal(accountTypeForPlaid(null), null);
    });

    test('every kind has a default tax treatment entry; "other" suggests none', () => {
        for (const type of ACCOUNT_TYPES) assert.ok(type in DEFAULT_TAX_TREATMENT, type);
        assert.equal(DEFAULT_TAX_TREATMENT.other, null);
    });

    test('the line under an account name: kind and institution, either alone, or nothing', () => {
        assert.equal(accountKindLine({ accountType: 'roth_ira', institution: 'Fidelity' }), 'Roth IRA · Fidelity');
        assert.equal(accountKindLine({ accountType: null, institution: 'Schwab' }), 'Schwab');
        assert.equal(accountKindLine({ accountType: '529', institution: '  ' }), '529 plan');
        assert.equal(accountKindLine({ accountType: 'unknown', institution: null }), null);
        assert.equal(accountKindLine({}), null);
    });
});
