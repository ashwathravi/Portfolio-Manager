/**
 * Portfolio › Accounts: the accounts' value by tax treatment and by
 * ownership. Each account counts whole in the group its own field puts it
 * in. Nothing is worked out from its type: an account whose field is empty,
 * or holds a value not on the list, counts under Not set. So each split
 * adds up to the page's total value (positions, holdings valued by hand and
 * cash, from the same rows as the table: buildAccountRows).
 */

import {
    isOwnership,
    isTaxTreatment,
    OWNERSHIP_LABELS,
    OWNERSHIPS,
    TAX_TREATMENT_LABELS,
    TAX_TREATMENTS,
    type Ownership,
    type TaxTreatment,
} from "./account-kinds";
import type { AccountRow } from "./accounts";

export const NOT_SET = "not_set";

export interface AccountGroup<K extends string> {
    key: K | typeof NOT_SET;
    label: string;
    /** The accounts in it, in the rows' order (value, largest first). */
    accountNames: string[];
    totalUsd: number;
    /** Its share of all the accounts' value, 0–100 to one decimal; null when that total isn't above zero. */
    sharePct: number | null;
}

export interface AccountGroups {
    byTaxTreatment: AccountGroup<TaxTreatment>[];
    byOwnership: AccountGroup<Ownership>[];
}

type GroupedRow = Pick<AccountRow, "name" | "totalUsd" | "taxTreatment" | "ownership">;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One split: a group for each listed value an account has, in the list's
 * order, then Not set; groups with no account are left out. None at all
 * while no account has a listed value.
 */
function split<K extends string>(
    rows: readonly GroupedRow[],
    keys: readonly K[],
    labels: Readonly<Record<K, string>>,
    keyOf: (row: GroupedRow) => K | null,
): AccountGroup<K>[] {
    const keyed = rows.map((row) => ({ row, key: keyOf(row) ?? NOT_SET }));
    if (keyed.every((entry) => entry.key === NOT_SET)) return [];
    const grand = round2(rows.reduce((sum, row) => sum + row.totalUsd, 0));
    const order: (K | typeof NOT_SET)[] = [...keys, NOT_SET];
    return order.flatMap((key): AccountGroup<K>[] => {
        const members = keyed.filter((entry) => entry.key === key).map((entry) => entry.row);
        if (members.length === 0) return [];
        const totalUsd = round2(members.reduce((sum, row) => sum + row.totalUsd, 0));
        return [{
            key,
            label: key === NOT_SET ? "Not set" : labels[key],
            accountNames: members.map((row) => row.name),
            totalUsd,
            // As buildAccountRows works out each account's share.
            sharePct: grand > 0 ? Math.round((totalUsd / grand) * 1000) / 10 : null,
        }];
    });
}

export function groupAccounts(rows: readonly GroupedRow[]): AccountGroups {
    return {
        byTaxTreatment: split(rows, TAX_TREATMENTS, TAX_TREATMENT_LABELS, (row) => (isTaxTreatment(row.taxTreatment) ? row.taxTreatment : null)),
        byOwnership: split(rows, OWNERSHIPS, OWNERSHIP_LABELS, (row) => (isOwnership(row.ownership) ? row.ownership : null)),
    };
}
