/**
 * Net worth: the portfolio value (what the accounts hold) plus what the
 * user owns outside their accounts, less what they owe. The assets and
 * debts are entered by hand on Portfolio › Accounts (net_worth_items in
 * schema.ts), each with a value as of a day; for a debt, the balance owed,
 * never negative, which is taken off. Browser-safe: the Accounts card,
 * Today's hero and the validator share it.
 *
 * Each value saved is also kept by day (net_worth_item_values). A saved
 * value stands from its as-of date on, so saving one removes the item's
 * values dated after it (net-worth-items.ts writes them).
 *
 * The nightly valuations, returns, the equity curve and the risk policy
 * never read these items: they measure the accounts, at market prices.
 */

export const NET_WORTH_KINDS = ["asset", "debt"] as const;
export type NetWorthKind = (typeof NET_WORTH_KINDS)[number];

/**
 * No "retirement account" or "brokerage" category: those belong in Accounts,
 * where they're priced and in the returns, and listing them here too would
 * count them twice.
 */
export const ASSET_CATEGORIES = ["property", "vehicle", "bank_cash", "valuables", "owed_to_you", "other_asset"] as const;
export const DEBT_CATEGORIES = ["mortgage", "auto_loan", "credit_card", "student_loan", "other_debt"] as const;

/** Every category, assets first: the order the forms list them in. */
export const NET_WORTH_CATEGORIES = [...ASSET_CATEGORIES, ...DEBT_CATEGORIES] as const;
export type NetWorthCategory = (typeof NET_WORTH_CATEGORIES)[number];

export const NET_WORTH_CATEGORY_LABELS: Record<NetWorthCategory, string> = {
    property: "Home or property",
    vehicle: "Vehicle",
    bank_cash: "Cash in the bank",
    valuables: "Valuables",
    owed_to_you: "Money owed to you",
    other_asset: "Other asset",
    mortgage: "Mortgage",
    auto_loan: "Auto loan",
    credit_card: "Credit card",
    student_loan: "Student loan",
    other_debt: "Other loan or debt",
};

const ASSET_SET: ReadonlySet<string> = new Set(ASSET_CATEGORIES);

/** The categories of one kind, in the form's order. */
export function categoriesOf(kind: NetWorthKind): readonly NetWorthCategory[] {
    return kind === "asset" ? ASSET_CATEGORIES : DEBT_CATEGORIES;
}

/** Which kind a category belongs to: each belongs to exactly one. */
export function kindOfCategory(category: NetWorthCategory): NetWorthKind {
    return ASSET_SET.has(category) ? "asset" : "debt";
}

/** One asset or debt as the pages show it. */
export interface NetWorthItemRow {
    id: string;
    kind: NetWorthKind;
    category: NetWorthCategory;
    name: string;
    /** What it's worth or, for a debt, what is owed; never negative. */
    value: number;
    /** The day the value is as of (YYYY-MM-DD). */
    valueAsOf: string;
    note: string | null;
    /** ISO timestamp of the last save. */
    updatedAt: string;
}

/** The items added up: what Today and the Accounts card show beside the accounts. */
export interface NetWorthSummary {
    otherAssets: number;
    /** What is owed, as a positive amount; it is taken off. */
    debts: number;
    assetCount: number;
    debtCount: number;
    /** The oldest and newest as-of dates among the items; null when there are none. */
    oldestAsOf: string | null;
    newestAsOf: string | null;
}

// In whole cents, so 0.1 + 0.2 is 0.3. Anything that isn't a number stays
// NaN, which the pages show as a dash rather than as a made-up total.
const cents = (value: number | string): number => Math.round(Number(value) * 100);

/**
 * Totals the assets and the debts apart, to the cent, from values as
 * numbers or as the database's numeric strings.
 */
export function summarizeNetWorthItems(
    items: readonly { kind: NetWorthKind; value: number | string; valueAsOf: string }[],
): NetWorthSummary {
    let assets = 0;
    let debts = 0;
    let assetCount = 0;
    let debtCount = 0;
    let oldestAsOf: string | null = null;
    let newestAsOf: string | null = null;
    for (const item of items) {
        if (item.kind === "debt") {
            debts += cents(item.value);
            debtCount++;
        } else {
            assets += cents(item.value);
            assetCount++;
        }
        if (oldestAsOf === null || item.valueAsOf < oldestAsOf) oldestAsOf = item.valueAsOf;
        if (newestAsOf === null || item.valueAsOf > newestAsOf) newestAsOf = item.valueAsOf;
    }
    return { otherAssets: assets / 100, debts: debts / 100, assetCount, debtCount, oldestAsOf, newestAsOf };
}

/**
 * The portfolio value plus the other assets, less the debts, to the cent.
 * Below zero when more is owed than owned, never clamped.
 */
export function netWorthOf(portfolioValue: number, summary: Pick<NetWorthSummary, "otherAssets" | "debts">): number {
    // + 0 turns a -0 into 0.
    return (cents(portfolioValue) + cents(summary.otherAssets) - cents(summary.debts)) / 100 + 0;
}
