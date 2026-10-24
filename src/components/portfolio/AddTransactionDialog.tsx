"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    SYMBOL_TYPES,
    TRADE_TYPES,
    TRANSACTION_TYPES,
    TRANSACTION_TYPE_LABELS,
    type TransactionType,
} from "@/lib/portfolio/transactions";
import { parseNumber } from "@/lib/portfolio/csvImport";
import { TRANSACTION_LIMITS } from "@/lib/validators/transaction";

export interface TransactionAccountOption {
    id: string;
    name: string;
}

/** Today in the user's own timezone, as YYYY-MM-DD. */
function localToday(): string {
    return new Date().toLocaleDateString("en-CA");
}

/**
 * Portfolio › Activity › Add transaction (launch item i40). A buy or sell
 * takes a symbol, quantity and price; a dividend a symbol and an amount;
 * interest, deposits, withdrawals and fees an amount. It's added to the
 * activity record; holdings and cash aren't changed.
 */
export function AddTransactionDialog({ accounts }: { accounts: readonly TransactionAccountOption[] }) {
    const router = useRouter();
    const ids = useId();
    const [open, setOpen] = useState(false);
    const [account, setAccount] = useState(accounts[0]?.id ?? "");
    const [type, setType] = useState<TransactionType>("BUY");
    const [date, setDate] = useState("");
    const [symbol, setSymbol] = useState("");
    const [quantity, setQuantity] = useState("");
    const [price, setPrice] = useState("");
    const [amount, setAmount] = useState("");
    const [fees, setFees] = useState("");
    const [notes, setNotes] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        // A fresh form, dated today, each time it opens.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDate(localToday());
        setSymbol("");
        setQuantity("");
        setPrice("");
        setAmount("");
        setFees("");
        setNotes("");
        setError(null);
        setAccount((current) => (accounts.some((a) => a.id === current) ? current : accounts[0]?.id ?? ""));
    }, [open, accounts]);

    const trade = TRADE_TYPES.has(type);
    const needsSymbol = SYMBOL_TYPES.has(type);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        const number = (text: string, label: string): number | null | "bad" => {
            if (!text.trim()) return null;
            const n = parseNumber(text);
            if (n == null || n < 0) {
                setError(`${label} must be a positive number.`);
                return "bad";
            }
            return n;
        };
        const q = trade ? number(quantity, "Quantity") : null;
        const p = trade ? number(price, "Price") : null;
        const a = trade ? null : number(amount, "Amount");
        const f = number(fees, "Fees");
        if (q === "bad" || p === "bad" || a === "bad" || f === "bad") return;
        if (needsSymbol && !symbol.trim()) return setError("Enter the symbol.");
        if (trade && (q == null || q === 0 || p == null)) return setError("Enter the quantity and price.");
        if (!trade && (a == null || a === 0)) return setError("Enter the amount.");

        setSaving(true);
        try {
            const response = await fetch("/api/transactions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                    portfolioId: account,
                    transaction: {
                        type,
                        date,
                        ...(needsSymbol ? { symbol: symbol.trim().toUpperCase() } : {}),
                        ...(trade ? { quantity: q, price: p } : { amount: a }),
                        ...(f != null && f > 0 ? { fees: f } : {}),
                        ...(notes.trim() ? { notes: notes.trim() } : {}),
                    },
                }),
            });
            if (!response.ok) {
                const body = (await response.json().catch(() => null)) as { error?: string } | null;
                setError(body?.error ?? "Couldn't add the transaction. Try again.");
                return;
            }
            toast.success(`${TRANSACTION_TYPE_LABELS[type]} added.`);
            setOpen(false);
            router.refresh();
        } catch {
            setError("Couldn't reach Atlas. Nothing was added.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <button type="button" className="pm-btn pm-btn-primary" disabled={accounts.length === 0} onClick={() => setOpen(true)}>
                <Plus size={14} aria-hidden="true" />
                <span>Add transaction</span>
            </button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-md">
                    <form onSubmit={submit}>
                        <DialogHeader>
                            <DialogTitle>Add a transaction</DialogTitle>
                            <DialogDescription>
                                It goes in your activity record. Holdings and cash stay as your account reports them.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="pm-card-stack" style={{ padding: "16px 0" }}>
                            <div className="pm-form-pair">
                                <label className="pm-exec-field" htmlFor={`${ids}-account`}>
                                    <span className="pm-exec-field-label">Account</span>
                                    <select id={`${ids}-account`} className="pm-exec-input" value={account} onChange={(e) => setAccount(e.target.value)}>
                                        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                    </select>
                                </label>
                                <label className="pm-exec-field" htmlFor={`${ids}-type`}>
                                    <span className="pm-exec-field-label">Type</span>
                                    <select id={`${ids}-type`} className="pm-exec-input" value={type} onChange={(e) => setType(e.target.value as TransactionType)}>
                                        {TRANSACTION_TYPES.map((t) => <option key={t} value={t}>{TRANSACTION_TYPE_LABELS[t]}</option>)}
                                    </select>
                                </label>
                            </div>
                            <div className="pm-form-pair">
                                <label className="pm-exec-field" htmlFor={`${ids}-date`}>
                                    <span className="pm-exec-field-label">Date</span>
                                    <input id={`${ids}-date`} type="date" className="pm-exec-input" value={date} required onChange={(e) => setDate(e.target.value)} />
                                </label>
                                {needsSymbol && (
                                    <label className="pm-exec-field" htmlFor={`${ids}-symbol`}>
                                        <span className="pm-exec-field-label">Symbol</span>
                                        <input
                                            id={`${ids}-symbol`}
                                            className="pm-exec-input"
                                            value={symbol}
                                            maxLength={10}
                                            placeholder="AAPL"
                                            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                                        />
                                    </label>
                                )}
                            </div>
                            {trade ? (
                                <div className="pm-form-pair">
                                    <label className="pm-exec-field" htmlFor={`${ids}-quantity`}>
                                        <span className="pm-exec-field-label">Quantity</span>
                                        <input id={`${ids}-quantity`} className="pm-exec-input" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                                    </label>
                                    <label className="pm-exec-field" htmlFor={`${ids}-price`}>
                                        <span className="pm-exec-field-label">Price ($)</span>
                                        <input id={`${ids}-price`} className="pm-exec-input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
                                    </label>
                                </div>
                            ) : (
                                <label className="pm-exec-field" htmlFor={`${ids}-amount`}>
                                    <span className="pm-exec-field-label">Amount ($)</span>
                                    <input id={`${ids}-amount`} className="pm-exec-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                                </label>
                            )}
                            <div className="pm-form-pair">
                                <label className="pm-exec-field" htmlFor={`${ids}-fees`}>
                                    <span className="pm-exec-field-label">Fees ($, optional)</span>
                                    <input id={`${ids}-fees`} className="pm-exec-input" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} />
                                </label>
                                <label className="pm-exec-field" htmlFor={`${ids}-notes`}>
                                    <span className="pm-exec-field-label">Note (optional)</span>
                                    <input
                                        id={`${ids}-notes`}
                                        className="pm-exec-input"
                                        value={notes}
                                        maxLength={TRANSACTION_LIMITS.notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                    />
                                </label>
                            </div>
                            {error && <p className="pm-form-error" role="alert" data-testid="transaction-form-error">{error}</p>}
                        </div>
                        <DialogFooter>
                            <button type="button" className="pm-btn pm-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                            <button type="submit" className="pm-btn pm-btn-primary" disabled={saving || !account}>
                                {saving ? "Adding…" : `Add ${TRANSACTION_TYPE_LABELS[type].toLowerCase()}`}
                            </button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    );
}
