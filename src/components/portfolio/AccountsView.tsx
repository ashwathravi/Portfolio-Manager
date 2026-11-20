import Link from "next/link";
import { accountKindLine } from "@/lib/portfolio/account-kinds";
import type { AccountRow, AccountsSummary } from "@/lib/portfolio/accounts";
import { formatPct, formatShortDate, formatUsd } from "@/lib/format";
import { AccountRowActions, NewAccountButton } from "./AccountControls";

/**
 * Portfolio › Accounts. Every figure comes from the user's portfolios in
 * the database; with none, the page says so and points at the ways to add
 * data instead of showing example accounts. Accounts are added, edited and
 * deleted here (launch item i41).
 *
 * `bankLinking` is whether Settings can connect a bank (bankLinkingAvailable,
 * x30). Without it Settings says bank linking isn't set up and points back
 * here, so the empty state leads with adding an account by hand and has no
 * Connect link.
 */
export function AccountsView({ rows, summary, bankLinking }: { rows: AccountRow[]; summary: AccountsSummary; bankLinking: boolean }) {
    if (rows.length === 0) {
        return (
            <div className="pm-page" data-testid="accounts-view">
                <section className="pm-card pm-empty-card" data-testid="accounts-empty">
                    <h2>No accounts yet</h2>
                    <p>
                        {bankLinking
                            ? "Accounts appear here once you connect a brokerage, import positions, or add one yourself."
                            : "Accounts appear here once you add one yourself or import positions."}{" "}
                        Each account&apos;s value, cash, and positions come straight from your data.
                    </p>
                    {bankLinking ? (
                        <div className="pm-empty-actions">
                            <Link href="/settings#accounts" className="pm-btn pm-btn-primary">Connect an account</Link>
                            <Link href="/portfolios/holdings" className="pm-btn pm-btn-ghost">Import a CSV</Link>
                            <NewAccountButton variant="ghost" />
                        </div>
                    ) : (
                        <div className="pm-empty-actions">
                            <NewAccountButton />
                            <Link href="/portfolios/holdings" className="pm-btn pm-btn-ghost">Import a CSV</Link>
                        </div>
                    )}
                </section>
            </div>
        );
    }

    return (
        <div className="pm-page" data-testid="accounts-view">
            <section className="pm-card pm-card-stack">
                <div className="pm-accounts-actions">
                    <NewAccountButton />
                </div>
                <dl className="pm-metric-strip" data-testid="accounts-summary">
                    <div><dt>Total value</dt><dd>{formatUsd(summary.totalUsd)}</dd></div>
                    <div><dt>Cash</dt><dd>{formatUsd(summary.cashUsd)}</dd></div>
                    <div><dt>Accounts</dt><dd>{summary.accounts}</dd></div>
                    <div><dt>Positions</dt><dd>{summary.positions}</dd></div>
                </dl>
                <div className="pm-table-scroll">
                    <table className="pm-table-full" data-testid="accounts-table">
                        <thead>
                            <tr>
                                <th scope="col">Account</th>
                                <th scope="col" className="num">Value</th>
                                <th scope="col" className="num">Invested</th>
                                <th scope="col" className="num">Cash</th>
                                <th scope="col" className="num">Unrealized</th>
                                <th scope="col" className="num">Positions</th>
                                <th scope="col">Share</th>
                                <th scope="col">Updated</th>
                                <th scope="col" aria-label="Actions" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id}>
                                    <td>
                                        <div className="pm-account-name">{r.name}</div>
                                        {accountKindLine(r) && <div className="pm-card-subtitle" data-testid="account-kind">{accountKindLine(r)}</div>}
                                        {r.description && <div className="pm-card-subtitle">{r.description}</div>}
                                    </td>
                                    <td className="num">{formatUsd(r.totalUsd)}</td>
                                    <td className="num">{formatUsd(r.investedUsd)}</td>
                                    <td className="num">{formatUsd(r.cashUsd)}</td>
                                    <td className={`num ${r.unrealizedPct === null ? "" : r.unrealizedPct > 0 ? "pm-pos" : r.unrealizedPct < 0 ? "pm-neg" : ""}`}>
                                        {formatPct(r.unrealizedPct, { signed: true })}
                                    </td>
                                    <td className="num">{r.positions}</td>
                                    <td>
                                        <span className="pm-share-bar" title={`${r.sharePct}% of total value`}>
                                            <span style={{ width: `${r.sharePct}%` }} />
                                        </span>
                                    </td>
                                    <td>{formatShortDate(r.updatedAt)}</td>
                                    <td>
                                        <AccountRowActions
                                            account={{
                                                id: r.id, name: r.name, description: r.description, cashUsd: r.cashUsd, positions: r.positions,
                                                accountType: r.accountType, institution: r.institution, taxTreatment: r.taxTreatment,
                                            }}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}
