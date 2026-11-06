"use client";

import { useState } from "react";
import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
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
import { describeRule } from "@/lib/alerts/evaluator";
import {
    useAlertRules,
    useCreateAlertRule,
    useDeleteAlertRule,
    useUpdateAlertRule,
    type AlertRuleBody,
} from "@/lib/alerts/queries";
import type { AlertRule, AlertMetric } from "@/lib/alerts/types";
import { needsSymbol } from "@/lib/validators/alerts";
import { alertRuleSchema, type AlertRuleFormValues } from "@/lib/validators/settings";
import { toast } from "sonner";

const METRIC_OPTIONS: Array<{ value: AlertMetric; label: string; requiresSymbol: boolean; unit: "money" | "pct" | "score" }> = [
    { value: "price", label: "Price", requiresSymbol: true, unit: "money" },
    { value: "price_change_pct", label: "Daily % change", requiresSymbol: true, unit: "pct" },
    { value: "portfolio_value", label: "Portfolio value", requiresSymbol: false, unit: "money" },
    { value: "portfolio_day_change_pct", label: "Portfolio day change %", requiresSymbol: false, unit: "pct" },
    { value: "alpha_radar_new_position", label: "Alpha Radar: new position", requiresSymbol: false, unit: "score" },
    { value: "alpha_radar_exit", label: "Alpha Radar: exit", requiresSymbol: false, unit: "score" },
    { value: "alpha_radar_large_add", label: "Alpha Radar: large add", requiresSymbol: false, unit: "score" },
    { value: "alpha_radar_large_trim", label: "Alpha Radar: large trim", requiresSymbol: false, unit: "score" },
    { value: "alpha_radar_user_overlap", label: "Alpha Radar: user overlap", requiresSymbol: false, unit: "score" },
];

const COMPARATOR_OPTIONS = [
    { value: "gte", label: "≥" },
    { value: "lte", label: "≤" },
    { value: "gt", label: ">" },
    { value: "lt", label: "<" },
    { value: "eq", label: "=" },
] as const;

const REARM_OPTIONS = [
    { value: "daily", label: "Each evening it holds" },
    { value: "once", label: "Once, then pause" },
    { value: "always", label: "Every Alpha Radar change" },
] as const;

const REARM_BADGES: Record<AlertRule["rearm"], string> = {
    daily: "Each evening",
    once: "Once",
    always: "Every change",
};

function toBody(values: AlertRuleFormValues): AlertRuleBody {
    return {
        name: values.name,
        metric: values.metric,
        ...(needsSymbol(values.metric) && values.symbol ? { symbol: values.symbol.toUpperCase() } : {}),
        comparator: values.comparator,
        threshold: values.threshold,
        enabled: values.enabled,
        rearm: values.rearm,
        ...(values.note ? { note: values.note } : {}),
    };
}

function ruleBody(rule: AlertRule): AlertRuleBody {
    return {
        name: rule.name,
        metric: rule.metric,
        ...(rule.symbol ? { symbol: rule.symbol } : {}),
        comparator: rule.comparator,
        threshold: rule.threshold,
        enabled: rule.enabled,
        rearm: rule.rearm,
        ...(rule.note ? { note: rule.note } : {}),
    };
}

function formatFired(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const defaultFormValues: AlertRuleFormValues = {
    name: "",
    metric: "price",
    symbol: "",
    comparator: "gte",
    threshold: 0,
    enabled: true,
    rearm: "daily",
    note: "",
};

/**
 * Settings › Alerts: the user's alert rules, kept with the account and
 * checked by the nightly alerts job (launch item i57).
 */
export function AlertRulesManager() {
    const rulesQuery = useAlertRules();
    const createRule = useCreateAlertRule();
    const updateRule = useUpdateAlertRule();
    const deleteRule = useDeleteAlertRule();
    const rules = rulesQuery.data?.rules ?? [];
    const stored = rulesQuery.data?.stored ?? true;
    const atLimit = rulesQuery.data ? rules.length >= rulesQuery.data.limit : false;
    const saving = createRule.isPending || updateRule.isPending;

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<AlertRule | null>(null);

    const {
        control,
        register,
        handleSubmit,
        reset,
        formState: { errors },
    } = useForm<AlertRuleFormValues>({
        resolver: zodResolver(alertRuleSchema),
        defaultValues: defaultFormValues,
    });

    const watchedMetric = useWatch({ control, name: "metric" });
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

    const onSubmit = async (values: AlertRuleFormValues) => {
        const rule = toBody(values);
        try {
            if (editing) {
                await updateRule.mutateAsync({ id: editing.id, rule });
                toast.success(`Alert "${values.name}" updated`);
            } else {
                await createRule.mutateAsync(rule);
                toast.success(`Alert "${values.name}" created`);
            }
            setDialogOpen(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Couldn't save the alert. Try again.");
        }
    };

    const toggleRule = (rule: AlertRule) => {
        updateRule.mutate(
            { id: rule.id, rule: { ...ruleBody(rule), enabled: !rule.enabled } },
            { onError: (error) => toast.error(error.message) },
        );
    };

    const handleDelete = (rule: AlertRule) => {
        deleteRule.mutate(rule.id, {
            onSuccess: () => toast.success(`Alert "${rule.name}" deleted`),
            onError: (error) => toast.error(error.message),
        });
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                    <CardTitle>Alert Rules</CardTitle>
                    <CardDescription className="mt-1.5">
                        Get a notification when a close, your accounts, or an Alpha Radar change crosses a threshold.
                        Rules are kept with your account and checked each weekday evening after the close.{" "}
                        <Link href="/help#alpha-radar-v1" data-testid="alpha-radar-alert-help">
                            Read the Alpha Radar guide.
                        </Link>
                    </CardDescription>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm" onClick={openAdd} disabled={!stored || atLimit || !rulesQuery.isSuccess}>
                            <Plus className="h-4 w-4 mr-1.5" />
                            New Alert
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-lg">
                        <DialogHeader>
                            <DialogTitle>{editing ? "Edit alert" : "New alert"}</DialogTitle>
                            <DialogDescription>
                                Checked each weekday evening on that day&apos;s closing prices, and on Alpha Radar 13F changes stored since the last check.
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
                                        Threshold {metricMeta?.unit === "pct" ? "(fraction, 0.05 = 5%)" : metricMeta?.unit === "money" ? "($)" : metricMeta?.unit === "score" ? "(materiality score 0-100)" : ""}
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
                                <Button type="submit" disabled={saving}>{editing ? "Save" : "Create"}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                {atLimit && (
                    <p className="mb-3 text-xs text-muted-foreground" data-testid="alert-rule-limit">
                        You have {rulesQuery.data?.limit} rules, the most an account can have. Delete one to add another.
                    </p>
                )}
                {rulesQuery.isPending ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">Loading your alerts…</p>
                ) : rulesQuery.isError ? (
                    <p className="py-12 text-center text-sm text-muted-foreground" role="alert">
                        Couldn&apos;t load your alerts. Reload the page to try again.
                    </p>
                ) : !stored ? (
                    <p className="py-12 text-center text-sm text-muted-foreground" data-testid="alerts-not-stored">
                        Alert rules are kept with your account, and this server has no database, so none can be saved here.
                    </p>
                ) : rules.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <BellOff className="h-10 w-10 text-muted-foreground/50 mb-3" />
                        <p className="text-sm font-medium text-muted-foreground">No alerts yet</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                            Create an alert to hear when a close or your accounts cross a level.
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
                                            {REARM_BADGES[rule.rearm]}
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1 font-mono">
                                        {describeRule(rule)}
                                    </p>
                                    {rule.note && (
                                        <p className="text-xs text-muted-foreground/80 mt-1">{rule.note}</p>
                                    )}
                                    <p className="text-xs text-muted-foreground/80 mt-1">
                                        {rule.lastTriggeredAt ? `Last fired ${formatFired(rule.lastTriggeredAt)}` : "Hasn't fired yet"}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Switch
                                        checked={rule.enabled}
                                        onCheckedChange={() => toggleRule(rule)}
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
                                                    This removes the rule and the alerts it raised.
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
