import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { portfolios } from '@/db/schema';

import {
    ACCOUNT_TYPES,
    DEFAULT_OWNERSHIP,
    DEFAULT_TAX_TREATMENT,
    OWNERSHIP_LABELS,
    OWNERSHIPS,
    TAX_TREATMENTS,
    accountKindLine,
    accountTypeForPlaid,
    isOwnership,
    isTaxTreatment,
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

    test('the line ends with whose name the account is in, when the user said', () => {
        assert.equal(accountKindLine({ accountType: 'roth_ira', institution: 'Fidelity', ownership: 'individual' }), 'Roth IRA · Fidelity · Individual');
        assert.equal(accountKindLine({ ownership: 'joint' }), 'Joint');
        assert.equal(accountKindLine({ institution: 'Schwab', ownership: 'dependent' }), 'Schwab · For a dependent');
        assert.equal(accountKindLine({ accountType: '529', ownership: 'dependent' }), '529 plan · For a dependent');
        // An ownership that isn't on the list is left out, never shown raw.
        assert.equal(accountKindLine({ accountType: 'brokerage', ownership: 'partner' }), 'Brokerage');
        assert.equal(accountKindLine({ ownership: null }), null);
    });

    test('ownerships and their labels', () => {
        assert.deepEqual([...OWNERSHIPS], ['individual', 'joint', 'dependent', 'business']);
        assert.deepEqual(OWNERSHIPS.map((o) => OWNERSHIP_LABELS[o]), ['Individual', 'Joint', 'For a dependent', 'Business']);
    });

    test("picking a kind suggests whose name it's usually in: one person's for retirement and the like, a dependent's for a 529", () => {
        for (const type of ACCOUNT_TYPES) assert.ok(type in DEFAULT_OWNERSHIP, type);
        for (const type of ['401k', '403b', 'traditional_ira', 'roth_ira', 'sep_ira', 'pension', 'hsa', 'equity_comp'] as const) {
            assert.equal(DEFAULT_OWNERSHIP[type], 'individual', type);
        }
        assert.equal(DEFAULT_OWNERSHIP['529'], 'dependent');
        // Anyone's: no suggestion.
        for (const type of ['brokerage', 'crypto', 'other'] as const) assert.equal(DEFAULT_OWNERSHIP[type], null, type);
    });

    test('a tax treatment or an ownership is one from the list, spelled as stored', () => {
        for (const value of TAX_TREATMENTS) assert.equal(isTaxTreatment(value), true, value);
        for (const value of OWNERSHIPS) assert.equal(isOwnership(value), true, value);
        for (const value of [null, undefined, '', 'Joint', 'exempt', 'partner', 'Taxable']) {
            assert.equal(isTaxTreatment(value), false, String(value));
            assert.equal(isOwnership(value), false, String(value));
        }
    });

    // The lists live twice: here and in the table's checks (migrations 0034
    // and 0039). One changed alone would pass the validator and then fail
    // every save, or offer a value the form can't show.
    test("the database allows exactly the app's lists, in their order", () => {
        const dialect = new PgDialect();
        const checks = new Map(getTableConfig(portfolios).checks.map((c) => [c.name, dialect.sqlToQuery(c.value).sql]));
        const listed = (name: string) => [...(checks.get(name) ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1]);
        assert.deepEqual(listed('portfolios_account_type_check'), [...ACCOUNT_TYPES]);
        assert.deepEqual(listed('portfolios_tax_treatment_check'), [...TAX_TREATMENTS]);
        assert.deepEqual(listed('portfolios_ownership_check'), [...OWNERSHIPS]);
    });
});
