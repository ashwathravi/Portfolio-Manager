"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import {
    computeOptionRiskLedger,
    type OptionRiskPosition,
    type OptionRiskStatus,
} from "@/lib/risk-policy";
import { useSettingsStore } from "@/lib/stores/settingsStore";

export interface OptionsRiskLedgerCardProps {
    positions: readonly OptionRiskPosition[];
    totalPortfolioValue: number;
    liquidNetWorth?: number;
}

const STATUS_LABELS: Record<OptionRiskStatus, string> = {
    inside: "Inside policy",
    watch: "Watch",
    breached: "Breached",
    missing_data: "Missing data",
};

export function OptionsRiskLedgerCard({
    positions,
    totalPortfolioValue,
    liquidNetWorth,
}: OptionsRiskLedgerCardProps) {
    const optionsRiskPolicy = useSettingsStore((s) => s.riskPolicy.optionsRiskPolicy);
    const ledger = useMemo(
        () =>
            computeOptionRiskLedger({
                positions,
                totalPortfolioValue,
                liquidNetWorth,
                policy: optionsRiskPolicy,
            }),
        [positions, totalPortfolioValue, liquidNetWorth, optionsRiskPolicy],
    );

    return (
        <section
            className="pm-card pm-card-stack pm-options-ledger"
            data-testid="options-risk-ledger"
            data-status={ledger.status}
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
                        {ledger.actionPrompts[0]}
                    </p>
                </div>
                <div className="pm-options-ledger-summary" aria-label="Options exposure summary">
                    <Metric label="Premium risk" value={fmtCurrency0(ledger.totalPremiumAtRisk)} />
                    <Metric label="Portfolio" value={`${ledger.totalPremiumPctOfPortfolio.toFixed(1)}%`} />
                    <Metric label="Notional equiv." value={fmtCurrency0(ledger.totalNotionalEquivalent)} />
                </div>
            </header>

            <div className="pm-options-ledger-table-wrap">
                <table className="pm-options-ledger-table">
                    <thead>
                        <tr>
                            <th scope="col">Contract</th>
                            <th scope="col">Expiry</th>
                            <th scope="col" className="num">Premium risk</th>
                            <th scope="col" className="num">Notional equiv.</th>
                            <th scope="col" className="num">Portfolio</th>
                            <th scope="col">Thesis / rule</th>
                            <th scope="col">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {ledger.rows.length === 0 ? (
                            <tr>
                                <td colSpan={7} className="pm-options-ledger-empty">
                                    No option positions are currently recorded.
                                </td>
                            </tr>
                        ) : (
                            ledger.rows.map((row) => (
                                <tr
                                    key={row.id}
                                    data-testid="options-risk-row"
                                    data-status={row.status}
                                >
                                    <td>
                                        <div className="pm-options-contract">
                                            <span className="pm-options-contract-symbol">{row.symbol}</span>
                                            <span className="pm-options-contract-sub">
                                                {row.quantity} {row.direction} {row.contractType.toUpperCase()} contracts
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
                                    <td className="num">{fmtCurrency0(row.premiumAtRisk)}</td>
                                    <td className="num">{fmtCurrency0(row.notionalEquivalent)}</td>
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
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
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
