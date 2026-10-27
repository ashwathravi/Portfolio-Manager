"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { holdingsCsvRows, transactionsCsvRows, type AccountExport } from "@/lib/account/export-data";
import { exportToCsv } from "@/lib/exportCsv";
import { prepareForAccountDeletionSignOut } from "@/lib/storage/sign-out";

/**
 * Settings › Data (launch item i65): download everything Atlas holds for
 * you, or delete your account and all of it, with your linked connections
 * ended at Plaid.
 */

async function readApiError(response: Response, fallback: string): Promise<string> {
    try {
        const payload = (await response.json()) as { error?: unknown };
        return typeof payload.error === "string" && payload.error.trim() ? payload.error : fallback;
    } catch {
        return fallback;
    }
}

function saveFile(filename: string, contents: string, type: string) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function DataManagement() {
    const [deleteConfirmText, setDeleteConfirmText] = useState("");
    const [exporting, setExporting] = useState<"json" | "transactions" | "holdings" | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const download = async (kind: "json" | "transactions" | "holdings") => {
        setExporting(kind);
        try {
            const response = await fetch("/api/account/export", { credentials: "same-origin" });
            if (!response.ok) throw new Error(await readApiError(response, "Couldn't export your data. Try again."));
            const data = (await response.json()) as AccountExport;
            const day = data.exportedAt.slice(0, 10);
            if (kind === "json") {
                saveFile(`atlas-wealth-export-${day}.json`, JSON.stringify(data, null, 2), "application/json");
            } else {
                const rows = kind === "transactions" ? transactionsCsvRows(data) : holdingsCsvRows(data);
                if (rows.length === 0) {
                    toast.info(kind === "transactions" ? "You have no transactions to export." : "You have no holdings to export.");
                    return;
                }
                exportToCsv(`atlas-wealth-${kind}-${day}.csv`, rows);
            }
            toast.success("Your data was downloaded.");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Couldn't export your data. Try again.");
        } finally {
            setExporting(null);
        }
    };

    const deleteAccount = async () => {
        setDeleting(true);
        setDeleteError(null);
        try {
            const response = await fetch("/api/account", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                credentials: "same-origin",
                body: JSON.stringify({ confirm: deleteConfirmText }),
            });
            if (!response.ok) throw new Error(await readApiError(response, "Couldn't delete your account. Nothing was deleted; try again."));
            // The account and its session are gone: clear this browser's
            // copies (nothing unsaved is sent), then sign out.
            prepareForAccountDeletionSignOut();
            await signOut({ callbackUrl: "/login?deleted=1" });
        } catch (error) {
            setDeleteError(error instanceof Error ? error.message : "Couldn't delete your account. Try again.");
            setDeleting(false);
        }
    };

    return (
        <Card data-testid="data-management">
            <CardHeader>
                <CardTitle>Data & Privacy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <p className="text-sm text-muted-foreground">
                    How your data is kept and protected, and who it&apos;s shared with:{" "}
                    <Link href="/privacy" className="underline underline-offset-2">Privacy Policy</Link>.
                </p>

                <hr className="border-border" />

                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h4 className="font-medium">Download your data</h4>
                        <p className="text-sm text-muted-foreground">
                            Everything Atlas holds for you as one JSON file (accounts, holdings, transactions,
                            drafted orders, value history, settings, watchlist, journal, theses and Ask history), or
                            your transactions or holdings as CSV.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => void download("json")} disabled={exporting !== null}>
                            {exporting === "json" ? "Preparing…" : "Everything (JSON)"}
                        </Button>
                        <Button variant="outline" onClick={() => void download("transactions")} disabled={exporting !== null}>
                            {exporting === "transactions" ? "Preparing…" : "Transactions (CSV)"}
                        </Button>
                        <Button variant="outline" onClick={() => void download("holdings")} disabled={exporting !== null}>
                            {exporting === "holdings" ? "Preparing…" : "Holdings (CSV)"}
                        </Button>
                    </div>
                </div>

                <hr className="border-border" />

                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h4 className="font-medium">Delete account</h4>
                        <p className="text-sm text-muted-foreground">
                            Permanently delete your account and everything Atlas holds for you, and end its access to
                            your linked institutions.
                        </p>
                    </div>
                    <AlertDialog
                        onOpenChange={() => {
                            setDeleteConfirmText("");
                            setDeleteError(null);
                        }}
                    >
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive">Delete account</Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This deletes your accounts, holdings, transactions, drafted orders, value history,
                                    settings, watchlist, journal, theses and Ask history, and ends Atlas&apos;s access to
                                    your linked institutions through Plaid. It can&apos;t be undone; download your data
                                    first if you want a copy.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="space-y-2 py-2">
                                <Label htmlFor="delete-confirm" className="text-sm">
                                    Type <span className="font-bold">DELETE</span> to confirm
                                </Label>
                                <Input
                                    id="delete-confirm"
                                    value={deleteConfirmText}
                                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                                    placeholder="DELETE"
                                    className="font-mono"
                                    autoComplete="off"
                                />
                                {deleteError && (
                                    <p className="text-sm text-destructive" role="alert" data-testid="delete-account-error">{deleteError}</p>
                                )}
                            </div>
                            <AlertDialogFooter>
                                <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                                {/* Not an AlertDialogAction: the dialog stays open to show a refusal. */}
                                <Button
                                    variant="destructive"
                                    onClick={() => void deleteAccount()}
                                    disabled={deleteConfirmText !== "DELETE" || deleting}
                                >
                                    {deleting ? "Deleting…" : "Delete account"}
                                </Button>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </CardContent>
        </Card>
    );
}
