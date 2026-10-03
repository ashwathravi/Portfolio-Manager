"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { parseHoldingsCsv, type ParseResult } from "@/lib/portfolio/csvImport";
import { formatQty, formatUsd } from "@/lib/format";

export interface ImportAccountOption {
    id: string;
    name: string;
}

const NEW_ACCOUNT = "__new__";

/**
 * Holdings › Import CSV. Choose a positions export from your broker, check
 * what was read (and what was not), pick the account, then import. Nothing
 * is sent until the user confirms the preview.
 */
export function ImportHoldingsDialog({
    accounts,
    triggerClassName = "pm-btn pm-btn-ghost",
}: {
    accounts: readonly ImportAccountOption[];
    triggerClassName?: string;
}) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [fileName, setFileName] = useState<string | null>(null);
    const [parsed, setParsed] = useState<ParseResult | null>(null);
    const [target, setTarget] = useState<string>(accounts[0]?.id ?? NEW_ACCOUNT);
    const [newName, setNewName] = useState("Imported account");
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
        if (file.size > 2 * 1024 * 1024) {
            setParsed(null);
            setError("That file is larger than 2 MB. Export positions only.");
            return;
        }
        setFileName(file.name);
        setParsed(parseHoldingsCsv(await file.text()));
    };

    const rows = useMemo(() => parsed?.rows ?? [], [parsed]);
    const canImport = rows.length > 0 && !submitting && (target !== NEW_ACCOUNT || newName.trim().length > 0);

    const submit = async () => {
        if (!canImport) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch("/api/portfolio/import", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    ...(target === NEW_ACCOUNT ? { newPortfolioName: newName.trim() } : { portfolioId: target }),
                    rows,
                }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(body?.error ?? `Import failed (${res.status}).`);
                setSubmitting(false);
                return;
            }
            const d = body.data as { insert: number; update: number; unchanged: number };
            toast.success(
                `Imported ${rows.length} position${rows.length === 1 ? "" : "s"}: ${d.insert} new, ${d.update} updated${d.unchanged ? `, ${d.unchanged} unchanged` : ""}.`,
            );
            setOpen(false);
            reset();
            router.refresh();
        } catch {
            setError("Could not reach the server. Nothing was imported.");
            setSubmitting(false);
        }
    };

    return (
        <>
            <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
                Import CSV
            </button>
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    setOpen(next);
                    if (!next) reset();
                }}
            >
                <DialogContent className="sm:max-w-2xl" data-testid="import-dialog">
                    <DialogHeader>
                        <DialogTitle>Import holdings from CSV</DialogTitle>
                        <DialogDescription>
                            Use your broker&apos;s positions export. Atlas reads the symbol, quantity, and average cost
                            (or total cost basis). A symbol you already hold in the chosen account is replaced; other
                            positions are left alone.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="pm-import-body">
                        <label className="pm-exec-field">
                            <span className="pm-exec-field-label">CSV file</span>
                            <input
                                type="file"
                                accept=".csv,text/csv"
                                aria-label="CSV file"
                                onChange={(e) => void onFile(e.target.files?.[0])}
                            />
                        </label>

                        {parsed && (
                            <div className="pm-import-preview" data-testid="import-preview">
                                <p className="pm-import-summary">
                                    {fileName}: {rows.length} position{rows.length === 1 ? "" : "s"} ready
                                    {parsed.issues.length > 0 && `, ${parsed.issues.length} ${parsed.issues.length === 1 ? "row needs" : "rows need"} attention`}
                                    {parsed.skipped > 0 && `, ${parsed.skipped} cash or total row${parsed.skipped === 1 ? "" : "s"} skipped`}.
                                </p>
                                {rows.length > 0 && (
                                    <div className="pm-table-scroll pm-import-table">
                                        <table className="pm-table-full">
                                            <thead>
                                                <tr>
                                                    <th scope="col">Symbol</th>
                                                    <th scope="col">Name</th>
                                                    <th scope="col" className="num">Quantity</th>
                                                    <th scope="col" className="num">Avg cost</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.slice(0, 50).map((r) => (
                                                    <tr key={r.symbol}>
                                                        <td>{r.symbol}</td>
                                                        <td>{r.name || "—"}</td>
                                                        <td className="num">{formatQty(r.quantity)}</td>
                                                        <td className="num">{formatUsd(r.avgCost)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {rows.length > 50 && <p className="pm-import-more">…and {rows.length - 50} more</p>}
                                    </div>
                                )}
                                {parsed.issues.length > 0 && (
                                    <ul className="pm-import-issues" aria-label="Rows not imported">
                                        {parsed.issues.slice(0, 10).map((i) => (
                                            <li key={`${i.line}-${i.message}`}>
                                                Line {i.line}: {i.message}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}

                        {rows.length > 0 && (
                            <div className="pm-import-target">
                                <label className="pm-exec-field">
                                    <span className="pm-exec-field-label">Import into</span>
                                    <select className="pm-exec-input" value={target} onChange={(e) => setTarget(e.target.value)}>
                                        {accounts.map((a) => (
                                            <option key={a.id} value={a.id}>
                                                {a.name}
                                            </option>
                                        ))}
                                        <option value={NEW_ACCOUNT}>New account…</option>
                                    </select>
                                </label>
                                {target === NEW_ACCOUNT && (
                                    <label className="pm-exec-field">
                                        <span className="pm-exec-field-label">New account name</span>
                                        <input
                                            className="pm-exec-input"
                                            value={newName}
                                            maxLength={80}
                                            onChange={(e) => setNewName(e.target.value)}
                                        />
                                    </label>
                                )}
                            </div>
                        )}

                        {error && (
                            <p className="pm-import-error" role="alert">
                                {error}
                            </p>
                        )}
                    </div>

                    <DialogFooter>
                        <button type="button" className="pm-btn pm-btn-ghost" onClick={() => setOpen(false)}>
                            Cancel
                        </button>
                        <button type="button" className="pm-btn pm-btn-primary" disabled={!canImport} onClick={submit}>
                            {submitting ? "Importing…" : rows.length > 0 ? `Import ${rows.length} position${rows.length === 1 ? "" : "s"}` : "Import"}
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
