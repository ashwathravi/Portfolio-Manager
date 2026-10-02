"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, Repeat2 } from "lucide-react";
import { computeChurnAnalysis } from "@/lib/risk-policy";
import { exportToCsv } from "@/lib/exportCsv";
import { formatQty, formatShortDate, formatUsd } from "@/lib/format";
import {
    activityAccounts,
    filterActivity,
    summarizeActivity,
    type ActivityRow,
    type ActivitySide,
} from "@/lib/portfolio/activity";

/**
 * Portfolio › Activity. Replaces the retired trade log, which rendered a
 * hardcoded list. Rows come from the transactions table; the churn and
 * tax-friction callout (kept from the trade log) runs on the same rows.
 */

const SIDES: ReadonlyArray<{ key: "ALL" | ActivitySide; label: string }> = [
    { key: "ALL", label: "All" },
    { key: "BUY", label: "Buys" },
    { key: "SELL", label: "Sells" },
];

export function ActivityPageClient({ rows }: { rows: ActivityRow[] }) {
    const [query, setQuery] = useState("");
    const [side, setSide] = useState<"ALL" | ActivitySide>("ALL");
    const [account, setAccount] = useState<string>("ALL");
    const [highChurnOnly, setHighChurnOnly] = useState(false);

    const accounts = useMemo(() => activityAccounts(rows), [rows]);
    const churn = useMemo(
        () =>
            computeChurnAnalysis(
                rows
                    .filter((r) => r.side === "BUY" || r.side === "SELL")
                    .map((r) => ({
                        id: r.id,
                        date: r.date,
                        type: r.side.toLowerCase(),
                        symbol: r.symbol,
                        quantity: r.quantity,
                        price: r.price,
                        amount: r.value,
                        account: r.account,
                    })),
            ),
        [rows],
    );
    const topChurn = churn.rows.find((r) => r.status !== "inside") ?? null;
    const churnSymbols = useMemo(
        () => churn.rows.filter((r) => r.status !== "inside").map((r) => r.symbol),
        [churn],
    );

    const visible = useMemo(
        () => filterActivity(rows, { query, side, account, symbols: highChurnOnly ? churnSymbols : null }),
        [rows, query, side, account, highChurnOnly, churnSymbols],
    );
    const summary = useMemo(() => summarizeActivity(visible), [visible]);

    if (rows.length === 0) {
        return (
            <div className="pm-page" data-testid="activity-view">
                <section className="pm-card pm-empty-card" data-testid="activity-empty">
                    <h2>No transactions yet</h2>
                    <p>
                        Buys, sells, dividends, and transfers from your connected accounts show up here,
                        along with a churn and tax-friction check on repeat trading.
                    </p>
                    <div className="pm-empty-actions">
                        <Link href="/settings#accounts" className="pm-btn pm-btn-primary">Connect an account</Link>
                        <Link href="/execution" className="pm-btn pm-btn-ghost">Draft an order</Link>
                    </div>
                </section>
            </div>
        );
    }

    return (
        <div className="pm-page" data-testid="activity-view">
            {topChurn && (
                <section className="pm-callout" data-testid="activity-churn-callout">
                    <div>
                        <p className="pm-callout-title">Churn and tax-friction review</p>
                        <p className="pm-callout-body">{topChurn.recommendation}</p>
                        <p className="pm-callout-body">
                            {topChurn.symbol}: score {topChurn.churnScore} · {topChurn.tradeCount} trades ·{" "}
                            {formatUsd(topChurn.turnoverUsd, { decimals: 0 })} turnover
                        </p>
                    </div>
                    <button
                        type="button"
                        className="pm-btn pm-btn-ghost"
                        aria-pressed={highChurnOnly}
                        data-testid="activity-high-churn-filter"
                        onClick={() => setHighChurnOnly((v) => !v)}
                    >
                        <Repeat2 size={14} aria-hidden="true" />
                        <span>{highChurnOnly ? "Show all" : "Only high churn"}</span>
                    </button>
                </section>
            )}

            <section className="pm-card pm-card-stack">
                <dl className="pm-metric-strip" data-testid="activity-summary">
                    <div><dt>Transactions</dt><dd>{summary.count}</dd></div>
                    <div><dt>Bought</dt><dd>{formatUsd(summary.boughtUsd, { decimals: 0 })}</dd></div>
                    <div><dt>Sold</dt><dd>{formatUsd(summary.soldUsd, { decimals: 0 })}</dd></div>
                    <div><dt>Accounts</dt><dd>{summary.accounts}</dd></div>
                </dl>

                <div className="pm-filter-row">
                    <input
                        id="activity-search"
                        type="search"
                        className="pm-input"
                        placeholder="Search symbol, account, or note"
                        aria-label="Search transactions"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    <div className="pm-seg" role="group" aria-label="Side">
                        {SIDES.map((s) => (
                            <button
                                key={s.key}
                                type="button"
                                className={`pm-seg-btn${side === s.key ? " is-active" : ""}`}
                                aria-pressed={side === s.key}
                                onClick={() => setSide(s.key)}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                    {accounts.length > 1 && (
                        <select
                            id="activity-account"
                            className="pm-select"
                            aria-label="Account"
                            value={account}
                            onChange={(e) => setAccount(e.target.value)}
                        >
                            <option value="ALL">All accounts</option>
                            {accounts.map((a) => (
                                <option key={a} value={a}>{a}</option>
                            ))}
                        </select>
                    )}
                    <span className="pm-spacer" />
                    <button
                        type="button"
                        className="pm-btn pm-btn-ghost"
                        disabled={visible.length === 0}
                        onClick={() =>
                            exportToCsv(
                                "atlas-activity.csv",
                                visible.map((r) => ({
                                    date: r.date.slice(0, 10),
                                    symbol: r.symbol ?? "",
                                    side: r.side,
                                    quantity: r.quantity ?? "",
                                    price: r.price ?? "",
                                    value: r.value,
                                    account: r.account,
                                    notes: r.notes ?? "",
                                })),
                            )
                        }
                    >
                        <Download size={14} aria-hidden="true" />
                        <span>Export CSV</span>
                    </button>
                </div>

                {visible.length === 0 ? (
                    <p className="pm-empty-line">No transactions match these filters.</p>
                ) : (
                    <div className="pm-table-scroll">
                        <table className="pm-table-full" data-testid="activity-table">
                            <thead>
                                <tr>
                                    <th scope="col">Date</th>
                                    <th scope="col">Symbol</th>
                                    <th scope="col">Side</th>
                                    <th scope="col" className="num">Qty</th>
                                    <th scope="col" className="num">Price</th>
                                    <th scope="col" className="num">Value</th>
                                    <th scope="col">Account</th>
                                    <th scope="col">Note</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map((r) => (
                                    <tr key={r.id}>
                                        <td>{formatShortDate(r.date)}</td>
                                        <td>
                                            {r.symbol ? (
                                                <Link href={`/portfolios/detail/${encodeURIComponent(r.symbol)}`} className="pm-symbol-link">
                                                    {r.symbol}
                                                </Link>
                                            ) : (
                                                "—"
                                            )}
                                        </td>
                                        <td><span className="pm-side" data-side={r.side}>{r.side}</span></td>
                                        <td className="num">{formatQty(r.quantity)}</td>
                                        <td className="num">{r.price === null ? "—" : formatUsd(r.price)}</td>
                                        <td className="num">{formatUsd(r.value)}</td>
                                        <td>{r.account}</td>
                                        <td className="pm-card-subtitle">{r.notes ?? ""}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
}
