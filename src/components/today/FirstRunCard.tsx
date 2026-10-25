"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { NewAccountButton } from "@/components/portfolio/AccountControls";
import { ImportHoldingsDialog, type ImportAccountOption } from "@/components/holdings/ImportHoldingsDialog";
import { formatUsd } from "@/lib/format";
import { useShowSampleData } from "@/lib/hooks/useShowSampleData";
import { useSettingsStore } from "@/lib/stores/settingsStore";

/**
 * Today before there are any positions (launch item i43): in place of the
 * net worth, the two steps that get a new user to it. Add an account (or
 * connect a brokerage), then add positions from a broker's CSV. Each step
 * shows as done from the user's own data, so the card moves on by itself,
 * and it goes once there are positions. New users start with example data
 * off; the card says how to turn it on to look around first.
 */
export function FirstRunCard({
    accounts,
    cashTotal,
}: {
    accounts: readonly ImportAccountOption[];
    cashTotal: number;
}) {
    const showSampleData = useShowSampleData();
    const setShowSampleData = useSettingsStore((s) => s.setShowSampleData);
    const hasAccount = accounts.length > 0;
    const accountCount = `${accounts.length} account${accounts.length === 1 ? "" : "s"}`;

    return (
        <section className="pm-card pm-empty-card pm-today-hero" data-testid="today-hero" data-empty="true" aria-labelledby="first-run-title">
            <span className="pm-today-label">Net worth</span>
            <h2 id="first-run-title">Add your accounts to see your net worth</h2>
            <p>
                Today shows your money first, then anything that needs your attention. Two steps get you there,
                and every number comes from what you add.
            </p>

            <ol className="pm-first-run-steps" data-testid="first-run">
                <li data-testid="first-run-step" data-done={hasAccount}>
                    <span className="pm-first-run-mark" aria-hidden="true">{hasAccount ? <Check size={14} /> : "1"}</span>
                    <div className="pm-first-run-body">
                        <h3>{hasAccount ? "Account added" : "Add an account"}</h3>
                        {hasAccount ? (
                            <p>
                                {accountCount}
                                {cashTotal !== 0 && `, ${formatUsd(cashTotal)} in cash`}.{" "}
                                <Link href="/portfolios/accounts">Manage accounts</Link>
                            </p>
                        ) : (
                            <>
                                <p>One for each brokerage or retirement account, with the cash it holds.</p>
                                <div className="pm-empty-actions">
                                    <NewAccountButton />
                                    <Link href="/settings#accounts" className="pm-btn pm-btn-ghost">Connect an account</Link>
                                </div>
                            </>
                        )}
                    </div>
                </li>
                <li data-testid="first-run-step" data-done="false">
                    <span className="pm-first-run-mark" aria-hidden="true">2</span>
                    <div className="pm-first-run-body">
                        <h3>Add your positions</h3>
                        <p>
                            Export positions from your broker as a CSV (symbol, quantity, and average cost or cost
                            basis) and import it. You&apos;ll see what was read before anything is saved.
                        </p>
                        <div className="pm-empty-actions">
                            <ImportHoldingsDialog
                                accounts={accounts}
                                triggerClassName={`pm-btn ${hasAccount ? "pm-btn-primary" : "pm-btn-ghost"}`}
                            />
                            {hasAccount && <Link href="/settings#accounts" className="pm-btn pm-btn-ghost">Connect an account</Link>}
                        </div>
                    </div>
                </li>
            </ol>

            {!showSampleData && (
                <p className="pm-first-run-examples" data-testid="first-run-examples">
                    Want to look around first?{" "}
                    <button type="button" className="pm-link-btn" onClick={() => setShowSampleData(true)}>
                        Show example data
                    </button>{" "}
                    (labelled as examples; turn it off again in Settings).
                </p>
            )}
        </section>
    );
}
