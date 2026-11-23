"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PORTFOLIO_LIMITS } from "@/lib/validators/portfolio";
import {
    ACCOUNT_TYPE_LABELS,
    ACCOUNT_TYPES,
    DEFAULT_OWNERSHIP,
    DEFAULT_TAX_TREATMENT,
    INSTITUTION_MAX_LENGTH,
    OWNERSHIP_LABELS,
    OWNERSHIPS,
    TAX_TREATMENT_LABELS,
    TAX_TREATMENTS,
    type AccountType,
} from "@/lib/portfolio/account-kinds";

/**
 * Portfolio › Accounts: create an account, and edit or delete one (launch
 * item i41). Changes go to /api/portfolios, then the page reloads its data.
 */

export interface EditableAccount {
    id: string;
    name: string;
    description: string | null;
    cashUsd: number;
    positions: number;
    accountType?: string | null;
    institution?: string | null;
    taxTreatment?: string | null;
    ownership?: string | null;
}

async function send(path: string, init: RequestInit): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
        const response = await fetch(path, {
            ...init,
            headers: init.body ? { "Content-Type": "application/json" } : undefined,
            credentials: "same-origin",
        });
        if (response.ok) return { ok: true };
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        return { ok: false, message: typeof body?.error === "string" ? body.error : "Something went wrong. Try again." };
    } catch {
        return { ok: false, message: "Couldn't reach Atlas. Check your connection and try again." };
    }
}

/** After a change: the page's data, and the sidebar's account count. */
function useRefresh() {
    const router = useRouter();
    const queryClient = useQueryClient();
    return () => {
        router.refresh();
        void queryClient.invalidateQueries({ queryKey: ["portfolios"] });
    };
}

function AccountDialog({
    open,
    onOpenChange,
    editing,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    editing?: EditableAccount;
}) {
    const refresh = useRefresh();
    const ids = useId();
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [cash, setCash] = useState("");
    const [accountType, setAccountType] = useState("");
    const [institution, setInstitution] = useState("");
    const [taxTreatment, setTaxTreatment] = useState("");
    const [ownership, setOwnership] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        // Start from the account being edited, or blank, each time it opens.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setName(editing?.name ?? "");
        setDescription(editing?.description ?? "");
        setCash(editing ? String(editing.cashUsd) : "");
        setAccountType(editing?.accountType ?? "");
        setInstitution(editing?.institution ?? "");
        setTaxTreatment(editing?.taxTreatment ?? "");
        setOwnership(editing?.ownership ?? "");
        setError(null);
    }, [open, editing]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const cashText = cash.replace(/[$,\s]/g, "");
        const cashBalance = cashText === "" ? 0 : Number(cashText);
        if (!name.trim()) return setError("Name the account.");
        if (!Number.isFinite(cashBalance)) return setError("Cash must be a number, such as 2500 or 2,500.00.");

        // Empty is "not said": null clears what an edit had.
        const kind = {
            accountType: accountType || null,
            institution: institution.trim() || null,
            taxTreatment: taxTreatment || null,
            ownership: ownership || null,
        };
        setSaving(true);
        const result = editing
            ? await send(`/api/portfolios/${editing.id}`, {
                method: "PATCH",
                body: JSON.stringify({ name: name.trim(), description: description.trim(), cashBalance, ...kind }),
            })
            : await send("/api/portfolios", {
                method: "POST",
                body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, cashBalance, ...kind }),
            });
        setSaving(false);
        if (!result.ok) return setError(result.message);
        toast.success(editing ? `${name.trim()} updated.` : `${name.trim()} added.`);
        onOpenChange(false);
        refresh();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <form onSubmit={submit}>
                    <DialogHeader>
                        <DialogTitle>{editing ? "Edit account" : "New account"}</DialogTitle>
                    </DialogHeader>
                    <div className="pm-card-stack" style={{ padding: "16px 0" }}>
                        <label className="pm-exec-field" htmlFor={`${ids}-name`}>
                            <span className="pm-exec-field-label">Name</span>
                            <Input
                                id={`${ids}-name`}
                                value={name}
                                maxLength={PORTFOLIO_LIMITS.name}
                                placeholder="e.g. Brokerage, Roth IRA"
                                onChange={(e) => setName(e.target.value)}
                                autoFocus
                            />
                        </label>
                        <div className="pm-form-pair">
                            <label className="pm-exec-field" htmlFor={`${ids}-type`}>
                                <span className="pm-exec-field-label">Type (optional)</span>
                                <select
                                    id={`${ids}-type`}
                                    className="pm-exec-input"
                                    value={accountType}
                                    onChange={(e) => {
                                        const next = e.target.value;
                                        setAccountType(next);
                                        // Suggest how it's usually taxed and held; the user's own pick stands.
                                        if (next && !taxTreatment) setTaxTreatment(DEFAULT_TAX_TREATMENT[next as AccountType] ?? "");
                                        if (next && !ownership) setOwnership(DEFAULT_OWNERSHIP[next as AccountType] ?? "");
                                    }}
                                >
                                    <option value="">Not set</option>
                                    {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>)}
                                </select>
                            </label>
                            <label className="pm-exec-field" htmlFor={`${ids}-tax`}>
                                <span className="pm-exec-field-label">Tax treatment (optional)</span>
                                <select id={`${ids}-tax`} className="pm-exec-input" value={taxTreatment} onChange={(e) => setTaxTreatment(e.target.value)}>
                                    <option value="">Not set</option>
                                    {TAX_TREATMENTS.map((t) => <option key={t} value={t}>{TAX_TREATMENT_LABELS[t]}</option>)}
                                </select>
                            </label>
                        </div>
                        <div className="pm-form-pair">
                            <label className="pm-exec-field" htmlFor={`${ids}-ownership`}>
                                <span className="pm-exec-field-label">Ownership (optional)</span>
                                <select id={`${ids}-ownership`} className="pm-exec-input" value={ownership} onChange={(e) => setOwnership(e.target.value)}>
                                    <option value="">Not set</option>
                                    {OWNERSHIPS.map((o) => <option key={o} value={o}>{OWNERSHIP_LABELS[o]}</option>)}
                                </select>
                            </label>
                            <label className="pm-exec-field" htmlFor={`${ids}-institution`}>
                                <span className="pm-exec-field-label">Institution (optional)</span>
                                <Input
                                    id={`${ids}-institution`}
                                    value={institution}
                                    maxLength={INSTITUTION_MAX_LENGTH}
                                    placeholder="e.g. Fidelity, Schwab"
                                    onChange={(e) => setInstitution(e.target.value)}
                                />
                            </label>
                        </div>
                        <label className="pm-exec-field" htmlFor={`${ids}-description`}>
                            <span className="pm-exec-field-label">Description (optional)</span>
                            <Input
                                id={`${ids}-description`}
                                value={description}
                                maxLength={PORTFOLIO_LIMITS.description}
                                placeholder="e.g. Rollover from old employer"
                                onChange={(e) => setDescription(e.target.value)}
                            />
                        </label>
                        <label className="pm-exec-field" htmlFor={`${ids}-cash`}>
                            <span className="pm-exec-field-label">Cash ($)</span>
                            <Input
                                id={`${ids}-cash`}
                                value={cash}
                                inputMode="decimal"
                                placeholder="0.00"
                                onChange={(e) => setCash(e.target.value)}
                            />
                        </label>
                        {error && (
                            <p className="pm-form-error" role="alert" data-testid="account-form-error">{error}</p>
                        )}
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                        <Button type="submit" disabled={saving}>{editing ? "Save changes" : "Add account"}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function NewAccountButton({ variant = "primary" }: { variant?: "primary" | "ghost" }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" className={`pm-btn pm-btn-${variant}`} onClick={() => setOpen(true)}>
                <Plus size={14} aria-hidden="true" />
                <span>New account</span>
            </button>
            <AccountDialog open={open} onOpenChange={setOpen} />
        </>
    );
}

export function AccountRowActions({ account }: { account: EditableAccount }) {
    const refresh = useRefresh();
    const [editOpen, setEditOpen] = useState(false);

    const remove = async () => {
        // Transactions, drafted orders, option positions and value history go too, even
        // without positions: a cash-only account can have them all.
        const what = account.positions === 0
            ? "Its transactions, drafted orders, option positions and value history go with it."
            : `Its ${account.positions} ${account.positions === 1 ? "position" : "positions"}, transactions, drafted orders, option positions and value history go with it.`;
        if (!window.confirm(`Delete ${account.name}? ${what} This can't be undone.`)) return;
        const result = await send(`/api/portfolios/${account.id}`, { method: "DELETE" });
        if (!result.ok) {
            toast.error(result.message);
            return;
        }
        toast.success(`${account.name} deleted.`);
        refresh();
    };

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger className="pm-icon-btn" aria-label={`Actions for ${account.name}`}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                        <Pencil size={14} aria-hidden="true" />
                        Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void remove()} className="pm-menu-danger">
                        <Trash2 size={14} aria-hidden="true" />
                        Delete account
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <AccountDialog open={editOpen} onOpenChange={setEditOpen} editing={account} />
        </>
    );
}
