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
import { formatQty, formatShortDate, formatUsd } from "@/lib/format";
import { MANUAL_HOLDING_LIMITS } from "@/lib/validators/manual-holding";

/**
 * Holdings › Valued by hand: what an account holds that Atlas can't price
 * from market data (a 401(k) fund with no ticker, a 529 portfolio, a
 * private holding). Each counts at the value given, as of its date, in the
 * account's value, Today and the nightly history, until it's updated.
 */

export interface ManualHoldingRow {
    id: string;
    portfolioId: string;
    account: string;
    name: string;
    identifier: string | null;
    quantity: number | null;
    value: number;
    costBasis: number | null;
    valueAsOf: string;
    /** "plaid" when a linked account reports it; the next sync updates its value. */
    source: string;
}

interface AccountOption {
    id: string;
    name: string;
}

function today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

function ManualHoldingDialog({
    open,
    onOpenChange,
    accounts,
    editing,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    accounts: readonly AccountOption[];
    editing?: ManualHoldingRow;
}) {
    const router = useRouter();
    const ids = useId();
    const [account, setAccount] = useState("");
    const [name, setName] = useState("");
    const [identifier, setIdentifier] = useState("");
    const [quantity, setQuantity] = useState("");
    const [value, setValue] = useState("");
    const [cost, setCost] = useState("");
    const [asOf, setAsOf] = useState(today());
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        // Start from the holding being edited, or blank, each time it opens.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAccount(editing?.portfolioId ?? accounts[0]?.id ?? "");
        setName(editing?.name ?? "");
        setIdentifier(editing?.identifier ?? "");
        setQuantity(editing?.quantity != null ? String(editing.quantity) : "");
        setValue(editing ? String(editing.value) : "");
        setCost(editing?.costBasis != null ? String(editing.costBasis) : "");
        // An edit is usually a new value: as of today unless changed.
        setAsOf(today());
        setError(null);
    }, [open, editing, accounts]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const v = amount(value);
        const c = amount(cost);
        const q = amount(quantity);
        if (!name.trim()) return setError("Name the holding.");
        if (v == null || !Number.isFinite(v) || v < 0) return setError("Enter its value, such as 12500 or 12,500.00.");
        if (c != null && (!Number.isFinite(c) || c < 0)) return setError("Cost must be a number, or left empty.");
        if (q != null && (!Number.isFinite(q) || q <= 0)) return setError("Units must be more than 0, or left empty.");

        setSaving(true);
        const message = await send(editing ? `/api/portfolio/manual-holdings/${editing.id}` : "/api/portfolio/manual-holdings", {
            method: editing ? "PUT" : "POST",
            body: JSON.stringify({
                portfolioId: account,
                holding: {
                    name: name.trim(),
                    identifier: identifier.trim() || null,
                    quantity: q,
                    value: v,
                    costBasis: c,
                    valueAsOf: asOf,
                },
            }),
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
                        <DialogTitle>{editing ? "Update holding" : "Add a holding valued by hand"}</DialogTitle>
                        <DialogDescription>
                            For what Atlas can&apos;t price, such as a 401(k) fund with no ticker or a private holding.
                            It counts at this value until you update it.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="pm-card-stack" style={{ padding: "16px 0" }}>
                        <label className="pm-exec-field" htmlFor={`${ids}-account`}>
                            <span className="pm-exec-field-label">Account</span>
                            <select id={`${ids}-account`} className="pm-exec-input" value={account} onChange={(e) => setAccount(e.target.value)}>
                                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                        </label>
                        <label className="pm-exec-field" htmlFor={`${ids}-name`}>
                            <span className="pm-exec-field-label">Holding</span>
                            <Input
                                id={`${ids}-name`}
                                value={name}
                                maxLength={MANUAL_HOLDING_LIMITS.name}
                                placeholder="e.g. Target 2055 Trust, Acme Corp shares"
                                onChange={(e) => setName(e.target.value)}
                                autoFocus
                            />
                        </label>
                        <div className="pm-form-pair">
                            <label className="pm-exec-field" htmlFor={`${ids}-value`}>
                                <span className="pm-exec-field-label">Value ($)</span>
                                <Input id={`${ids}-value`} value={value} inputMode="decimal" onChange={(e) => setValue(e.target.value)} />
                            </label>
                            <label className="pm-exec-field" htmlFor={`${ids}-asof`}>
                                <span className="pm-exec-field-label">As of</span>
                                <input id={`${ids}-asof`} type="date" className="pm-exec-input" value={asOf} required onChange={(e) => setAsOf(e.target.value)} />
                            </label>
                        </div>
                        <div className="pm-form-pair">
                            <label className="pm-exec-field" htmlFor={`${ids}-cost`}>
                                <span className="pm-exec-field-label">Cost ($, optional)</span>
                                <Input id={`${ids}-cost`} value={cost} inputMode="decimal" onChange={(e) => setCost(e.target.value)} />
                            </label>
                            <label className="pm-exec-field" htmlFor={`${ids}-units`}>
                                <span className="pm-exec-field-label">Units (optional)</span>
                                <Input id={`${ids}-units`} value={quantity} inputMode="decimal" onChange={(e) => setQuantity(e.target.value)} />
                            </label>
                        </div>
                        <label className="pm-exec-field" htmlFor={`${ids}-identifier`}>
                            <span className="pm-exec-field-label">CUSIP or plan code (optional)</span>
                            <Input
                                id={`${ids}-identifier`}
                                value={identifier}
                                maxLength={MANUAL_HOLDING_LIMITS.identifier}
                                onChange={(e) => setIdentifier(e.target.value)}
                            />
                        </label>
                        {error && <p className="pm-form-error" role="alert" data-testid="manual-holding-error">{error}</p>}
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button type="submit" disabled={saving || !account}>{editing ? "Save" : "Add holding"}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function RowActions({ row, accounts }: { row: ManualHoldingRow; accounts: readonly AccountOption[] }) {
    const router = useRouter();
    const [editOpen, setEditOpen] = useState(false);
    const remove = async () => {
        if (!window.confirm(`Delete ${row.name}? Its value stops counting in ${row.account}.`)) return;
        const message = await send(`/api/portfolio/manual-holdings/${row.id}`, { method: "DELETE" });
        if (message) return void toast.error(message);
        toast.success(`${row.name} deleted.`);
        router.refresh();
    };
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger className="pm-icon-btn" aria-label={`Actions for ${row.name}`}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                        <Pencil size={14} aria-hidden="true" />
                        Update value
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void remove()} className="pm-menu-danger">
                        <Trash2 size={14} aria-hidden="true" />
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <ManualHoldingDialog open={editOpen} onOpenChange={setEditOpen} accounts={accounts} editing={row} />
        </>
    );
}

export function ManualHoldingsCard({ rows, accounts }: { rows: readonly ManualHoldingRow[]; accounts: readonly AccountOption[] }) {
    const [addOpen, setAddOpen] = useState(false);
    if (accounts.length === 0) return null;
    const total = rows.reduce((sum, r) => sum + r.value, 0);
    return (
        <section className="pm-card" data-testid="manual-holdings" aria-labelledby="manual-holdings-title">
            <div className="pm-card-header">
                <div>
                    <h2 id="manual-holdings-title" className="pm-card-title">Valued by hand</h2>
                    <p className="pm-card-subtitle">
                        {rows.length === 0
                            ? "Holdings Atlas can't price, such as a 401(k) fund with no ticker or a private company, at the value you give."
                            : `${rows.length} ${rows.length === 1 ? "holding" : "holdings"} · ${formatUsd(total)}, counted at the value as of its date`}
                    </p>
                </div>
                <button type="button" className="pm-btn pm-btn-ghost" onClick={() => setAddOpen(true)}>
                    <Plus size={14} aria-hidden="true" />
                    <span>Add holding</span>
                </button>
            </div>
            {rows.length > 0 && (
                <div className="pm-table-scroll">
                    <table className="pm-table-full" data-testid="manual-holdings-table">
                        <thead>
                            <tr>
                                <th scope="col">Holding</th>
                                <th scope="col">Account</th>
                                <th scope="col" className="num">Units</th>
                                <th scope="col" className="num">Value</th>
                                <th scope="col" className="num">Cost</th>
                                <th scope="col">As of</th>
                                <th scope="col" aria-label="Actions" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id}>
                                    <td>
                                        <div>{r.name}</div>
                                        {(r.identifier || r.source === "plaid") && (
                                            <div className="pm-card-subtitle">
                                                {[r.identifier, r.source === "plaid" ? "from your linked account" : null].filter(Boolean).join(" · ")}
                                            </div>
                                        )}
                                    </td>
                                    <td>{r.account}</td>
                                    <td className="num">{r.quantity == null ? "—" : formatQty(r.quantity)}</td>
                                    <td className="num">{formatUsd(r.value)}</td>
                                    <td className="num">{r.costBasis == null ? "—" : formatUsd(r.costBasis)}</td>
                                    <td>{formatShortDate(`${r.valueAsOf}T12:00:00`)}</td>
                                    <td><RowActions row={r} accounts={accounts} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <ManualHoldingDialog open={addOpen} onOpenChange={setAddOpen} accounts={accounts} />
        </section>
    );
}
