/**
 * A company's name reduced to what 13F filings and SEC's ticker file agree
 * on (launch item i61). A 13F information table names each holding by its
 * issuer ("BANK AMER CORP", "OCCIDENTAL PETE CORP", "CHEVRON CORP NEW") and
 * CUSIP, never by ticker, while SEC's ticker file and brokers name the
 * company in full ("BANK OF AMERICA CORP /DE/", "Chevron Corp"). Both reduce
 * to the same key here, so a holding can be matched to a user's ticker by
 * name. Two names match only when their keys are equal: "Apple Hospitality
 * REIT" is not Apple.
 */

// The forms abbreviated in CUSIP issuer descriptions, spelled out.
const ABBREVIATIONS: Readonly<Record<string, string>> = {
    AIRLS: 'AIRLINES',
    AMER: 'AMERICA',
    BANCORPORATION: 'BANCORP',
    CHEM: 'CHEMICAL',
    COMMUNICATNS: 'COMMUNICATIONS',
    ELEC: 'ELECTRIC',
    ENTMT: 'ENTERTAINMENT',
    FINL: 'FINANCIAL',
    GRP: 'GROUP',
    HLDG: 'HOLDING',
    HLDGS: 'HOLDINGS',
    INDS: 'INDUSTRIES',
    INSTRS: 'INSTRUMENTS',
    INTL: 'INTERNATIONAL',
    LABS: 'LABORATORIES',
    MACHS: 'MACHINES',
    MFG: 'MANUFACTURING',
    MGMT: 'MANAGEMENT',
    MTRS: 'MOTORS',
    NATL: 'NATIONAL',
    PETE: 'PETROLEUM',
    PHARMACEUTICALS: 'PHARMACEUTICAL',
    PPTYS: 'PROPERTIES',
    PRODS: 'PRODUCTS',
    RLTY: 'REALTY',
    SVCS: 'SERVICES',
    SYS: 'SYSTEMS',
    TECHNOLOGIES: 'TECHNOLOGY',
    TR: 'TRUST',
};

// Words that say nothing about which company it is.
const NOISE = new Set(['THE', 'OF', 'AND']);

// What can follow the name: the legal form, a state of incorporation, the
// share class or the kind of security. Taken off the end only, one at a
// time, so "NEW YORK TIMES CO" keeps its "NEW".
const TRAILING = new Set([
    'INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LTD', 'LIMITED',
    'PLC', 'LLC', 'LP', 'SA', 'NV', 'AG', 'SE', 'N', 'V',
    'NEW', 'DEL', 'DE', 'MD', 'PA', 'VA', 'NY', 'NJ', 'OH', 'IL', 'TX', 'CA', 'MN', 'WI', 'MA',
    'COM', 'COMMON', 'STOCK', 'SHS', 'SHARES', 'ORD', 'ADR', 'ADS', 'SPONSORED',
]);

const CLASS = new Set(['CL', 'CLASS']);

export function normalizeIssuerName(name: string): string {
    const words = name
        .toUpperCase()
        // SEC's state markers: "BANK OF AMERICA CORP /DE/".
        .replace(/\/[A-Z]{2,3}\//g, ' ')
        .replace(/&/g, ' AND ')
        .replace(/[^A-Z0-9]+/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map((word) => ABBREVIATIONS[word] ?? word)
        .filter((word) => !NOISE.has(word));

    for (;;) {
        const last = words.length - 1;
        if (last >= 2 && CLASS.has(words[last - 1]) && words[last].length === 1) {
            words.length = last - 1;
        } else if (last >= 1 && TRAILING.has(words[last])) {
            words.length = last;
        } else {
            break;
        }
    }
    return words.join(' ');
}
