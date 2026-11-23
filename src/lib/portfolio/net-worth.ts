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
 *
 * What the pages say about them is worked out here too: Today's headline
 * and its note (todayHeadline), the card's count of them
 * (describeNetWorthCounts) and the date an edit's value is as of
 * (editedValueAsOf).
 */

import { formatShortDate } from "@/lib/format";

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

/**
 * The other assets and debts as a page reads them
 * (readNetWorthItemsForPage): the user's items, "unavailable" when they
 * couldn't be read, or null without a database to keep them in.
 */
export type NetWorthItemsRead = readonly NetWorthItemRow[] | "unavailable" | null;

/**
 * What Today's hero is given of them (TodayHeroProps.outside): their totals
 * once there is at least one, "unavailable" when they couldn't be read, and
 * null with none (or no database), so the hero leads with the portfolio
 * value.
 */
export function outsideForToday(read: NetWorthItemsRead): NetWorthSummary | "unavailable" | null {
    if (read === null || read === "unavailable") return read;
    return read.length > 0 ? summarizeNetWorthItems(read) : null;
}

/** "Nov 1, 2026" for a YYYY-MM-DD day: noon UTC, so the same day on the server and in every browser. */
export function formatAsOf(date: string): string {
    return formatShortDate(`${date}T12:00:00Z`);
}

/** What Today's hero leads with (todayHeadline). */
export interface TodayHeadline {
    /** The hero's label, and its region's name. */
    label: "Net worth" | "Portfolio value";
    /**
     * Once there are other assets or debts: the net worth that leads, their
     * totals for the facts under it, and how old their values are for the
     * note ("as of Nov 1, 2026", or "the oldest as of Oct 15, 2026" when
     * their dates differ). Null while the portfolio value leads.
     */
    netWorth: { value: number; items: NetWorthSummary; asOf: string } | null;
    /** The line saying the portfolio value leads alone because they couldn't be read; null otherwise. */
    unavailable: string | null;
}

/**
 * Today's headline: the net worth once the user has other assets or debts
 * (`outside`, from outsideForToday), else the portfolio value. When they
 * couldn't be read it is the portfolio value, labelled as such, with a line
 * saying so: never a net worth that silently leaves them out.
 */
export function todayHeadline(portfolioValue: number, outside: NetWorthSummary | "unavailable" | null): TodayHeadline {
    if (outside === "unavailable") {
        return {
            label: "Portfolio value",
            netWorth: null,
            unavailable: "Other assets and debts couldn't be loaded, so this is your portfolio value alone.",
        };
    }
    // Every item has a date, so totals without one are totals of none.
    if (outside === null || outside.oldestAsOf === null) return { label: "Portfolio value", netWorth: null, unavailable: null };
    const oldest = formatAsOf(outside.oldestAsOf);
    return {
        label: "Net worth",
        netWorth: {
            value: netWorthOf(portfolioValue, outside),
            items: outside,
            asOf: outside.newestAsOf === outside.oldestAsOf ? `as of ${oldest}` : `the oldest as of ${oldest}`,
        },
        unavailable: null,
    };
}

/**
 * The Accounts card's line under its title once there are items: "2 assets
 * and 1 debt, at the values and dates you gave", a zero count left out.
 * Null with none, when the card says what it's for instead.
 */
export function describeNetWorthCounts({ assetCount, debtCount }: Pick<NetWorthSummary, "assetCount" | "debtCount">): string | null {
    const counts = [
        assetCount > 0 ? `${assetCount} ${assetCount === 1 ? "asset" : "assets"}` : null,
        debtCount > 0 ? `${debtCount} ${debtCount === 1 ? "debt" : "debts"}` : null,
    ].filter((c) => c !== null);
    if (counts.length === 0) return null;
    return `${counts.join(" and ")}, ${assetCount + debtCount === 1 ? "at the value and date you gave" : "at the values and dates you gave"}`;
}

/**
 * The day an edited item's value is as of until the user gives one, by the
 * rule holdings valued by hand share (value-dates.ts).
 */
export { editedValueAsOf } from "./value-dates";
