"use client";

import Link from "next/link";
import { Bell, BellRing, Check, CheckCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAlertsStore, selectUnacknowledgedCount } from "@/lib/stores/alertsStore";
import { describeRule } from "@/lib/alerts/evaluator";
import { cn } from "@/lib/utils";

function formatRelative(isoTime: string): string {
    const ms = Date.now() - new Date(isoTime).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function NotificationBell() {
    const triggers = useAlertsStore((s) => s.triggers);
    const unacknowledged = useAlertsStore(selectUnacknowledgedCount);
    const acknowledgeTrigger = useAlertsStore((s) => s.acknowledgeTrigger);
    const acknowledgeAll = useAlertsStore((s) => s.acknowledgeAll);
    const clearTriggers = useAlertsStore((s) => s.clearTriggers);

    const recent = triggers.slice(0, 20);
    const hasUnread = unacknowledged > 0;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="relative hover:bg-accent"
                    aria-label={hasUnread ? `${unacknowledged} unread alerts` : "Notifications"}
                >
                    {hasUnread ? (
                        <BellRing className="h-5 w-5 text-primary" aria-hidden="true" />
                    ) : (
                        <Bell className="h-5 w-5" aria-hidden="true" />
                    )}
                    {hasUnread && (
                        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                            {unacknowledged > 9 ? "9+" : unacknowledged}
                        </span>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 p-0">
                <div className="flex items-center justify-between px-3 pt-3 pb-2">
                    <DropdownMenuLabel className="p-0 text-base">Alerts</DropdownMenuLabel>
                    {triggers.length > 0 && (
                        <div className="flex items-center gap-1">
                            {hasUnread && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={acknowledgeAll}
                                >
                                    <CheckCheck className="h-3 w-3 mr-1" />
                                    Mark all read
                                </Button>
                            )}
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground"
                                onClick={clearTriggers}
                                aria-label="Clear all alerts"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    )}
                </div>
                <DropdownMenuSeparator className="m-0" />

                {recent.length === 0 ? (
                    <div className="flex flex-col items-center py-10 text-center px-4">
                        <Bell className="h-8 w-8 text-muted-foreground/40 mb-2" />
                        <p className="text-sm font-medium text-muted-foreground">No alerts yet</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                            Triggered alerts will show up here.
                        </p>
                    </div>
                ) : (
                    <div className="max-h-96 overflow-y-auto">
                        {recent.map((trigger) => (
                            <div
                                key={trigger.id}
                                className={cn(
                                    "flex items-start gap-2 px-3 py-2.5 border-b border-border last:border-b-0",
                                    !trigger.acknowledged && "bg-primary/5",
                                )}
                            >
                                <span
                                    className={cn(
                                        "mt-1.5 h-2 w-2 rounded-full flex-shrink-0",
                                        trigger.acknowledged ? "bg-muted-foreground/30" : "bg-primary",
                                    )}
                                    aria-hidden="true"
                                />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{trigger.ruleName}</p>
                                    <p className="text-xs text-muted-foreground font-mono">
                                        {describeRule(trigger)} → {formatObservedValue(trigger.metric, trigger.observedValue)}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                                        {formatRelative(trigger.triggeredAt)}
                                    </p>
                                </div>
                                {!trigger.acknowledged && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 w-6 p-0 flex-shrink-0"
                                        onClick={() => acknowledgeTrigger(trigger.id)}
                                        aria-label="Mark read"
                                    >
                                        <Check className="h-3.5 w-3.5" />
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <DropdownMenuSeparator className="m-0" />
                <div className="p-2">
                    <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
                        <Link href="/settings?tab=alerts">Manage alert rules →</Link>
                    </Button>
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function formatObservedValue(metric: string, value: number): string {
    if (metric === "price" || metric === "portfolio_value") {
        return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    const sign = value > 0 ? "+" : "";
    return `${sign}${(value * 100).toFixed(2)}%`;
}
