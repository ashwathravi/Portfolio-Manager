"use client";

import { useState } from "react";
import { Plus, Link2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useSettingsStore } from "@/lib/stores/settingsStore";

/**
 * AR-87 Connected accounts card.
 *
 * Lists integrations from `useSettingsStore.accounts`. Each row shows:
 *   - Logo tile (monogram from first letter, tinted by status)
 *   - Name + account mask
 *   - Status line:
 *       · reconciled → green dot + "Synced <relative time>"
 *       · needs-review → amber dot + "Auth expired"
 *       · error → red dot + error message
 *   - Manage / Reconnect link on the right
 *
 * The + Connect CTA in the head is wired to a toast for now — the
 * actual OAuth flows live in a separate integration layer and aren't
 * in scope for the redesign. We surface the UI affordance so the
 * card looks complete and doesn't leave an obvious "coming soon" hole.
 *
 * Why inline here instead of reusing `<IntegrationsList>` from the
 * old tabbed page? That component is tuned for a full-page view with
 * a table and bulk actions. This card is the compact at-a-glance
 * version — 3 rows tall, optimized for the settings grid.
 */

function statusBucket(status: "reconciled" | "needs-review" | "error") {
    // Spec text: "Synced Ns ago" vs "Auth expired". "needs-review"
    // surfaces as Auth expired because that's the most common cause
    // we stub in the fixtures; for real data we'd carry a reason.
    if (status === "reconciled") return { tone: "ok", label: "Synced" } as const;
    if (status === "needs-review") return { tone: "warn", label: "Auth expired" } as const;
    return { tone: "error", label: "Error" } as const;
}

export function IntegrationsCard() {
    const accounts = useSettingsStore((s) => s.accounts);
    const syncAccount = useSettingsStore((s) => s.syncAccount);
    const reconnectAccount = useSettingsStore((s) => s.reconnectAccount);

    // Local "busy" flag keyed by account id — prevents double-clicks
    // on the Manage/Reconnect buttons while a mock sync is in flight.
    const [busyId, setBusyId] = useState<string | null>(null);

    const onManage = (id: string) => {
        setBusyId(id);
        // Mock sync: just touch lastSynced. Real implementation would
        // hit the integration provider's refresh endpoint.
        setTimeout(() => {
            syncAccount(id);
            setBusyId(null);
            toast.success("Synced");
        }, 350);
    };

    const onReconnect = (id: string) => {
        setBusyId(id);
        setTimeout(() => {
            reconnectAccount(id);
            setBusyId(null);
            toast.success("Reconnected");
        }, 450);
    };

    return (
        <section
            className="pm-settings-card"
            aria-labelledby="pm-settings-accts-head"
        >
            <header className="pm-settings-card-head">
                <div className="pm-settings-card-head-left">
                    <Link2 className="pm-settings-card-icon" aria-hidden="true" />
                    <h2
                        id="pm-settings-accts-head"
                        className="pm-settings-card-title"
                    >
                        Connected accounts
                    </h2>
                </div>
                <button
                    type="button"
                    className="pm-settings-card-cta"
                    onClick={() =>
                        toast.info("Account linking flow lands in a later phase")
                    }
                >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    Connect
                </button>
            </header>

            <div className="pm-integrations">
                {accounts.length === 0 ? (
                    <div className="pm-integrations-empty">
                        No accounts connected yet. Click <strong>+ Connect</strong> to
                        link a brokerage.
                    </div>
                ) : (
                    accounts.map((a) => {
                        const bucket = statusBucket(a.status);
                        const firstLetter = a.name.charAt(0).toUpperCase();
                        const busy = busyId === a.id;
                        const needsReconnect = a.status !== "reconciled";

                        return (
                            <div
                                key={a.id}
                                className={`pm-integration-row is-${bucket.tone}`}
                            >
                                <div
                                    className="pm-integration-logo"
                                    aria-hidden="true"
                                >
                                    {firstLetter}
                                </div>

                                <div className="pm-integration-meta">
                                    <div className="pm-integration-name">
                                        {a.name}
                                        <span className="pm-integration-mask">
                                            {a.accountMask}
                                        </span>
                                    </div>
                                    <div className="pm-integration-status">
                                        {bucket.tone === "ok" ? (
                                            <CheckCircle2
                                                className="pm-integration-status-icon"
                                                aria-hidden="true"
                                            />
                                        ) : (
                                            <AlertTriangle
                                                className="pm-integration-status-icon"
                                                aria-hidden="true"
                                            />
                                        )}
                                        <span>
                                            {bucket.label}
                                            {bucket.tone === "ok" &&
                                                ` · ${a.lastSynced}`}
                                        </span>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    className={`pm-integration-action is-${needsReconnect ? "warn" : "ghost"}`}
                                    onClick={() =>
                                        needsReconnect
                                            ? onReconnect(a.id)
                                            : onManage(a.id)
                                    }
                                    disabled={busy}
                                >
                                    {busy
                                        ? "…"
                                        : needsReconnect
                                            ? "Reconnect"
                                            : "Manage"}
                                </button>
                            </div>
                        );
                    })
                )}
            </div>
        </section>
    );
}
