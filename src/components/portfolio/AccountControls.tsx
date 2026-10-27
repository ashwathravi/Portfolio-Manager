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
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        // Start from the account being edited, or blank, each time it opens.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setName(editing?.name ?? "");
        setDescription(editing?.description ?? "");
        setCash(editing ? String(editing.cashUsd) : "");
        setError(null);
    }, [open, editing]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const cashText = cash.replace(/[$,\s]/g, "");
        const cashBalance = cashText === "" ? 0 : Number(cashText);
        if (!name.trim()) return setError("Name the account.");
        if (!Number.isFinite(cashBalance)) return setError("Cash must be a number, such as 2500 or 2,500.00.");

        setSaving(true);
        const result = editing
            ? await send(`/api/portfolios/${editing.id}`, {
                method: "PATCH",
                body: JSON.stringify({ name: name.trim(), description: description.trim(), cashBalance }),
            })
            : await send("/api/portfolios", {
                method: "POST",
                body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, cashBalance }),
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
                        <label className="pm-exec-field" htmlFor={`${ids}-description`}>
                            <span className="pm-exec-field-label">Description (optional)</span>
                            <Input
                                id={`${ids}-description`}
                                value={description}
                                maxLength={PORTFOLIO_LIMITS.description}
                                placeholder="e.g. Fidelity, taxable"
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
        // Transactions, drafted orders and value history go too, even
        // without positions: a cash-only account can have them all.
        const what = account.positions === 0
            ? "Its transactions, drafted orders and value history go with it."
            : `Its ${account.positions} ${account.positions === 1 ? "position" : "positions"}, transactions, drafted orders and value history go with it.`;
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
