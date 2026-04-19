"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Download } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { computeAttribution, type AttributionSegment } from "@/lib/performance/attribution";
import { exportToCsv } from "@/lib/exportCsv";
import { cn } from "@/lib/utils";

interface AttributionBreakdownProps {
    sectors: AttributionSegment[];
    assetClasses: AttributionSegment[];
}

type ViewMode = "sector" | "assetClass";

function formatPercent(value: number, fractionDigits = 2) {
    const pct = value * 100;
    const sign = pct > 0 ? "+" : "";
    return `${sign}${pct.toFixed(fractionDigits)}%`;
}

function formatPercentPlain(value: number, fractionDigits = 1) {
    return `${(value * 100).toFixed(fractionDigits)}%`;
}

function deltaClass(value: number) {
    if (value > 1e-9) return "text-primary";
    if (value < -1e-9) return "text-destructive";
    return "text-muted-foreground";
}

export function AttributionBreakdown({ sectors, assetClasses }: AttributionBreakdownProps) {
    const [mode, setMode] = useState<ViewMode>("sector");
    const segments = mode === "sector" ? sectors : assetClasses;
    const summary = useMemo(() => computeAttribution(segments), [segments]);

    const maxWeight = Math.max(
        ...summary.segments.flatMap((s) => [s.portfolioWeight, s.benchmarkWeight]),
        0.01,
    );

    const sorted = [...summary.segments].sort((a, b) => b.portfolioWeight - a.portfolioWeight);

    const handleExport = () => {
        exportToCsv(
            `attribution-${mode === "sector" ? "sector" : "asset-class"}.csv`,
            sorted.map((s) => ({
                Segment: s.label,
                PortfolioWeight: formatPercentPlain(s.portfolioWeight),
                BenchmarkWeight: formatPercentPlain(s.benchmarkWeight),
                PortfolioReturn: formatPercent(s.portfolioReturn),
                BenchmarkReturn: formatPercent(s.benchmarkReturn),
                Contribution: formatPercent(s.contribution),
                Allocation: formatPercent(s.allocationEffect),
                Selection: formatPercent(s.selectionEffect),
                Interaction: formatPercent(s.interactionEffect),
                Total: formatPercent(s.totalEffect),
            })),
        );
    };

    return (
        <Card className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                <div>
                    <h3 className="font-semibold text-lg">Performance Attribution</h3>
                    <p className="text-sm text-muted-foreground">
                        Brinson-style decomposition of alpha into allocation, selection, and interaction effects
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-lg border border-border p-1 bg-muted/30">
                        <button
                            type="button"
                            onClick={() => setMode("sector")}
                            className={cn(
                                "px-3 py-1 text-sm rounded-md transition-colors",
                                mode === "sector"
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                            aria-pressed={mode === "sector"}
                        >
                            Sector
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode("assetClass")}
                            className={cn(
                                "px-3 py-1 text-sm rounded-md transition-colors",
                                mode === "assetClass"
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                            aria-pressed={mode === "assetClass"}
                        >
                            Asset Class
                        </button>
                    </div>
                    <button
                        onClick={handleExport}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border hover:border-primary/40 transition-colors"
                    >
                        <Download className="h-4 w-4" />
                        Export
                    </button>
                </div>
            </div>

            {/* Summary strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <SummaryStat label="Portfolio Return" value={formatPercent(summary.total.portfolioReturn)} />
                <SummaryStat label="Benchmark Return" value={formatPercent(summary.total.benchmarkReturn)} />
                <SummaryStat
                    label="Alpha"
                    value={formatPercent(summary.total.alpha)}
                    valueClass={deltaClass(summary.total.alpha)}
                />
                <SummaryStat
                    label="Selection Effect"
                    value={formatPercent(summary.total.selectionEffect)}
                    valueClass={deltaClass(summary.total.selectionEffect)}
                />
            </div>

            {/* Weight comparison bars */}
            <div className="space-y-3 mb-6">
                <h4 className="text-sm font-medium text-muted-foreground">Weight: Portfolio vs Benchmark</h4>
                <div className="space-y-2">
                    {sorted.map((segment) => {
                        const portfolioBar = (segment.portfolioWeight / maxWeight) * 100;
                        const benchmarkBar = (segment.benchmarkWeight / maxWeight) * 100;
                        const weightDiff = segment.portfolioWeight - segment.benchmarkWeight;
                        return (
                            <div key={segment.key} className="grid grid-cols-[140px_1fr_80px] items-center gap-3">
                                <div className="text-sm font-medium truncate" title={segment.label}>
                                    {segment.label}
                                </div>
                                <div className="relative h-6">
                                    <div
                                        className="absolute top-0 left-0 h-2.5 bg-primary/70 rounded-sm"
                                        style={{ width: `${portfolioBar}%` }}
                                        aria-label={`Portfolio weight ${formatPercentPlain(segment.portfolioWeight)}`}
                                    />
                                    <div
                                        className="absolute bottom-0 left-0 h-2.5 bg-muted-foreground/40 rounded-sm"
                                        style={{ width: `${benchmarkBar}%` }}
                                        aria-label={`Benchmark weight ${formatPercentPlain(segment.benchmarkWeight)}`}
                                    />
                                </div>
                                <div className="text-right text-sm font-mono">
                                    <span className={deltaClass(weightDiff)}>
                                        {weightDiff >= 0 ? "+" : ""}
                                        {(weightDiff * 100).toFixed(1)}pp
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                    <div className="flex items-center gap-1.5">
                        <span className="h-2 w-4 bg-primary/70 rounded-sm" />
                        Portfolio
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="h-2 w-4 bg-muted-foreground/40 rounded-sm" />
                        Benchmark
                    </div>
                </div>
            </div>

            {/* Full breakdown table */}
            <div className="rounded-md border overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{mode === "sector" ? "Sector" : "Asset Class"}</TableHead>
                            <TableHead className="text-right">Port. Wt.</TableHead>
                            <TableHead className="text-right">Bench. Wt.</TableHead>
                            <TableHead className="text-right">Port. Ret.</TableHead>
                            <TableHead className="text-right">Bench. Ret.</TableHead>
                            <TableHead className="text-right">Allocation</TableHead>
                            <TableHead className="text-right">Selection</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sorted.map((s) => (
                            <TableRow key={s.key}>
                                <TableCell className="font-medium">{s.label}</TableCell>
                                <TableCell className="text-right font-mono">{formatPercentPlain(s.portfolioWeight)}</TableCell>
                                <TableCell className="text-right font-mono text-muted-foreground">
                                    {formatPercentPlain(s.benchmarkWeight)}
                                </TableCell>
                                <TableCell className={cn("text-right font-mono", deltaClass(s.portfolioReturn))}>
                                    {formatPercent(s.portfolioReturn)}
                                </TableCell>
                                <TableCell className="text-right font-mono text-muted-foreground">
                                    {formatPercent(s.benchmarkReturn)}
                                </TableCell>
                                <TableCell className={cn("text-right font-mono", deltaClass(s.allocationEffect))}>
                                    {formatPercent(s.allocationEffect)}
                                </TableCell>
                                <TableCell className={cn("text-right font-mono", deltaClass(s.selectionEffect))}>
                                    {formatPercent(s.selectionEffect)}
                                </TableCell>
                                <TableCell className={cn("text-right font-mono font-semibold", deltaClass(s.totalEffect))}>
                                    {formatPercent(s.totalEffect)}
                                </TableCell>
                            </TableRow>
                        ))}
                        <TableRow className="bg-muted/30 font-semibold">
                            <TableCell>Total</TableCell>
                            <TableCell className="text-right font-mono">
                                {formatPercentPlain(sorted.reduce((sum, s) => sum + s.portfolioWeight, 0))}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                                {formatPercentPlain(sorted.reduce((sum, s) => sum + s.benchmarkWeight, 0))}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                                {formatPercent(summary.total.portfolioReturn)}
                            </TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                                {formatPercent(summary.total.benchmarkReturn)}
                            </TableCell>
                            <TableCell className={cn("text-right font-mono", deltaClass(summary.total.allocationEffect))}>
                                {formatPercent(summary.total.allocationEffect)}
                            </TableCell>
                            <TableCell className={cn("text-right font-mono", deltaClass(summary.total.selectionEffect))}>
                                {formatPercent(summary.total.selectionEffect)}
                            </TableCell>
                            <TableCell className={cn("text-right font-mono", deltaClass(summary.total.alpha))}>
                                {formatPercent(summary.total.alpha)}
                            </TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            </div>
        </Card>
    );
}

interface SummaryStatProps {
    label: string;
    value: string;
    valueClass?: string;
}

function SummaryStat({ label, value, valueClass }: SummaryStatProps) {
    return (
        <div className="rounded-lg border border-border p-3 bg-muted/20">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={cn("text-xl font-bold tabular-nums", valueClass)}>{value}</p>
        </div>
    );
}
