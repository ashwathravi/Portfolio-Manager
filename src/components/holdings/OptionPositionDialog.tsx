"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { parseNumber } from "@/lib/portfolio/csvImport";
import { describeOptionContract, formatStrike, type LoadedOptionPosition } from "@/lib/portfolio/option-positions";
import { normalizeTicker } from "@/lib/research/watchlist";
import { OPTION_POSITION_LIMITS } from "@/lib/validators/option-position";

export interface OptionAccountOption {
    id: string;
    name: string;
}

export interface OptionThesisOption {
    id: string;
    ticker: string;
    title: string;
}

/** Today in the user's own timezone, as YYYY-MM-DD. */
function localToday(): string {
    return new Date().toLocaleDateString("en-CA");
}

const text = (n: number | null | undefined) => (n == null ? "" : String(n));

/**
 * Holdings › LEAPS ledger › Add or Edit an option position (launch item
 * i63). The contract, how many and what was paid per share; optionally a
 * price of the user's own (used while no newer close is stored), the thesis
 * it rests on, what must be true by expiry and the exit rule, which the
 * ledger checks for.
 */
export function OptionPositionDialog({
    open,
    onOpenChange,
    accounts,
    theses,
    editing,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    accounts: readonly OptionAccountOption[];
    theses: readonly OptionThesisOption[];
    /** The position being edited; absent to add one. */
    editing?: LoadedOptionPosition | null;
}) {
    const router = useRouter();
    const ids = useId();
    const [account, setAccount] = useState("");
    const [underlying, setUnderlying] = useState("");
    const [contractType, setContractType] = useState<"call" | "put">("call");
    const [strike, setStrike] = useState("");
    const [expiry, setExpiry] = useState("");
    const [direction, setDirection] = useState<"long" | "short">("long");
    const [contracts, setContracts] = useState("");
    const [premium, setPremium] = useState("");
    const [openedAt, setOpenedAt] = useState("");
    const [mark, setMark] = useState("");
    const [thesisId, setThesisId] = useState("");
    const [expiryTest, setExpiryTest] = useState("");
    const [exitRule, setExitRule] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        // The position as saved, or a fresh form, each time it opens.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAccount(editing?.portfolioId ?? accounts[0]?.id ?? "");
        setUnderlying(editing?.underlying ?? "");
        setContractType(editing?.contractType ?? "call");
        setStrike(editing ? formatStrike(editing.strike) : "");
        setExpiry(editing?.expiry ?? "");
        setDirection(editing && editing.quantity < 0 ? "short" : "long");
        setContracts(editing ? String(Math.abs(editing.quantity)) : "");
        setPremium(text(editing?.premium));
        setOpenedAt(editing?.openedAt ?? "");
        setMark(text(editing?.userMark));
        setThesisId(editing?.thesisId ?? "");
        setExpiryTest(editing?.expiryTest ?? "");
        setExitRule(editing?.exitRule ?? "");
        setError(null);
    }, [open, editing, accounts]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        const ticker = normalizeTicker(underlying);
        if (!ticker) return setError("Enter the underlying's ticker.");
        const strikeValue = parseNumber(strike);
        if (strikeValue == null || strikeValue <= 0) return setError("Enter a strike above 0.");
        if (!expiry) return setError("Enter the expiry date.");
        const count = parseNumber(contracts);
        if (count == null || count <= 0 || !Number.isInteger(count)) return setError("Enter a whole number of contracts.");
        const paid = parseNumber(premium);
        if (paid == null || paid < 0) return setError("Enter the premium per share.");
        let userMark: number | null = null;
        if (mark.trim()) {
            userMark = parseNumber(mark);
            if (userMark == null || userMark < 0) return setError("Your price must be a positive number.");
        }
        // A price the user typed is dated today; one left as it was keeps its date.
        const userMarkDate = userMark == null
            ? null
            : editing?.userMark === userMark && editing.userMarkDate ? editing.userMarkDate : localToday();

        setSaving(true);
        try {
            const response = await fetch(editing ? `/api/portfolio/options/${editing.id}` : "/api/portfolio/options", {
                method: editing ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({
                    portfolioId: account,
                    position: {
                        underlying: ticker,
                        contractType,
                        strike: strikeValue,
                        expiry,
                        quantity: direction === "short" ? -count : count,
                        premium: paid,
                        ...(editing ? { multiplier: editing.multiplier } : {}),
                        openedAt: openedAt || null,
                        userMark,
                        userMarkDate,
                        thesisId: thesisId || null,
                        expiryTest: expiryTest.trim(),
                        exitRule: exitRule.trim(),
                    },
                }),
            });
            if (!response.ok) {
                const body = (await response.json().catch(() => null)) as { error?: string } | null;
                setError(body?.error ?? "Couldn't save the option position. Try again.");
                return;
            }
            const label = describeOptionContract({ underlying: ticker, contractType, strike: strikeValue, expiry });
            toast.success(editing ? `Saved ${label}.` : `Added ${label}.`);
            onOpenChange(false);
            router.refresh();
        } catch {
            setError("Couldn't reach Atlas. Nothing was saved.");
        } finally {
            setSaving(false);
        }
    };

    const thesisChoices = [...theses].sort((a, b) =>
        Number(b.ticker === normalizeTicker(underlying)) - Number(a.ticker === normalizeTicker(underlying)) || a.ticker.localeCompare(b.ticker));

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg" data-testid="option-position-dialog">
                <form onSubmit={submit}>
                    <DialogHeader>
                        <DialogTitle>{editing ? "Edit option position" : "Add an option position"}</DialogTitle>
                        <DialogDescription>
                            What you hold and paid, per share as your broker quotes it. Atlas marks it at the latest
                            closing price where its data allows, otherwise at your own price or what you paid.
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
                            <label className="pm-exec-field" htmlFor={`${ids}-underlying`}>
                                <span className="pm-exec-field-label">Underlying</span>
                                <input
                                    id={`${ids}-underlying`}
                                    className="pm-exec-input"
                                    value={underlying}
                                    placeholder="AAPL"
                                    autoCapitalize="characters"
                                    onChange={(e) => setUnderlying(e.target.value.toUpperCase())}
                                />
                            </label>
                        </div>
                        <div className="pm-form-pair">
                            <label className="pm-exec-field" htmlFor={`${ids}-type`}>
                                <span className="pm-exec-field-label">Call or put</span>
                                <select id={`${ids}-type`} className="pm-exec-input" value={contractType} onChange={(e) => setContractType(e.target.value as "call" | "put")}>
                                    <option value="call">Call</option>
                                    <option value="put">Put</option>
                                </select>
                            </label>
                            <label className="pm-exec-field" htmlFor={`${ids}-strike`}>
                                <span className="pm-exec-field-label">Strike ($)</span>
                                <input id={`${ids}-strike`} className="pm-exec-input" inputMode="decimal" value={strike} onChange={(e) => setStrike(e.target.value)} />
                            </label>
                        </div>
                        <div className="pm-form-pair">
                            <label className="pm-exec-field" htmlFor={`${ids}-expiry`}>
                                <span className="pm-exec-field-label">Expiry</span>
                                <input id={`${ids}-expiry`} type="date" className="pm-exec-input" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                            </label>
                            <label className="pm-exec-field" htmlFor={`${ids}-direction`}>
                                <span className="pm-exec-field-label">Position</span>
                                <select id={`${ids}-direction`} className="pm-exec-input" value={direction} onChange={(e) => setDirection(e.target.value as "long" | "short")}>
                                    <option value="long">Bought (long)</option>
                                    <option value="short">Written (short)</option>
                                </select>
                            </label>
                        </div>
                        <div className="pm-form-pair">
                            <label className="pm-exec-field" htmlFor={`${ids}-contracts`}>
                                <span className="pm-exec-field-label">Contracts</span>
                                <input id={`${ids}-contracts`} className="pm-exec-input" inputMode="numeric" value={contracts} onChange={(e) => setContracts(e.target.value)} />
                            </label>
                            <label className="pm-exec-field" htmlFor={`${ids}-premium`}>
                                <span className="pm-exec-field-label">{direction === "short" ? "Premium received / share ($)" : "Premium paid / share ($)"}</span>
                                <input id={`${ids}-premium`} className="pm-exec-input" inputMode="decimal" value={premium} onChange={(e) => setPremium(e.target.value)} />
                            </label>
                        </div>
                        <div className="pm-form-pair">
                            <label className="pm-exec-field" htmlFor={`${ids}-opened`}>
                                <span className="pm-exec-field-label">Opened (optional)</span>
                                <input id={`${ids}-opened`} type="date" className="pm-exec-input" value={openedAt} onChange={(e) => setOpenedAt(e.target.value)} />
                            </label>
                            <label className="pm-exec-field" htmlFor={`${ids}-mark`}>
                                <span className="pm-exec-field-label">Your price / share ($, optional)</span>
                                <input
                                    id={`${ids}-mark`}
                                    className="pm-exec-input"
                                    inputMode="decimal"
                                    value={mark}
                                    aria-describedby={`${ids}-mark-hint`}
                                    onChange={(e) => setMark(e.target.value)}
                                />
                            </label>
                        </div>
                        <p id={`${ids}-mark-hint`} className="pm-metric-note">
                            Used until a newer closing price is stored. Leave it empty to use the close, or what you paid.
                        </p>
                        <label className="pm-exec-field" htmlFor={`${ids}-thesis`}>
                            <span className="pm-exec-field-label">Thesis (optional)</span>
                            <select id={`${ids}-thesis`} className="pm-exec-input" value={thesisId} onChange={(e) => setThesisId(e.target.value)}>
                                <option value="">No linked thesis</option>
                                {thesisChoices.map((t) => <option key={t.id} value={t.id}>{t.ticker}: {t.title}</option>)}
                                {/* A linked thesis since deleted: kept until the user picks another. */}
                                {thesisId && !theses.some((t) => t.id === thesisId) && <option value={thesisId}>A deleted thesis</option>}
                            </select>
                        </label>
                        <label className="pm-exec-field" htmlFor={`${ids}-expiry-test`}>
                            <span className="pm-exec-field-label">What must be true by expiry (optional)</span>
                            <textarea
                                id={`${ids}-expiry-test`}
                                className="pm-exec-input"
                                rows={2}
                                maxLength={OPTION_POSITION_LIMITS.expiryTest}
                                value={expiryTest}
                                onChange={(e) => setExpiryTest(e.target.value)}
                            />
                        </label>
                        <label className="pm-exec-field" htmlFor={`${ids}-exit-rule`}>
                            <span className="pm-exec-field-label">Exit, roll or expire rule (optional)</span>
                            <textarea
                                id={`${ids}-exit-rule`}
                                className="pm-exec-input"
                                rows={2}
                                maxLength={OPTION_POSITION_LIMITS.exitRule}
                                value={exitRule}
                                onChange={(e) => setExitRule(e.target.value)}
                            />
                        </label>
                        {error && <p className="pm-form-error" role="alert" data-testid="option-form-error">{error}</p>}
                    </div>
                    <DialogFooter>
                        <button type="button" className="pm-btn pm-btn-ghost" onClick={() => onOpenChange(false)}>Cancel</button>
                        <button type="submit" className="pm-btn pm-btn-primary" disabled={saving || !account}>
                            {saving ? "Saving…" : editing ? "Save" : "Add position"}
                        </button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
