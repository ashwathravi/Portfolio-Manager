/**
 * How many of each kind of record one user keeps (launch item i77), so that
 * once sign-up is open no account can fill the database. Only live records
 * count: a watchlist item, journal entry or thesis the user removed is kept
 * as a dismissed row with its text cleared (so a late save can't bring it
 * back) and doesn't. Editing or removing a record is never refused, even
 * past a limit; only a write that adds one is.
 *
 * Transactions count across all the user's accounts. Those a linked
 * account syncs count too but are never refused: Plaid brings only what the
 * user's own institutions report, at most 10 of them (MAX_PLAID_CONNECTIONS_PER_USER).
 *
 * Other assets and debts (net_worth_items) have no dismissed rows: a deleted
 * one is gone, so every row counts.
 *
 * Holdings valued by hand (manual_holdings) count across the user's
 * accounts, those a linked account syncs included; like transactions, a
 * sync is never refused. The card's add and an import that brings them in
 * from a positions file are.
 *
 * The checks run on the server (records-server.ts); this file is shared with
 * the pages, which say why a save was refused.
 */

export const RECORD_LIMITS = {
    watchlist: 500,
    journal: 2_000,
    theses: 200,
    transactions: 50_000,
    manualHoldings: 1_000,
    netWorthItems: 100,
} as const;

export type RecordKind = keyof typeof RECORD_LIMITS;

const COUNT = new Intl.NumberFormat("en-US");

const DETAILS: Record<RecordKind, { code: string; message: (limit: string) => string }> = {
    watchlist: {
        code: "WATCHLIST_LIMIT",
        message: (limit) => `Your watchlist holds at most ${limit} tickers. Remove one to add another.`,
    },
    journal: {
        code: "JOURNAL_LIMIT",
        message: (limit) => `Your journal holds at most ${limit} entries. Delete one to add another.`,
    },
    theses: {
        code: "THESIS_LIMIT",
        message: (limit) => `You can keep at most ${limit} theses. Delete one to add another.`,
    },
    transactions: {
        code: "TRANSACTION_LIMIT",
        message: (limit) => `Your accounts hold at most ${limit} transactions. Delete some to add more; nothing was added.`,
    },
    manualHoldings: {
        code: "MANUAL_HOLDING_LIMIT",
        message: (limit) => `You can keep at most ${limit} holdings valued by hand. Delete some to add more; nothing was added.`,
    },
    netWorthItems: {
        code: "NET_WORTH_ITEM_LIMIT",
        message: (limit) => `You can keep at most ${limit} assets and debts. Delete one to add another.`,
    },
};

/** The API error code a route answers with (HTTP 409) when `kind`'s limit refuses a write. */
export function recordLimitCode(kind: RecordKind): string {
    return DETAILS[kind].code;
}

/** What the user is told when `kind`'s limit refuses a write. */
export function recordLimitMessage(kind: RecordKind): string {
    return DETAILS[kind].message(COUNT.format(RECORD_LIMITS[kind]));
}

/**
 * What to tell the user when a save failed because of `kind`'s limit: the
 * API's error code says so (AccountRequestError's `code`). Null when it
 * failed for another reason.
 */
export function recordLimitMessageFor(kind: RecordKind, error: unknown): string | null {
    const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
    return code === recordLimitCode(kind) ? recordLimitMessage(kind) : null;
}

/** The kinds a browser kept before they moved to the account (launch item i38). */
export type BrowserRecordKind = Extract<RecordKind, "watchlist" | "journal" | "theses">;

const BROWSER_RECORDS: Record<BrowserRecordKind, { what: string; cap: (limit: string) => string }> = {
    watchlist: { what: "tickers", cap: (limit) => `your watchlist holds at most ${limit}` },
    journal: { what: "journal entries", cap: (limit) => `your journal holds at most ${limit}` },
    theses: { what: "theses", cap: (limit) => `you can keep at most ${limit}` },
};

/**
 * What to tell the user when the one-time move of what this browser kept
 * (launch item i38) was refused by `kind`'s limit, or null when it failed for
 * another reason. The browser keeps its copy until the account takes it, and
 * the move is tried again on a later visit, so nothing is lost.
 */
export function browserImportLimitMessageFor(kind: BrowserRecordKind, error: unknown): string | null {
    if (recordLimitMessageFor(kind, error) === null) return null;
    const { what, cap } = BROWSER_RECORDS[kind];
    return `Some ${what} saved in this browser weren't added to your account: ${cap(COUNT.format(RECORD_LIMITS[kind]))}. `
        + "They stay in this browser and move over on a later visit once there's room.";
}

/** Thrown inside a write's transaction, which it rolls back, when the write would take the user past `kind`'s limit. */
export class RecordLimitError extends Error {
    constructor(readonly kind: RecordKind) {
        super(recordLimitMessage(kind));
        this.name = "RecordLimitError";
    }
}
