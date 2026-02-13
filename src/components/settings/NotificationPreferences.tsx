"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import { toast } from "sonner";

const notificationItems = [
    {
        key: "portfolioUpdates" as const,
        label: "Portfolio Updates",
        description: "Get notified about significant changes in your portfolio",
    },
    {
        key: "priceAlerts" as const,
        label: "Price Alerts",
        description: "Receive alerts when stocks reach your target prices",
    },
    {
        key: "strategySignals" as const,
        label: "Strategy Signals",
        description: "Get notified when your strategies generate signals",
    },
    {
        key: "accountSync" as const,
        label: "Account Sync",
        description: "Notifications about account synchronization status",
    },
    {
        key: "weeklySummary" as const,
        label: "Weekly Summary",
        description: "Receive a weekly performance summary email",
    },
];

export function NotificationPreferences() {
    const notifications = useSettingsStore((s) => s.notifications);
    const updateNotification = useSettingsStore((s) => s.updateNotification);

    const handleToggle = (key: keyof typeof notifications, value: boolean) => {
        updateNotification(key, value);
        toast.success("Notification preferences updated");
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                {notificationItems.map((item) => (
                    <div key={item.key} className="flex items-center justify-between space-x-2">
                        <Label htmlFor={item.key} className="flex flex-col space-y-1">
                            <span>{item.label}</span>
                            <span className="font-normal text-xs text-muted-foreground">
                                {item.description}
                            </span>
                        </Label>
                        <Switch
                            id={item.key}
                            checked={notifications[item.key]}
                            onCheckedChange={(v) => handleToggle(item.key, v)}
                        />
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}
