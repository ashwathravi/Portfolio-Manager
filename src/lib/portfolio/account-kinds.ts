/**
 * What kind of account a portfolio is, where it's held, how it's taxed,
 * and whose name it's in. Optional on every account: one added before
 * these existed, or by hand without them, has none, and nothing is guessed
 * for it. A linked account takes its kind from Plaid's subtype and its
 * institution from the connection; only the user sets its ownership.
 */

export const ACCOUNT_TYPES = [
    'brokerage',
    '401k',
    '403b',
    'traditional_ira',
    'roth_ira',
    'sep_ira',
    'pension',
    '529',
    'hsa',
    'equity_comp',
    'crypto',
    'other',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const TAX_TREATMENTS = ['taxable', 'tax_deferred', 'tax_free'] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

/**
 * Whose name an account is in. "individual" is one person's (the user's,
 * or a partner's own IRA); "dependent" is held for someone else, such as a
 * custodial UGMA/UTMA account, a child's 529 or a trust for a beneficiary.
 */
export const OWNERSHIPS = ['individual', 'joint', 'dependent', 'business'] as const;
export type Ownership = (typeof OWNERSHIPS)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
    brokerage: 'Brokerage',
    '401k': '401(k)',
    '403b': '403(b)',
    traditional_ira: 'Traditional IRA',
    roth_ira: 'Roth IRA',
    sep_ira: 'SEP IRA',
    pension: 'Pension',
    '529': '529 plan',
    hsa: 'HSA',
    equity_comp: 'Equity compensation',
    crypto: 'Crypto',
    other: 'Other',
};

export const TAX_TREATMENT_LABELS: Record<TaxTreatment, string> = {
    taxable: 'Taxable',
    tax_deferred: 'Tax-deferred',
    tax_free: 'Tax-free',
};

export const OWNERSHIP_LABELS: Record<Ownership, string> = {
    individual: 'Individual',
    joint: 'Joint',
    dependent: 'For a dependent',
    business: 'Business',
};

export function isTaxTreatment(value: string | null | undefined): value is TaxTreatment {
    return (TAX_TREATMENTS as readonly string[]).includes(value ?? '');
}

export function isOwnership(value: string | null | undefined): value is Ownership {
    return (OWNERSHIPS as readonly string[]).includes(value ?? '');
}

/**
 * How an account of each kind is usually taxed: what the account form
 * suggests when the kind is picked, for the user to keep or change before
 * saving, and what a linked account is given for its Plaid subtype
 * (taxTreatmentForPlaid) until the user changes its kind or ownership. A
 * 401(k) or 403(b) can hold Roth money, and "other" can be anything, so
 * these are a starting point the user can change.
 */
export const DEFAULT_TAX_TREATMENT: Record<AccountType, TaxTreatment | null> = {
    brokerage: 'taxable',
    '401k': 'tax_deferred',
    '403b': 'tax_deferred',
    traditional_ira: 'tax_deferred',
    roth_ira: 'tax_free',
    sep_ira: 'tax_deferred',
    pension: 'tax_deferred',
    '529': 'tax_free',
    hsa: 'tax_free',
    equity_comp: 'taxable',
    crypto: 'taxable',
    other: null,
};

/**
 * Whose name an account of each kind is usually in: what the account form
 * suggests when the kind is picked, never stored without the user seeing
 * it. Retirement accounts, HSAs and equity compensation can only be one
 * person's, and a 529 is usually saved for a child; a brokerage, crypto or
 * "other" account can be anyone's, so those suggest none.
 */
export const DEFAULT_OWNERSHIP: Record<AccountType, Ownership | null> = {
    brokerage: null,
    '401k': 'individual',
    '403b': 'individual',
    traditional_ira: 'individual',
    roth_ira: 'individual',
    sep_ira: 'individual',
    pension: 'individual',
    '529': 'dependent',
    hsa: 'individual',
    equity_comp: 'individual',
    crypto: null,
    other: null,
};

export const INSTITUTION_MAX_LENGTH = 80;

/**
 * Plaid's investment subtypes as Atlas's kinds; null for one Atlas has no
 * kind for (the account then has none until the user picks one).
 * https://plaid.com/docs/api/accounts/#account-type-schema
 */
const PLAID_SUBTYPES: Readonly<Record<string, AccountType>> = {
    'brokerage': 'brokerage',
    'non-taxable brokerage account': 'brokerage',
    'cash management': 'brokerage',
    'trust': 'brokerage',
    'ugma': 'brokerage',
    'utma': 'brokerage',
    'mutual fund': 'brokerage',
    '401k': '401k',
    'roth 401k': '401k',
    '401a': '401k',
    '403b': '403b',
    '457b': '403b',
    'ira': 'traditional_ira',
    'rollover': 'traditional_ira',
    'sarsep': 'sep_ira',
    'sep ira': 'sep_ira',
    'simple ira': 'sep_ira',
    'roth': 'roth_ira',
    'pension': 'pension',
    'retirement': 'pension',
    'profit sharing plan': 'pension',
    'keogh': 'pension',
    '529': '529',
    'education savings account': '529',
    'hsa': 'hsa',
    'health reimbursement arrangement': 'hsa',
    'stock plan': 'equity_comp',
    'crypto exchange': 'crypto',
    'non-custodial wallet': 'crypto',
};

/** Plaid subtypes taxed differently from their kind's default. */
const PLAID_TAX_TREATMENT: Readonly<Record<string, TaxTreatment>> = {
    'roth 401k': 'tax_free',
    'non-taxable brokerage account': 'tax_free',
};

/**
 * The map's own entry for `key`, or null. Plaid's subtype comes straight
 * from Link (normalizeSubtype in src/lib/plaid/link.ts), so a key such as
 * "constructor" or "__proto__" must not reach Object.prototype.
 */
function own<T>(map: Readonly<Record<string, T>>, key: string): T | null {
    return Object.hasOwn(map, key) ? map[key] : null;
}

export function accountTypeForPlaid(subtype: string | null | undefined): AccountType | null {
    return own(PLAID_SUBTYPES, (subtype ?? '').trim().toLowerCase());
}

export function taxTreatmentForPlaid(subtype: string | null | undefined): TaxTreatment | null {
    const key = (subtype ?? '').trim().toLowerCase();
    const type = accountTypeForPlaid(key);
    return own(PLAID_TAX_TREATMENT, key) ?? (type ? DEFAULT_TAX_TREATMENT[type] : null);
}

/** "Roth IRA · Fidelity · Individual", "Fidelity", "Joint"; null with none of them. */
export function accountKindLine(account: { accountType?: string | null; institution?: string | null; ownership?: string | null }): string | null {
    const type = account.accountType && (ACCOUNT_TYPES as readonly string[]).includes(account.accountType)
        ? ACCOUNT_TYPE_LABELS[account.accountType as AccountType]
        : null;
    const ownership = isOwnership(account.ownership) ? OWNERSHIP_LABELS[account.ownership] : null;
    const parts = [type, account.institution?.trim() || null, ownership].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
}
