/**
 * What kind of account a portfolio is, where it's held, and how it's taxed.
 * Optional on every account: one added before these existed, or by hand
 * without them, has none, and nothing is guessed for it. A linked account
 * takes its kind from Plaid's subtype and its institution from the
 * connection.
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

/**
 * How an account of each kind is usually taxed: what the account form
 * suggests when the kind is picked, never stored without the user seeing
 * it. A 401(k) can hold Roth money, and "other" can be anything, so these
 * are a starting point the user can change.
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

export function accountTypeForPlaid(subtype: string | null | undefined): AccountType | null {
    return PLAID_SUBTYPES[(subtype ?? '').trim().toLowerCase()] ?? null;
}

export function taxTreatmentForPlaid(subtype: string | null | undefined): TaxTreatment | null {
    const key = (subtype ?? '').trim().toLowerCase();
    const type = accountTypeForPlaid(key);
    return PLAID_TAX_TREATMENT[key] ?? (type ? DEFAULT_TAX_TREATMENT[type] : null);
}

/** "Roth IRA · Fidelity", "Fidelity", "Brokerage"; null with neither. */
export function accountKindLine(account: { accountType?: string | null; institution?: string | null }): string | null {
    const type = account.accountType && (ACCOUNT_TYPES as readonly string[]).includes(account.accountType)
        ? ACCOUNT_TYPE_LABELS[account.accountType as AccountType]
        : null;
    const parts = [type, account.institution?.trim() || null].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
}
