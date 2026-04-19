"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, BellRing, BellOff } from "lucide-react";
import { useAlertsStore } from "@/lib/stores/alertsStore";
import { describeRule } from "@/lib/alerts/evaluator";
import type { AlertRule, AlertMetric } from "@/lib/alerts/types";
import { alertRuleSchema, type AlertRuleFormValues } from "@/lib/validators/settings";
import { toast } from "sonner";

const METRIC_OPTIONS: Array<{ value: AlertMetric; label: string; requiresSymbol: boolean; isPct: boolean }> = [
    { value: "price", label: "Price", requiresSymbol: true, isPct: false },
    { value: "price_change_pct", label: "Daily % change", requiresSymbol: true, isPct: true },
    { value: "portfolio_value", label: "Portfolio value", requiresSymbol: false, isPct: false },
    { value: "portfolio_day_change_pct", label: "Portfolio day change %", requiresSymbol: false, isPct: true },
];

const COMPARATOR_OPTIONS = [
    { value: "gte", label: "≥" },
    { value: "lte", label: "≤" },
    { value: "gt", label: ">" },
    { value: "lt", label: "<" },
    { value: "eq", label: "=" },
] as const;

const REARM_OPTIONS = [
    { value: "once", label: "Once (then disable)" },
    { value: "always", label: "Always" },
    { value: "daily", label: "Daily (max once/day)" },
] as const;

const defaultFormValues: AlertRuleFormValues = {
    name: "",
    metric: "price",
    symbol: "",
    comparator: "gte",
    threshold: 0,
    enabled: true,
    rearm: "always",
    note: "",
};

export function AlertRulesManager() {
    const rules = useAlertsStore((s) => s.rules);
    const addRule = useAlertsStore((s) => s.addRule);
    const updateRule = useAlertsStore((s) => s.updateRule);
    const deleteRule = useAlertsStore((s) => s.deleteRule);
    const toggleRule = useAlertsStore((s) => s.toggleRule);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<AlertRule | null>(null);

    const {
        control,
        register,
        handleSubmit,
        reset,
        watch,
        formState: { errors },
    } = useForm<AlertRuleFormValues>({
        resolver: zodResolver(alertRuleSchema),
        defaultValues: defaultFormValues,
    });

    const watchedMetric = watch("metric");
    const metricMeta = METRIC_OPTIONS.find((m) => m.value === watchedMetric);

    const openAdd = () => {
        setEditing(null);
        reset(defaultFormValues);
        setDialogOpen(true);
    };

    const openEdit = (rule: AlertRule) => {
        setEditing(rule);
        reset({
            name: rule.name,
            metric: rule.metric,
            symbol: rule.symbol ?? "",
            comparator: rule.comparator,
            threshold: rule.threshold,
            enabled: rule.enabled,
            rearm: rule.rearm,
            note: rule.note ?? "",
        });
        setDialogOpen(true);
    };

    const onSubmit = (values: AlertRuleFormValues) => {
        const needsSymbol = values.metric === "price" || values.metric === "price_change_pct";
        const cleaned = {
            name: values.name,
            metric: values.metric,
            symbol: needsSymbol ? values.symbol?.toUpperCase() || undefined : undefined,
            comparator: values.comparator,
            threshold: values.threshold,
            enabled: values.enabled,
            rearm: values.rearm,
            note: values.note || undefined,
        };

        if (editing) {
            updateRule(editing.id, cleaned);
            toast.success(`Alert "${values.name}" updated`);
        } else {
            addRule(cleaned);
            toast.success(`Alert "${values.name}" created`);
        }
        setDialogOpen(false);
    };

    const handleDelete = (rule: AlertRule) => {
        deleteRule(rule.id);
        toast.success(`Alert "${rule.name}" deleted`);
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                    <CardTitle>Alert Rules</CardTitle>
                    <CardDescription className="mt-1.5">
                        Fire a notification when a price or portfolio metric crosses a threshold.
                    </CardDescription>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm" onClick={openAdd}>
                            <Plus className="h-4 w-4 mr-1.5" />
                            New Alert
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-lg">
                        <DialogHeader>
                            <DialogTitle>{editing ? "Edit alert" : "New alert"}</DialogTitle>
                            <DialogDescription>
                                Threshold rules are evaluated against live market snapshots.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="alert-name">Name</Label>
                                <Input
                                    id="alert-name"
                                    placeholder="e.g., AAPL above $200"
                                    {...register("name")}
                                />
                                {errors.name && (
                                    <p className="text-sm text-destructive">{errors.name.message}</p>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Metric</Label>
                                    <Controller
                                        control={control}
                                        name="metric"
                                        render={({ field }) => (
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {METRIC_OPTIONS.map((opt) => (
                                                        <SelectItem key={opt.value} value={opt.value}>
                                                            {opt.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="alert-symbol">Symbol {metricMeta?.requiresSymbol ? "" : "(ignored)"}</Label>
                                    <Input
                                        id="alert-symbol"
                                        placeholder="AAPL"
                                        disabled={!metricMeta?.requiresSymbol}
                                        {...register("symbol")}
                                    />
                                    {errors.symbol && (
                                        <p className="text-sm text-destructive">{errors.symbol.message}</p>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Comparator</Label>
                                    <Controller
                                        control={control}
                                        name="comparator"
                                        render={({ field }) => (
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {COMPARATOR_OPTIONS.map((opt) => (
                                                        <SelectItem key={opt.value} value={opt.value}>
                                                            {opt.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="alert-threshold">
                                        Threshold {metricMeta?.isPct ? "(fraction, 0.05 = 5%)" : metricMeta?.value === "portfolio_value" || metricMeta?.value === "price" ? "($)" : ""}
                                    </Label>
                                    <Input
                                        id="alert-threshold"
                                        type="number"
                                        step="any"
                                        {...register("threshold", { valueAsNumber: true })}
                                    />
                                    {errors.threshold && (
                                        <p className="text-sm text-destructive">{errors.threshold.message}</p>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Rearm</Label>
                                <Controller
                                    control={control}
                                    name="rearm"
                                    render={({ field }) => (
                                        <Select value={field.value} onValueChange={field.onChange}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {REARM_OPTIONS.map((opt) => (
                                                    <SelectItem key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="alert-note">Note (optional)</Label>
                                <Input
                                    id="alert-note"
                                    placeholder="What should you do when this fires?"
                                    {...register("note")}
                                />
                                {errors.note && (
                                    <p className="text-sm text-destructive">{errors.note.message}</p>
                                )}
                            </div>

                            <div className="flex items-center justify-between rounded-lg border p-3">
                                <div>
                                    <p className="text-sm font-medium">Enabled</p>
                                    <p className="text-xs text-muted-foreground">Paused rules won&apos;t fire.</p>
                                </div>
                                <Controller
                                    control={control}
                                    name="enabled"
                                    render={({ field }) => (
                                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                                    )}
                                />
                            </div>

                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                                    Cancel
                                </Button>
                                <Button type="submit">{editing ? "Save" : "Create"}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                {rules.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <BellOff className="h-10 w-10 text-muted-foreground/50 mb-3" />
                        <p className="text-sm font-medium text-muted-foreground">No alerts yet</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                            Create an alert to get notified when prices move.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {rules.map((rule) => (
                            <div
                                key={rule.id}
                                className="flex items-center justify-between gap-3 p-3 border rounded-lg"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <BellRing className={rule.enabled ? "h-4 w-4 text-primary" : "h-4 w-4 text-muted-foreground"} />
                                        <span className="font-medium text-sm truncate">{rule.name}</span>
                                        {!rule.enabled && (
                                            <Badge variant="outline" className="text-xs text-muted-foreground">
                                                Paused
                                            </Badge>
                                        )}
                                        <Badge variant="secondary" className="text-xs">
                                            {rule.rearm}
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1 font-mono">
                                        {describeRule(rule)}
                                    </p>
                                    {rule.note && (
                                        <p className="text-xs text-muted-foreground/80 mt-1">{rule.note}</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-1">
                                    <Switch
                                        checked={rule.enabled}
                                        onCheckedChange={() => toggleRule(rule.id)}
                                        aria-label={`Toggle ${rule.name}`}
                                    />
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0"
                                        onClick={() => openEdit(rule)}
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                        <span className="sr-only">Edit {rule.name}</span>
                                    </Button>
                                    <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                                <span className="sr-only">Delete {rule.name}</span>
                                            </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Delete &ldquo;{rule.name}&rdquo;?</AlertDialogTitle>
                                                <AlertDialogDescription>
                                                    This removes the rule and its trigger history.
                                                </AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction
                                                    onClick={() => handleDelete(rule)}
                                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                                >
                                                    Delete
                                                </AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                    </AlertDialog>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
