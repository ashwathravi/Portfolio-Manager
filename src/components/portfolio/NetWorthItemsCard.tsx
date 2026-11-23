"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { formatUsd } from "@/lib/format";
import {
    categoriesOf,
    describeNetWorthCounts,
    editedValueAsOf,
    formatAsOf,
    NET_WORTH_CATEGORY_LABELS,
    netWorthItemDistinctions,
    netWorthOf,
    signedNetWorthValue,
    summarizeNetWorthItems,
    type NetWorthCategory,
    type NetWorthItemRow,
    type NetWorthKind,
} from "@/lib/portfolio/net-worth";
import { localDate } from "@/lib/portfolio/value-dates";
import { NET_WORTH_ITEM_LIMITS } from "@/lib/validators/net-worth-item";

/**
 * Portfolio › Accounts › Other assets and debts: what the user owns and owes
 * outside their accounts (a home, a car, cash in the bank, a mortgage, a
 * loan), at the values and dates they give. Once there is one, the card
 * shows the net worth: the portfolio value plus these assets, less these
 * debts. So does Today's headline once the accounts hold positions; before
 * then Today shows the first-run steps. A debt is the balance owed, shown
 * with a minus sign and never in red: owing money isn't a loss.
 *
 * Changes go to /api/portfolio/net-worth-items, then the page reloads its
 * data. Each save also keeps the value as of its day; no chart reads those
 * yet. Update keeps the item's date until its value changes, so fixing a
 * name or note neither dates the value anew nor keeps another one.
 */

export interface NetWorthItemsCardProps {
    items: readonly NetWorthItemRow[];
    /** The portfolio value (the accounts' total), which the net worth starts from. */
    accountsTotal: number;
}

const HINTS: Record<NetWorthKind, string> = {
    asset: "Investment and retirement accounts belong in Accounts above, where they're priced and in your returns. Cash in a brokerage account is already counted there.",
    debt: "Enter what you owe now, not the original amount. It's taken off your net worth.",
};

/** "12,500.00" or "$12,500" → 12500; "" → null; anything else → NaN. */
function amount(text: string): number | null {
    const t = text.replace(/[$,\s]/g, "");
    return t === "" ? null : Number(t);
}

async function send(path: string, init: RequestInit): Promise<string | null> {
    try {
        const response = await fetch(path, {
            ...init,
            headers: init.body ? { "Content-Type": "application/json" } : undefined,
            credentials: "same-origin",
        });
        if (response.ok) return null;
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        return typeof body?.error === "string" ? body.error : "Something went wrong. Try again.";
    } catch {
        return "Couldn't reach Atlas. Nothing was saved.";
    }
}

interface NetWorthItemDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    kind: NetWorthKind;
    editing?: NetWorthItemRow;
}

function NetWorthItemDialog({ open, onOpenChange, kind, editing }: NetWorthItemDialogProps) {
    const router = useRouter();
    const ids = useId();
    const categories = categoriesOf(kind);
    const [category, setCategory] = useState<NetWorthCategory>(categories[0]);
    const [name, setName] = useState("");
    const [value, setValue] = useState("");
    // The date the user gave; until they give one, the default below.
    const [typedAsOf, setTypedAsOf] = useState<string | null>(null);
    const [note, setNote] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    // A new item's value is as of today. An edit keeps the item's date until
    // the value changes, then it's today, so the earlier value stays kept by
    // its own day and a new name or note dates nothing anew.
    const asOf = typedAsOf ?? (editing ? editedValueAsOf(editing, amount(value), localDate()) : localDate());

    useEffect(() => {
        if (!open) return;
        // Start from the item being edited, or blank, each time it opens.
        const first = editing?.category ?? categoriesOf(kind)[0];
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCategory(first);
        setName(editing?.name ?? NET_WORTH_CATEGORY_LABELS[first]);
        setValue(editing ? String(editing.value) : "");
        setTypedAsOf(null);
        setNote(editing?.note ?? "");
        setError(null);
    }, [open, editing, kind]);

    // The name is the type's label until the user types their own.
    const changeCategory = (next: NetWorthCategory) => {
        if (name.trim() === "" || name === NET_WORTH_CATEGORY_LABELS[category]) setName(NET_WORTH_CATEGORY_LABELS[next]);
        setCategory(next);
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const v = amount(value);
        if (!name.trim()) return setError("Name the asset or debt");
        if (v == null || !Number.isFinite(v) || v < 0) {
            return setError(kind === "asset" ? "Enter what it's worth, in dollars" : "Enter the balance owed, in dollars");
        }
        if (!asOf) return setError("Enter the date of the value");

        setSaving(true);
        const message = await send(editing ? `/api/portfolio/net-worth-items/${editing.id}` : "/api/portfolio/net-worth-items", {
            method: editing ? "PUT" : "POST",
            body: JSON.stringify({ kind, category, name: name.trim(), value: v, valueAsOf: asOf, note: note.trim() || null }),
        });
        setSaving(false);
        if (message) return setError(message);
        toast.success(editing ? `${name.trim()} updated.` : `${name.trim()} added.`);
        onOpenChange(false);
        router.refresh();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <form onSubmit={submit}>
                    <DialogHeader>
                        <DialogTitle>{editing ? `Update ${editing.name}` : kind === "asset" ? "Add an asset" : "Add a debt"}</DialogTitle>
                        <DialogDescription>{HINTS[kind]}</DialogDescription>
                    </DialogHeader>
                    <div className="pm-card-stack" style={{ padding: "16px 0" }}>
                        <label className="pm-exec-field" htmlFor={`${ids}-type`}>
                            <span className="pm-exec-field-label">Type</span>
                            <select
                                id={`${ids}-type`}
                                className="pm-exec-input"
                                value={category}
                                onChange={(e) => changeCategory(e.target.value as NetWorthCategory)}
                            >
                                {categories.map((c) => <option key={c} value={c}>{NET_WORTH_CATEGORY_LABELS[c]}</option>)}
                            </select>
                        </label>
                        <label className="pm-exec-field" htmlFor={`${ids}-name`}>
                            <span className="pm-exec-field-label">Name</span>
                            <Input
                                id={`${ids}-name`}
                                value={name}
                                maxLength={NET_WORTH_ITEM_LIMITS.name}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </label>
                        <div className="pm-form-pair">
                            <label className="pm-exec-field" htmlFor={`${ids}-value`}>
                                <span className="pm-exec-field-label">{kind === "asset" ? "Value ($)" : "Balance owed ($)"}</span>
                                <Input id={`${ids}-value`} value={value} inputMode="decimal" onChange={(e) => setValue(e.target.value)} autoFocus />
                            </label>
                            <label className="pm-exec-field" htmlFor={`${ids}-asof`}>
                                <span className="pm-exec-field-label">As of</span>
                                <input id={`${ids}-asof`} type="date" className="pm-exec-input" value={asOf} onChange={(e) => setTypedAsOf(e.target.value)} />
                            </label>
                        </div>
                        <label className="pm-exec-field" htmlFor={`${ids}-note`}>
                            <span className="pm-exec-field-label">Note (optional)</span>
                            <Input id={`${ids}-note`} value={note} maxLength={NET_WORTH_ITEM_LIMITS.note} onChange={(e) => setNote(e.target.value)} />
                        </label>
                        {error && <p className="pm-form-error" role="alert" data-testid="net-worth-item-error">{error}</p>}
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button type="submit" disabled={saving}>{editing ? "Save" : kind === "asset" ? "Add asset" : "Add debt"}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

interface NetWorthItemActionsProps {
    item: NetWorthItemRow;
    /**
     * What tells it apart from items of the same name (netWorthItemDistinctions):
     * its value, "−$1,000.00"; null when no other item has its name.
     */
    apart: string | null;
}

function NetWorthItemActions({ item, apart }: NetWorthItemActionsProps) {
    const router = useRouter();
    const [editOpen, setEditOpen] = useState(false);
    // Two cards left named "Credit card" get a button each that says which,
    // and the prompt says which balance goes.
    const label = apart ? `${item.name} (${apart})` : item.name;
    const remove = async () => {
        if (!window.confirm(`Delete ${label}? It stops counting in your net worth.`)) return;
        const message = await send(`/api/portfolio/net-worth-items/${item.id}`, { method: "DELETE" });
        if (message) return void toast.error(message);
        toast.success(`${label} deleted.`);
        router.refresh();
    };
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger className="pm-icon-btn" aria-label={`Actions for ${label}`}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                        <Pencil size={14} aria-hidden="true" />
                        Update
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void remove()} className="pm-menu-danger">
                        <Trash2 size={14} aria-hidden="true" />
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <NetWorthItemDialog open={editOpen} onOpenChange={setEditOpen} kind={item.kind} editing={item} />
        </>
    );
}

export function NetWorthItemsCard({ items, accountsTotal }: NetWorthItemsCardProps) {
    const [addOpen, setAddOpen] = useState(false);
    const [addKind, setAddKind] = useState<NetWorthKind>("asset");
    const add = (kind: NetWorthKind) => {
        setAddKind(kind);
        setAddOpen(true);
    };
    const summary = summarizeNetWorthItems(items);
    const apart = netWorthItemDistinctions(items);
    return (
        <section className="pm-card pm-card-stack" id="other-assets" data-testid="net-worth-items" aria-labelledby="net-worth-items-title">
            <div className="pm-card-header flex-wrap">
                <div>
                    <h2 id="net-worth-items-title" className="pm-card-title">Other assets and debts</h2>
                    <p className="pm-card-subtitle">
                        {describeNetWorthCounts(summary)
                            ?? "What you own and owe outside your accounts, such as a home, a car, cash in the bank, a mortgage or a loan, at the values you give. Add one to see your net worth here, and on Today once your accounts hold positions."}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" className="pm-btn pm-btn-ghost" onClick={() => add("asset")}>
                        <Plus size={14} aria-hidden="true" />
                        <span>Add asset</span>
                    </button>
                    <button type="button" className="pm-btn pm-btn-ghost" onClick={() => add("debt")}>
                        <Plus size={14} aria-hidden="true" />
                        <span>Add debt</span>
                    </button>
                </div>
            </div>
            {items.length > 0 && (
                <>
                    <dl className="pm-metric-strip" data-testid="net-worth-summary">
                        <div><dt>Portfolio value</dt><dd>{formatUsd(accountsTotal)}</dd></div>
                        <div><dt>Other assets</dt><dd>{formatUsd(summary.otherAssets)}</dd></div>
                        <div><dt>Debts</dt><dd>{formatUsd(-summary.debts)}</dd></div>
                        <div><dt>Net worth</dt><dd>{formatUsd(netWorthOf(accountsTotal, summary))}</dd></div>
                    </dl>
                    <div className="pm-table-scroll">
                        <table className="pm-table-full" data-testid="net-worth-items-table">
                            <thead>
                                <tr>
                                    <th scope="col">Item</th>
                                    <th scope="col">Type</th>
                                    <th scope="col" className="num">Value</th>
                                    <th scope="col">As of</th>
                                    <th scope="col" aria-label="Actions" />
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item) => (
                                    <tr key={item.id}>
                                        <td>
                                            <div>{item.name}</div>
                                            {item.note && <div className="pm-card-subtitle">{item.note}</div>}
                                        </td>
                                        <td>{NET_WORTH_CATEGORY_LABELS[item.category]}</td>
                                        <td className="num">{formatUsd(signedNetWorthValue(item))}</td>
                                        <td>{formatAsOf(item.valueAsOf)}</td>
                                        <td><NetWorthItemActions item={item} apart={apart.get(item.id) ?? null} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
            <NetWorthItemDialog open={addOpen} onOpenChange={setAddOpen} kind={addKind} />
        </section>
    );
}
