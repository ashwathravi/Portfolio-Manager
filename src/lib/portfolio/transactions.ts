/**
 * Transactions as the user records them (launch item i40): typed by what
 * happened, valued in the account's currency, with fees kept apart. A
 * record of activity: adding one doesn't change holdings or cash, which
 * come from the account's own snapshot (decision D5).
 */

export const TRANSACTION_TYPES = ['BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'DEPOSIT', 'WITHDRAWAL', 'FEE'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** Trades: a symbol, a quantity and a price. */
export const TRADE_TYPES: ReadonlySet<TransactionType> = new Set(['BUY', 'SELL']);
/** Types about one security. */
export const SYMBOL_TYPES: ReadonlySet<TransactionType> = new Set(['BUY', 'SELL', 'DIVIDEND']);

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
    BUY: 'Buy',
    SELL: 'Sell',
    DIVIDEND: 'Dividend',
    INTEREST: 'Interest',
    DEPOSIT: 'Deposit',
    WITHDRAWAL: 'Withdrawal',
    FEE: 'Fee',
};

export interface TransactionInput {
    type: TransactionType;
    /** YYYY-MM-DD, the trade date. */
    date: string;
    symbol?: string | null;
    quantity?: number | null;
    price?: number | null;
    /** The cash value; for a trade, quantity × price when not given. */
    amount?: number | null;
    fees?: number | null;
    currency?: string;
    notes?: string | null;
}

/** The transaction's cash value: given, or quantity × price for a trade. Always positive. */
export function transactionAmount(input: Pick<TransactionInput, 'type' | 'quantity' | 'price' | 'amount'>): number {
    if (input.amount != null) return Math.round(Math.abs(input.amount) * 100) / 100;
    if (TRADE_TYPES.has(input.type) && input.quantity != null && input.price != null) {
        return Math.round(Math.abs(input.quantity * input.price) * 100) / 100;
    }
    return 0;
}

/**
 * When the trade happened, as stored: noon UTC on its date, so it reads as
 * that date in every timezone the app shows it in.
 */
export function transactionTimestamp(date: string): Date {
    return new Date(`${date}T12:00:00.000Z`);
}

/**
 * An ID for a row that came without one: its contents, plus how many
 * identical rows came before it in the same file, so two real, identical
 * trades on one day both count, and importing the file again adds neither.
 */
export function contentExternalId(
    row: Pick<TransactionInput, 'type' | 'date' | 'symbol' | 'quantity' | 'price' | 'amount' | 'fees'>,
    occurrence: number,
): string {
    const parts = [row.date, row.type, row.symbol ?? '', row.quantity ?? '', row.price ?? '', row.amount ?? '', row.fees ?? ''];
    return `content:${parts.join('|')}#${occurrence}`;
}
