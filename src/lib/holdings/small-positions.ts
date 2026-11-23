/**
 * Small positions on Holdings: positions worth very little, such as a
 * robo-advisor's fractional shares worth a few dollars each, are shown as
 * one row after the others that opens in place. This only changes how the
 * table is shown: every total on the page, the risk policy, Today, Ask and
 * the export still count each position.
 *
 * A position is small when it is worth under $500 and under 0.5% of the
 * table's market value, the total its Allocation column divides by, so a
 * filter never changes which positions are small. It must also read under
 * both as the table writes them (its value to the cent in the open group,
 * its share to a hundredth of a percent), so no grouped position reads as
 * the limit its group says it is under. They are grouped only when at
 * least three are, and never every position in view. Holdings valued by
 * hand (their own card) and option positions (the LEAPS ledger) are never
 * in the table, so never in the group.
 */

import { formatUsd } from "@/lib/format";

export interface SmallPositionsRule {
    /** A small position is worth under this many dollars… */
    maxValue: number;
    /** …and under this share of the table's market value (0.005 is 0.5%). */
    maxShare: number;
    /** The fewest small positions that make a group. */
    minCount: number;
}

export const SMALL_POSITIONS_RULE: Readonly<SmallPositionsRule> = Object.freeze({
    maxValue: 500,
    maxShare: 0.005,
    minCount: 3,
});

/** The open group writes its positions' values to the cent, which count when one is worth a few dollars. */
const SMALL_POSITION_VALUE_DECIMALS = 2;

/** A row of the Holdings table as the rule reads it: one account's position, or one symbol's (By symbol). */
export interface SmallPositionCandidate {
    accountId: string;
    account: string;
    /** By symbol: the names of the accounts holding it. */
    accounts?: readonly string[];
    /** By symbol: those accounts' IDs, in the same order as `accounts`. */
    accountIds?: readonly string[];
    /** At its price, or at cost without one. */
    marketValue: number;
    costBasis: number;
    /** Null when it has no price, so it's valued at cost. */
    last: number | null;
    /** By symbol: some of its shares, not all, have no price and are valued at cost. */
    partlyAtCost?: boolean;
    /** By symbol: what its shares with a price are worth… */
    pricedValue?: number;
    /** …and what they cost. */
    pricedCost?: number;
    /** Null when the row shows no return (no price, or nothing paid). */
    totalReturnPct: number | null;
    /** Today's move; null when there is none from today's session. */
    todayPct: number | null;
    todayChangeAbs: number;
    allocationPct: number;
}

export interface SmallPositionsGroup<T> {
    /** The small positions, in the order given. */
    rows: T[];
    marketValue: number;
    costBasis: number;
    allocationPct: number;
    todayChangeAbs: number;
    /** Today's move weighted by value, over the positions with one; null when none moved. */
    todayPct: number | null;
    /** Over the positions that show a return of their own; null when none does. */
    totalReturnPct: number | null;
    /** None of them has a price: all valued at cost. */
    atCost: boolean;
    /** Some of the value, not all, is at cost. */
    partlyAtCost: boolean;
    /** The accounts holding them, one per account ID, in name order. */
    accounts: Array<{ id: string; name: string }>;
    /** The dollar value each is under: the lower of the two limits. */
    limit: number;
    /** Which of the two limits that is. */
    limitedBy: "value" | "share";
}

/**
 * Splits the table's rows into those shown one by one and the small
 * positions' group, keeping the order given (the table's sort). The limit
 * comes from `marketValue`, the whole table's, never from the rows given,
 * which a filter may have narrowed. Rows come back as they are, whatever
 * the split, so nothing is lost or counted twice.
 */
export function splitSmallPositions<T extends SmallPositionCandidate>(
    rows: readonly T[],
    marketValue: number,
    rule: Readonly<SmallPositionsRule> = SMALL_POSITIONS_RULE,
): { shown: T[]; small: SmallPositionsGroup<T> | null } {
    const shareLimit = rule.maxShare * marketValue;
    const limit = Math.min(rule.maxValue, shareLimit);
    // An empty book, or a market value of 0, below 0 or not a number, has no limit.
    if (!(limit > 0)) return { shown: [...rows], small: null };
    // Strictly under the limit. A position worth $0 can be small; a short,
    // worth less than nothing, never is, and nor is a value that isn't a number.
    // It must also read under both limits as the table writes them, its
    // value to the cent in the open group and its share to a hundredth of a
    // percent: $499.996 reads $500.00 and 0.497% reads 0.50%, which would
    // sit under a line saying each is under $500, or under 0.5%.
    const isSmall = (row: T) =>
        row.marketValue >= 0
        && row.marketValue < limit
        && asWritten(row.marketValue, SMALL_POSITION_VALUE_DECIMALS) < rule.maxValue
        && asWritten(row.allocationPct, allocationDecimals(row.allocationPct)) < rule.maxShare * 100;
    const small = rows.filter(isSmall);
    if (small.length < rule.minCount || small.length === rows.length) return { shown: [...rows], small: null };
    return {
        shown: rows.filter((row) => !isSmall(row)),
        small: summarize(small, limit, shareLimit < rule.maxValue ? "share" : "value"),
    };
}

function summarize<T extends SmallPositionCandidate>(
    rows: T[],
    limit: number,
    limitedBy: "value" | "share",
): SmallPositionsGroup<T> {
    // A row with today's quote is worth quantity × that price, so its value
    // less today's change is what it was worth at the previous close. By
    // symbol, a row with a move has every account at that same quote.
    const moved = rows.filter((r) => r.todayPct !== null);
    const previousValue = sum(moved, (r) => r.marketValue - r.todayChangeAbs);
    const movedToday = sum(moved, (r) => r.todayChangeAbs);
    // What the open group shows: a position with no return of its own (no
    // price, or bought for nothing) is left out, and By symbol only the
    // shares with a price count.
    const returning = rows.filter((r) => r.totalReturnPct !== null);
    const value = sum(returning, (r) => r.pricedValue ?? r.marketValue);
    const cost = sum(returning, (r) => r.pricedCost ?? r.costBasis);
    const atCost = rows.every((r) => r.last === null);
    return {
        rows,
        marketValue: sum(rows, (r) => r.marketValue),
        costBasis: sum(rows, (r) => r.costBasis),
        allocationPct: sum(rows, (r) => r.allocationPct),
        todayChangeAbs: sum(rows, (r) => r.todayChangeAbs),
        todayPct: moved.length > 0 && previousValue > 0 ? (movedToday / previousValue) * 100 : null,
        totalReturnPct: returning.length > 0 && cost > 0 ? ((value - cost) / cost) * 100 : null,
        atCost,
        partlyAtCost: !atCost && rows.some((r) => r.last === null || r.partlyAtCost === true),
        accounts: accountsInNameOrder(rows),
        limit,
        limitedBy,
    };
}

/**
 * One entry per account ID, with the first name given for it, in name
 * order as combine.ts lists a symbol's accounts: two accounts with the
 * same name are two.
 */
function accountsInNameOrder(rows: readonly SmallPositionCandidate[]): Array<{ id: string; name: string }> {
    const names = new Map<string, string>();
    for (const row of rows) {
        const ids = row.accountIds ?? [row.accountId];
        const accountNames = row.accounts ?? [row.account];
        ids.forEach((id, i) => {
            if (!names.has(id)) names.set(id, accountNames[i] ?? row.account);
        });
    }
    return [...names]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-US", { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** The rule's limits as Holdings and the glossary write them: "$500", "0.5%" and "three". */
export function smallPositionsLimits(rule: Readonly<SmallPositionsRule> = SMALL_POSITIONS_RULE): {
    value: string;
    share: string;
    minCount: string;
} {
    return {
        value: formatUsd(rule.maxValue, { decimals: 0 }),
        share: `${(rule.maxShare * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`,
        minCount: COUNT_WORDS[rule.minCount] ?? String(rule.minCount),
    };
}

/** The line under the group's button: the limit that makes these positions small. */
export function smallPositionsLimitLabel(
    limitedBy: "value" | "share",
    rule: Readonly<SmallPositionsRule> = SMALL_POSITIONS_RULE,
): string {
    const limits = smallPositionsLimits(rule);
    return limitedBy === "value" ? `Each under ${limits.value}` : `Each under ${limits.share} of market value`;
}

/** A small position's value as the open group writes it, e.g. "$1.50" where other rows round to whole dollars. */
export function formatSmallPositionValue(value: number): string {
    return formatUsd(value, { decimals: SMALL_POSITION_VALUE_DECIMALS });
}

/**
 * A share of the table's market value (0..100) as its Allocation column
 * writes it: to a tenth of a percent, or a hundredth under 1%, so a small
 * position reads 0.47% rather than the 0.5% it is under.
 */
export function formatAllocationPct(pct: number): string {
    return `${pct.toFixed(allocationDecimals(pct))}%`;
}

function allocationDecimals(pct: number): number {
    return Math.abs(pct) < 1 ? 2 : 1;
}

/** What a figure reads to `decimals` places, rounded as the table rounds it. */
function asWritten(value: number, decimals: number): number {
    return Number(value.toFixed(decimals));
}

function sum<T>(rows: readonly T[], value: (row: T) => number): number {
    return rows.reduce((total, row) => total + value(row), 0);
}
