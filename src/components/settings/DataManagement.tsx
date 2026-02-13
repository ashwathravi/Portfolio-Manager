"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import { toast } from "sonner";

export function DataManagement() {
    const [deleteConfirmText, setDeleteConfirmText] = useState("");
    const [isExporting, setIsExporting] = useState(false);
    const resetSettings = useSettingsStore((s) => s.resetSettings);

    const handleExport = async () => {
        setIsExporting(true);
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const exportData = {
            exportedAt: new Date().toISOString(),
            profile: useSettingsStore.getState().profile,
            notifications: useSettingsStore.getState().notifications,
            tags: useSettingsStore.getState().tags,
            accounts: useSettingsStore.getState().accounts,
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `atlas-wealth-export-${new Date().toISOString().split("T")[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setIsExporting(false);
        toast.success("Data exported successfully");
    };

    const handleDeleteAccount = () => {
        resetSettings();
        setDeleteConfirmText("");
        toast.success("Account data has been reset");
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Data & Privacy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Data Encryption */}
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-medium">Data Encryption</h4>
                        <p className="text-sm text-muted-foreground">All your data is encrypted at rest and in transit</p>
                    </div>
                    <span className="text-sm font-medium text-primary">Enabled</span>
                </div>

                <hr className="border-border" />

                {/* Export Data */}
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-medium">Export Data</h4>
                        <p className="text-sm text-muted-foreground">Download all your portfolio and transaction data</p>
                    </div>
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="outline">
                                Export
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Export Your Data</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will download a JSON file containing your profile, settings, and trading data.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handleExport} disabled={isExporting}>
                                    {isExporting ? "Exporting..." : "Export"}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>

                <hr className="border-border" />

                {/* Delete Account */}
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-medium">Delete Account</h4>
                        <p className="text-sm text-muted-foreground">Permanently delete your account and all associated data</p>
                    </div>
                    <AlertDialog onOpenChange={() => setDeleteConfirmText("")}>
                        <AlertDialogTrigger asChild>
                            <Button variant="destructive">
                                Delete Account
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This action cannot be undone. This will permanently delete your account and all associated data.
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
                                />
                            </div>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                    onClick={handleDeleteAccount}
                                    disabled={deleteConfirmText !== "DELETE"}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    Delete Account
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </div>
            </CardContent>
        </Card>
    );
}
