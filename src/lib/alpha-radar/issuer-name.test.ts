import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeIssuerName } from './issuer-name';

const same = (a: string, b: string) => assert.equal(normalizeIssuerName(a), normalizeIssuerName(b), `${a} / ${b}`);
const different = (a: string, b: string) => assert.notEqual(normalizeIssuerName(a), normalizeIssuerName(b), `${a} / ${b}`);

describe('normalizeIssuerName', () => {
    test('a 13F issuer name and SEC\'s or a broker\'s name for the company agree', () => {
        same('APPLE INC', 'Apple Inc.');
        same('MICROSOFT CORP', 'Microsoft Corporation');
        same('AMAZON COM INC', 'Amazon.com Inc.');
        same('ALPHABET INC', 'Alphabet Inc.');
        same('COCA COLA CO', 'Coca-Cola Co');
        same('CHUBB LIMITED', 'Chubb Ltd');
        same('BERKSHIRE HATHAWAY INC DEL', 'BERKSHIRE HATHAWAY INC');
        same('CHEVRON CORP NEW', 'Chevron Corp');
        same('META PLATFORMS INC CL A', 'Meta Platforms, Inc.');
        same('JOHNSON & JOHNSON', 'Johnson and Johnson');
    });

    test('the abbreviations in CUSIP descriptions, and SEC\'s state markers', () => {
        same('BANK AMER CORP', 'BANK OF AMERICA CORP /DE/');
        same('OCCIDENTAL PETE CORP', 'OCCIDENTAL PETROLEUM CORP /DE/');
        same('ALLY FINL INC', 'Ally Financial Inc.');
        same('INTERNATIONAL BUSINESS MACHS', 'INTERNATIONAL BUSINESS MACHINES CORP');
        same('TEXAS INSTRS INC', 'Texas Instruments Inc');
        same('GENERAL MTRS CO', 'General Motors Co');
    });

    test('a different company with a name that starts the same is not a match', () => {
        different('APPLE HOSPITALITY REIT INC', 'Apple Inc.');
        different('BANK AMER CORP', 'BANK OF NEW YORK MELLON CORP');
        different('NEWS CORP NEW', 'NEW YORK TIMES CO');
    });

    test('only trailing words are dropped, and a name is never dropped entirely', () => {
        assert.equal(normalizeIssuerName('NEW YORK TIMES CO'), 'NEW YORK TIMES');
        assert.equal(normalizeIssuerName('VISA INC'), 'VISA');
        assert.equal(normalizeIssuerName('COMPANY'), 'COMPANY');
        assert.equal(normalizeIssuerName(''), '');
        assert.equal(normalizeIssuerName('  ,. '), '');
    });
});
