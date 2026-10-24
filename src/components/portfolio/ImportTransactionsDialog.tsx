"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TRANSACTION_TYPE_LABELS } from "@/lib/portfolio/transactions";
import { parseTransactionsCsv, type TransactionParseResult } from "@/lib/portfolio/transactionsCsv";
import { formatMoney, formatQty, formatShortDate } from "@/lib/format";
import type { TransactionAccountOption } from "./AddTransactionDialog";

/**
 * Portfolio › Activity › Import CSV (launch item i40). Choose your broker's
 * activity or history export, check what was read (and what wasn't), pick
 * the account, then import. Transactions the account already has, from an
 * earlier import of the same or an overlapping file, are skipped.
 */
export function ImportTransactionsDialog({ accounts }: { accounts: readonly TransactionAccountOption[] }) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [fileName, setFileName] = useState<string | null>(null);
    const [parsed, setParsed] = useState<TransactionParseResult | null>(null);
    const [target, setTarget] = useState<string>(accounts[0]?.id ?? "");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reset = () => {
        setFileName(null);
        setParsed(null);
        setError(null);
        setSubmitting(false);
    };

    const onFile = async (file: File | undefined) => {
        setError(null);
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) {
            setParsed(null);
            setError("That file is larger than 4 MB. Export a shorter date range.");
            return;
        }
        setFileName(file.name);
        setParsed(parseTransactionsCsv(await file.text()));
    };

    const rows = useMemo(() => parsed?.rows ?? [], [parsed]);
    const canImport = rows.length > 0 && parsed?.issues.length === 0 && !submitting && Boolean(target);

    const submit = async () => {
        if (!canImport) return;
        setSubmitting(true);
        setError(null);
        try {
            const response = await fetch("/api/transactions/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ portfolioId: target, rows }),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                setError(body?.error ?? `Import failed (${response.status}). Nothing was imported.`);
                setSubmitting(false);
                return;
            }
            const { inserted, duplicates } = body.data as { inserted: number; duplicates: number };
            toast.success(
                `Imported ${inserted} transaction${inserted === 1 ? "" : "s"}${duplicates ? `; ${duplicates} ${duplicates === 1 ? "was" : "were"} already there` : ""}.`,
            );
            setOpen(false);
            reset();
            router.refresh();
        } catch {
            setError("Couldn't reach Atlas. Nothing was imported.");
            setSubmitting(false);
        }
    };

    return (
        <>
            <button type="button" className="pm-btn pm-btn-ghost" disabled={accounts.length === 0} onClick={() => setOpen(true)}>
                Import CSV
            </button>
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    setOpen(next);
                    if (!next) reset();
                }}
            >
                <DialogContent className="sm:max-w-2xl" data-testid="transactions-import-dialog">
                    <DialogHeader>
                        <DialogTitle>Import transactions from CSV</DialogTitle>
                        <DialogDescription>
                            Use your broker&apos;s activity or history export. Atlas reads the date, the action (buy, sell,
                            dividend, interest, deposit, withdrawal or fee), the symbol, quantity, price, amount or value,
                            fees and currency.
                            Transactions already imported are skipped.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="pm-import-body">
                        <label className="pm-exec-field">
                            <span className="pm-exec-field-label">CSV file</span>
                            <input
                                type="file"
                                accept=".csv,text/csv"
                                aria-label="CSV file"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    // Clear it so choosing the same, corrected file again re-reads it.
                                    e.target.value = "";
                                    void onFile(file);
                                }}
                            />
                        </label>

                        {parsed && (
                            <div className="pm-import-preview" data-testid="transactions-import-preview">
                                <p className="pm-import-summary">
                                    {fileName}: {rows.length} transaction{rows.length === 1 ? "" : "s"} ready
                                    {parsed.issues.length > 0 && `, ${parsed.issues.length} ${parsed.issues.length === 1 ? "row needs" : "rows need"} attention`}
                                    {parsed.skipped > 0 && `, ${parsed.skipped} note or total row${parsed.skipped === 1 ? "" : "s"} skipped`}.
                                </p>
                                {rows.length > 0 && (
                                    <div className="pm-table-scroll pm-import-table">
                                        <table className="pm-table-full">
                                            <thead>
                                                <tr>
                                                    <th scope="col">Date</th>
                                                    <th scope="col">Type</th>
                                                    <th scope="col">Symbol</th>
                                                    <th scope="col" className="num">Qty</th>
                                                    <th scope="col" className="num">Price</th>
                                                    <th scope="col" className="num">Amount</th>
                                                    <th scope="col" className="num">Fees</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.slice(0, 50).map((r, i) => (
                                                    <tr key={`${r.date}-${i}`}>
                                                        <td>{formatShortDate(`${r.date}T12:00:00Z`)}</td>
                                                        <td>{TRANSACTION_TYPE_LABELS[r.type]}</td>
                                                        <td>{r.symbol ?? "—"}</td>
                                                        <td className="num">{r.quantity == null ? "—" : formatQty(r.quantity)}</td>
                                                        <td className="num">{r.price == null ? "—" : formatMoney(r.price, r.currency)}</td>
                                                        <td className="num">{formatMoney(r.amount ?? (r.quantity ?? 0) * (r.price ?? 0), r.currency)}</td>
                                                        <td className="num">{r.fees == null ? "—" : formatMoney(r.fees, r.currency)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {rows.length > 50 && <p className="pm-import-more">…and {rows.length - 50} more</p>}
                                    </div>
                                )}
                                {parsed.issues.length > 0 && (
                                    <>
                                        <p role="alert">Fix the listed rows (or remove them) and upload the CSV again before importing.</p>
                                        <ul className="pm-import-issues" aria-label="Rows not imported">
                                            {parsed.issues.slice(0, 10).map((i) => (
                                                <li key={`${i.line}-${i.message}`}>Line {i.line}: {i.message}</li>
                                            ))}
                                        </ul>
                                    </>
                                )}
                            </div>
                        )}

                        {rows.length > 0 && (
                            <label className="pm-exec-field">
                                <span className="pm-exec-field-label">Import into</span>
                                <select className="pm-exec-input" value={target} onChange={(e) => setTarget(e.target.value)}>
                                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </select>
                            </label>
                        )}

                        {error && <p className="pm-import-error" role="alert">{error}</p>}
                    </div>

                    <DialogFooter>
                        <button type="button" className="pm-btn pm-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
                        <button type="button" className="pm-btn pm-btn-primary" disabled={!canImport} onClick={submit}>
                            {submitting ? "Importing…" : rows.length > 0 ? `Import ${rows.length} transaction${rows.length === 1 ? "" : "s"}` : "Import"}
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
