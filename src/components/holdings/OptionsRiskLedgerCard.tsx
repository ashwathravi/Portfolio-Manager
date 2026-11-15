"use client";

import { AlertTriangle, Plus, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
    computeOptionRiskLedger,
    type OptionRiskStatus,
} from "@/lib/risk-policy";
import {
    describeOptionContract,
    toOptionRiskPosition,
    type LoadedOptionPosition,
    type OptionMark,
} from "@/lib/portfolio/option-positions";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import { OptionPositionDialog, type OptionAccountOption, type OptionThesisOption } from "./OptionPositionDialog";

export interface OptionsRiskLedgerCardProps {
    /** The user's option positions (launch item i63). */
    positions: readonly LoadedOptionPosition[];
    totalPortfolioValue: number;
    liquidNetWorth?: number;
    /** The user's accounts, for adding and moving positions. */
    accounts: readonly OptionAccountOption[];
    /** The user's theses, to link a position to. */
    theses: readonly OptionThesisOption[];
}

const STATUS_LABELS: Record<OptionRiskStatus, string> = {
    inside: "Inside policy",
    watch: "Watch",
    breached: "Breached",
    missing_data: "Missing data",
};

/** Where a mark comes from, as the ledger says it: "Close Oct 1", "Your price Oct 2", "At cost". */
export function describeOptionMark(mark: OptionMark): string {
    if (mark.source === "cost") return "At cost: no price yet";
    const [year, month, day] = mark.date.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return mark.source === "close" ? `Close ${date}` : `Your price ${date}`;
}

export function OptionsRiskLedgerCard({
    positions,
    totalPortfolioValue,
    liquidNetWorth,
    accounts,
    theses,
}: OptionsRiskLedgerCardProps) {
    const router = useRouter();
    const optionsRiskPolicy = useSettingsStore((s) => s.riskPolicy.optionsRiskPolicy);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<LoadedOptionPosition | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const ledger = useMemo(
        () =>
            computeOptionRiskLedger({
                positions: positions.map(toOptionRiskPosition),
                totalPortfolioValue,
                liquidNetWorth,
                policy: optionsRiskPolicy,
            }),
        [positions, totalPortfolioValue, liquidNetWorth, optionsRiskPolicy],
    );
    const byId = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);

    const openDialog = (position: LoadedOptionPosition | null) => {
        setEditing(position);
        setDialogOpen(true);
    };

    const remove = async (position: LoadedOptionPosition) => {
        const label = describeOptionContract(position);
        if (!window.confirm(`Delete ${label} from ${position.account}? This can't be undone.`)) return;
        setDeleting(position.id);
        try {
            const response = await fetch(`/api/portfolio/options/${position.id}`, { method: "DELETE", credentials: "same-origin" });
            if (!response.ok && response.status !== 404) throw new Error(String(response.status));
            toast.success(`Deleted ${label}.`);
            router.refresh();
        } catch {
            toast.error("Couldn't delete the option position. Try again.");
        } finally {
            setDeleting(null);
        }
    };

    return (
        <section
            className="pm-card pm-card-stack pm-options-ledger"
            data-testid="options-risk-ledger"
            data-status={positions.length === 0 ? "empty" : ledger.status}
            aria-labelledby="pm-options-ledger-head"
        >
            <header className="pm-card-header pm-options-ledger-head">
                <div>
                    <p className="pm-risk-policy-eyebrow">
                        {ledger.status === "breached" ? (
                            <AlertTriangle size={14} aria-hidden="true" />
                        ) : (
                            <ShieldCheck size={14} aria-hidden="true" />
                        )}
                        <span>Options risk ledger</span>
                    </p>
                    <h3 id="pm-options-ledger-head" className="pm-card-title">
                        LEAPS and option premium at risk
                    </h3>
                    <p className="pm-card-subtitle">
                        {positions.length === 0
                            ? "Add the option positions you hold, or import them with your broker's positions CSV, to check them against your options policy."
                            : ledger.actionPrompts[0]}
                    </p>
                </div>
                <div className="pm-options-ledger-actions">
                    {positions.length > 0 && (
                        <div className="pm-options-ledger-summary" aria-label="Options exposure summary">
                            <Metric label="Premium risk" value={fmtCurrency0(ledger.totalPremiumAtRisk)} />
                            <Metric label="Portfolio" value={`${ledger.totalPremiumPctOfPortfolio.toFixed(1)}%`} />
                            <Metric label="Value" value={fmtCurrency0(ledger.totalCurrentValue)} />
                        </div>
                    )}
                    <button
                        type="button"
                        className="pm-btn pm-btn-ghost"
                        disabled={accounts.length === 0}
                        onClick={() => openDialog(null)}
                    >
                        <Plus size={14} aria-hidden="true" />
                        <span>Add option</span>
                    </button>
                </div>
            </header>

            <div className="pm-options-ledger-table-wrap">
                <table className="pm-options-ledger-table">
                    <thead>
                        <tr>
                            <th scope="col">Contract</th>
                            <th scope="col">Expiry</th>
                            <th scope="col" className="num">Price / share</th>
                            <th scope="col" className="num">Value</th>
                            <th scope="col" className="num">Premium risk</th>
                            <th scope="col" className="num">Portfolio</th>
                            <th scope="col">Thesis / rule</th>
                            <th scope="col">Status</th>
                            <th scope="col"><span className="sr-only">Actions</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        {ledger.rows.length === 0 ? (
                            <tr>
                                <td colSpan={9} className="pm-options-ledger-empty" data-testid="options-ledger-empty">
                                    No option positions yet.
                                </td>
                            </tr>
                        ) : (
                            ledger.rows.map((row) => {
                                const position = byId.get(row.id)!;
                                return (
                                    <tr
                                        key={row.id}
                                        data-testid="options-risk-row"
                                        data-status={row.status}
                                    >
                                        <td>
                                            <div className="pm-options-contract">
                                                <span className="pm-options-contract-symbol">{row.symbol}</span>
                                                <span className="pm-options-contract-sub">
                                                    {Math.abs(row.quantity)} {row.direction} {row.contractType.toUpperCase()}
                                                    {Math.abs(row.quantity) === 1 ? " contract" : " contracts"} · {position.account}
                                                </span>
                                            </div>
                                        </td>
                                        <td>
                                            <div className="pm-options-contract">
                                                <span className="pm-options-contract-symbol">{row.expiry}</span>
                                                <span className="pm-options-contract-sub">
                                                    {row.daysToExpiry >= 0 ? `${row.daysToExpiry} days` : "Expired"}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="num">
                                            <div className="pm-options-contract">
                                                <span>{fmtPrice(position.mark.price)}</span>
                                                <span className="pm-options-contract-sub" data-testid="option-mark-source">
                                                    {describeOptionMark(position.mark)}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="num">{fmtCurrency0(row.currentValue)}</td>
                                        <td className="num">{fmtCurrency0(row.premiumAtRisk)}</td>
                                        <td className="num">{row.premiumPctOfPortfolio.toFixed(1)}%</td>
                                        <td>
                                            <div className="pm-options-thesis">
                                                <span>{row.thesisTitle ?? "No linked thesis"}</span>
                                                <span>{row.plannedExitRule ?? "No exit rule"}</span>
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`pm-policy-chip is-${row.status}`}>
                                                {STATUS_LABELS[row.status]}
                                            </span>
                                        </td>
                                        <td>
                                            <div className="pm-options-row-actions">
                                                <button
                                                    type="button"
                                                    className="pm-btn pm-btn-ghost pm-btn-sm"
                                                    aria-label={`Edit ${describeOptionContract(position)}`}
                                                    onClick={() => openDialog(position)}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    className="pm-btn pm-btn-ghost pm-btn-sm"
                                                    aria-label={`Delete ${describeOptionContract(position)}`}
                                                    disabled={deleting === position.id}
                                                    onClick={() => void remove(position)}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
            <p className="pm-metric-note" data-testid="options-ledger-note">
                Prices are the latest end-of-day close where Atlas&apos;s data includes the contract, otherwise your own
                price or what you paid. Option positions aren&apos;t counted in net worth or returns yet.
            </p>

            <OptionPositionDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                accounts={accounts}
                theses={theses}
                editing={editing}
            />
        </section>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="pm-options-ledger-metric">
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

function fmtCurrency0(value: number): string {
    return `$${Math.round(value).toLocaleString("en-US")}`;
}

function fmtPrice(value: number): string {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
