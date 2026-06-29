"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
        key: "alphaRadarSignals" as const,
        label: "Alpha Radar Signals",
        description: "Notify on material 13F changes tied to holdings, watchlist, or theses",
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
    const alphaRadarDelivery = useSettingsStore((s) => s.alphaRadarDelivery);
    const updateNotification = useSettingsStore((s) => s.updateNotification);
    const updateAlphaRadarDelivery = useSettingsStore((s) => s.updateAlphaRadarDelivery);
    const updateAlphaRadarDeliveryChannel = useSettingsStore((s) => s.updateAlphaRadarDeliveryChannel);

    const handleToggle = (key: keyof typeof notifications, value: boolean) => {
        updateNotification(key, value);
        toast.success("Notification preferences updated");
    };

    const handleAlphaRadarTickerFilters = (value: string) => {
        updateAlphaRadarDelivery({
            tickerFilters: value
                .split(",")
                .map((item) => item.trim().toUpperCase())
                .filter(Boolean),
        });
        toast.success("Alpha Radar delivery filters updated");
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
                <div className="space-y-4 border-t border-border pt-5" data-testid="alpha-radar-delivery-preferences">
                    <div>
                        <h3 className="text-sm font-semibold">Alpha Radar delivery</h3>
                        <p className="text-xs text-muted-foreground">
                            Configure scheduled 13F updates without enabling unapproved external senders.{" "}
                            <Link href="/help#alpha-radar-v2" data-testid="alpha-radar-delivery-help">
                                Read the guide.
                            </Link>
                        </p>
                    </div>

                    <div className="flex items-center justify-between space-x-2">
                        <Label htmlFor="alpha-radar-delivery-enabled" className="flex flex-col space-y-1">
                            <span>Scheduled delivery</span>
                            <span className="font-normal text-xs text-muted-foreground">
                                Allow weekly and quarterly Alpha Radar run updates
                            </span>
                        </Label>
                        <Switch
                            id="alpha-radar-delivery-enabled"
                            checked={alphaRadarDelivery.enabled}
                            onCheckedChange={(v) => {
                                updateAlphaRadarDelivery({ enabled: v });
                                toast.success("Alpha Radar delivery updated");
                            }}
                        />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        {[
                            ["inApp", "In-app"],
                            ["email", "Email"],
                            ["slack", "Slack"],
                            ["telegram", "Telegram"],
                        ].map(([key, label]) => (
                            <div key={key} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                                <Label htmlFor={`alpha-radar-delivery-${key}`} className="text-sm">
                                    {label}
                                </Label>
                                <Switch
                                    id={`alpha-radar-delivery-${key}`}
                                    checked={alphaRadarDelivery.channels[key as keyof typeof alphaRadarDelivery.channels]}
                                    onCheckedChange={(v) => {
                                        updateAlphaRadarDeliveryChannel(key as keyof typeof alphaRadarDelivery.channels, v);
                                        toast.success("Alpha Radar channel updated");
                                    }}
                                />
                            </div>
                        ))}
                    </div>

                    <div className="flex items-center justify-between space-x-2">
                        <Label htmlFor="alpha-radar-failure-summaries" className="flex flex-col space-y-1">
                            <span>Failure summaries</span>
                            <span className="font-normal text-xs text-muted-foreground">
                                Create one actionable status when scheduled runs fail
                            </span>
                        </Label>
                        <Switch
                            id="alpha-radar-failure-summaries"
                            checked={alphaRadarDelivery.failureSummaries}
                            onCheckedChange={(v) => {
                                updateAlphaRadarDelivery({ failureSummaries: v });
                                toast.success("Alpha Radar failure summaries updated");
                            }}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="alpha-radar-ticker-filters">Ticker filters</Label>
                        <Input
                            id="alpha-radar-ticker-filters"
                            aria-label="Alpha Radar delivery ticker filters"
                            value={alphaRadarDelivery.tickerFilters.join(", ")}
                            placeholder="AAPL, NVDA"
                            onChange={(event) => handleAlphaRadarTickerFilters(event.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Leave blank to deliver all material Alpha Radar updates.
                        </p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
