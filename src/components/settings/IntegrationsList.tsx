"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link2, AlertCircle, RefreshCw, CheckCircle2, Plus } from "lucide-react";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import { toast } from "sonner";

const accountColors: Record<string, string> = {
    fidelity: "bg-green-600",
    vanguard: "bg-red-600",
    ibkr: "bg-blue-700",
};

const accountInitials: Record<string, string> = {
    fidelity: "F",
    vanguard: "V",
    ibkr: "IB",
};

export function IntegrationsList() {
    const accounts = useSettingsStore((s) => s.accounts);
    const syncAccount = useSettingsStore((s) => s.syncAccount);
    const reconnectAccount = useSettingsStore((s) => s.reconnectAccount);

    const stats = useMemo(() => {
        const connected = accounts.filter((a) => a.status === "reconciled").length;
        const totalValue = accounts.reduce((sum, a) => sum + a.accountValue, 0);
        const totalHoldings = accounts.reduce((sum, a) => sum + a.holdings, 0);
        const needsReview = accounts.filter((a) => a.status === "needs-review" || a.status === "error").length;
        return { connected, total: accounts.length, totalValue, totalHoldings, needsReview };
    }, [accounts]);

    const handleSync = (id: string, name: string) => {
        syncAccount(id);
        toast.success(`Syncing ${name}...`);
    };

    const handleReconnect = (id: string, name: string) => {
        reconnectAccount(id);
        toast.success(`Reconnected to ${name}`);
    };

    const formatCurrency = (value: number) =>
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

    return (
        <div className="space-y-6">
            {/* Overview Cards */}
            <div className="grid grid-cols-4 gap-4">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-muted-foreground">Connected Accounts</span>
                            <Link2 className="h-5 w-5 text-primary" />
                        </div>
                        <p className="text-3xl font-bold">{stats.connected}</p>
                        <p className="text-xs text-muted-foreground mt-1">{stats.total} total</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-muted-foreground">Total Value</span>
                        </div>
                        <p className="text-3xl font-bold">{formatCurrency(stats.totalValue)}</p>
                        <p className="text-xs text-muted-foreground mt-1">Across all accounts</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-muted-foreground">Total Holdings</span>
                        </div>
                        <p className="text-3xl font-bold">{stats.totalHoldings}</p>
                        <p className="text-xs text-muted-foreground mt-1">Unique positions</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-muted-foreground">Needs Review</span>
                            {stats.needsReview > 0 && (
                                <AlertCircle className="h-5 w-5 text-amber-500" />
                            )}
                        </div>
                        <p className="text-3xl font-bold">{stats.needsReview}</p>
                        <p className="text-xs text-muted-foreground mt-1">Reconciliation items</p>
                    </CardContent>
                </Card>
            </div>

            {/* Connected Accounts List */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle>Connected Accounts</CardTitle>
                    <Button
                        size="sm"
                        onClick={() => toast.info("Account linking coming soon")}
                    >
                        <Plus className="h-4 w-4 mr-1.5" />
                        Link Account
                    </Button>
                </CardHeader>
                <CardContent className="space-y-4">
                    {accounts.map((account) => (
                        <div key={account.id} className="border rounded-lg p-4">
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-4">
                                    {/* Account icon */}
                                    <div
                                        className={`h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${
                                            accountColors[account.id] || "bg-gray-600"
                                        }`}
                                    >
                                        {accountInitials[account.id] || account.name.charAt(0)}
                                    </div>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h4 className="font-medium">{account.name}</h4>
                                            {account.status === "reconciled" ? (
                                                <Badge
                                                    variant="secondary"
                                                    className="bg-primary/10 text-primary hover:bg-primary/10 gap-1"
                                                >
                                                    <CheckCircle2 className="h-3 w-3" />
                                                    Reconciled
                                                </Badge>
                                            ) : (
                                                <Badge
                                                    variant="secondary"
                                                    className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 gap-1"
                                                >
                                                    <AlertCircle className="h-3 w-3" />
                                                    Needs Review
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="text-sm text-muted-foreground mt-0.5">
                                            {account.type} {account.accountMask}
                                        </p>

                                        {/* Stats row */}
                                        {account.status === "reconciled" && (
                                            <div className="flex items-center gap-6 mt-3">
                                                <div>
                                                    <p className="text-xs text-muted-foreground">Holdings</p>
                                                    <p className="text-sm font-medium">{account.holdings} positions</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground">Account Value</p>
                                                    <p className="text-sm font-medium">{formatCurrency(account.accountValue)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-muted-foreground">Last Synced</p>
                                                    <p className="text-sm font-medium">{account.lastSynced}</p>
                                                </div>
                                            </div>
                                        )}

                                        {/* Error message */}
                                        {account.errorMessage && (
                                            <p className="text-sm text-destructive mt-2">
                                                {account.errorMessage}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Action buttons */}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleSync(account.id, account.name)}
                                    >
                                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                                        Sync Now
                                    </Button>
                                    {(account.status === "needs-review" || account.status === "error") && (
                                        <Button
                                            size="sm"
                                            onClick={() => handleReconnect(account.id, account.name)}
                                        >
                                            Reconnect
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>
        </div>
    );
}
