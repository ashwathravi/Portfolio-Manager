"use client";

import Link from "next/link";
import { useBankLinking } from "@/components/providers/BankLinkingProvider";
import { addAccountsLink } from "@/lib/portfolio/add-accounts";
import { useSettingsStore } from "@/lib/stores/settingsStore";

/**
 * Shown in place of an example-data screen when "Show example data" is off.
 * Its way in is "Connect an account" where Settings can connect a bank, and
 * otherwise "Add an account" on Accounts (x30): a Connect link there would
 * reach a card saying bank linking isn't set up, which points back.
 */
export function SampleEmptyState({ title, body }: { title: string; body: string }) {
    const setShowSampleData = useSettingsStore((s) => s.setShowSampleData);
    const addAccounts = addAccountsLink(useBankLinking());
    return (
        <section className="pm-card pm-empty-card" data-testid="sample-empty-state">
            <h2>{title}</h2>
            <p>{body}</p>
            <div className="pm-empty-actions">
                <Link href={addAccounts.href} className="pm-btn pm-btn-primary">{addAccounts.label}</Link>
                <button type="button" className="pm-btn pm-btn-ghost" onClick={() => setShowSampleData(true)}>
                    Show example data
                </button>
            </div>
        </section>
    );
}
