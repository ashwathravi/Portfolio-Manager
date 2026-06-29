"use client";

import { useState } from "react";
import { Plus, Link2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { clientApiScopeHeaders } from "@/lib/api/client-scope";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import {
    connectedPlaidAccountMatchesDiscovered,
    plaidAccountToConnectedAccount,
} from "@/lib/plaid/link";
import type {
    PlaidDiscoveredAccount,
    PlaidExchangeClientResponse,
    PlaidLinkMetadata,
    PlaidLinkTokenResponse,
} from "@/lib/plaid/types";

const PLAID_LINK_SCRIPT_ID = "plaid-link-sdk";
const PLAID_LINK_SCRIPT_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

type PlaidHandler = {
    open: () => void;
    destroy?: () => void;
};

type PlaidCreateOptions = {
    token: string;
    onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void;
    onExit?: (error: { error_message?: string | null } | null) => void;
};

declare global {
    interface Window {
        Plaid?: {
            create: (options: PlaidCreateOptions) => PlaidHandler;
        };
    }
}

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
 * The + Connect CTA launches the AR-149 Plaid Link flow. The client
 * sees Link/account metadata only; access-token exchange is handled by
 * `/api/plaid/exchange-public-token` and never returned to the browser.
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

function formatCurrency(value: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(value);
}

function loadPlaidLinkScript(): Promise<void> {
    if (typeof window === "undefined") {
        return Promise.reject(new Error("Plaid Link requires a browser session"));
    }
    if (window.Plaid) return Promise.resolve();

    const existing = document.getElementById(PLAID_LINK_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
        if (existing.dataset.loaded === "true") return Promise.resolve();
        return new Promise((resolve, reject) => {
            existing.addEventListener("load", () => {
                existing.dataset.loaded = "true";
                resolve();
            }, { once: true });
            existing.addEventListener("error", () => reject(new Error("Unable to load Plaid Link")), { once: true });
        });
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.id = PLAID_LINK_SCRIPT_ID;
        script.src = PLAID_LINK_SCRIPT_SRC;
        script.async = true;
        script.addEventListener("load", () => {
            script.dataset.loaded = "true";
            resolve();
        }, { once: true });
        script.addEventListener("error", () => reject(new Error("Unable to load Plaid Link")), { once: true });
        document.head.appendChild(script);
    });
}

async function readApiError(response: Response, fallback: string): Promise<string> {
    try {
        const payload = await response.json() as { error?: unknown };
        return typeof payload.error === "string" && payload.error.trim() ? payload.error : fallback;
    } catch {
        return fallback;
    }
}

export function IntegrationsCard() {
    const accounts = useSettingsStore((s) => s.accounts);
    const syncAccount = useSettingsStore((s) => s.syncAccount);
    const reconnectAccount = useSettingsStore((s) => s.reconnectAccount);
    const connectPlaidAccounts = useSettingsStore((s) => s.connectPlaidAccounts);

    // Local "busy" flag keyed by account id — prevents double-clicks
    // on the Manage/Reconnect buttons while a mock sync is in flight.
    const [busyId, setBusyId] = useState<string | null>(null);
    const [plaidStatus, setPlaidStatus] = useState<"idle" | "loading" | "review" | "saving" | "error">("idle");
    const [plaidError, setPlaidError] = useState<string | null>(null);
    const [plaidLinkToken, setPlaidLinkToken] = useState<PlaidLinkTokenResponse | null>(null);
    const [plaidExchange, setPlaidExchange] = useState<PlaidExchangeClientResponse | null>(null);
    const [selectedPlaidAccountIds, setSelectedPlaidAccountIds] = useState<string[]>([]);

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

    const existingPlaidAccountIds = accounts
        .map((account) => account.plaidAccountId)
        .filter((id): id is string => Boolean(id));

    const handlePlaidSuccess = async ({
        publicToken,
        metadata,
        token,
    }: {
        publicToken: string;
        metadata: PlaidLinkMetadata;
        token: PlaidLinkTokenResponse;
    }) => {
        setPlaidStatus("loading");
        setPlaidError(null);
        try {
            const exchangeResponse = await fetch("/api/plaid/exchange-public-token", {
                method: "POST",
                headers: clientApiScopeHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({
                    publicToken,
                    metadata,
                    existingPlaidAccountIds,
                }),
            });
            if (!exchangeResponse.ok) {
                throw new Error(await readApiError(exchangeResponse, "Unable to exchange Plaid public token"));
            }
            const exchange = (await exchangeResponse.json()) as PlaidExchangeClientResponse;
            const duplicateIds = new Set([
                ...exchange.duplicatePlaidAccountIds,
                ...exchange.accounts
                    .filter((account) =>
                        accounts.some((existingAccount) =>
                            connectedPlaidAccountMatchesDiscovered(existingAccount, account),
                        ),
                    )
                    .map((account) => account.plaidAccountId),
            ]);

            setPlaidLinkToken(token);
            setPlaidExchange(exchange);
            setSelectedPlaidAccountIds(
                exchange.accounts
                    .filter((account) => !duplicateIds.has(account.plaidAccountId))
                    .map((account) => account.plaidAccountId),
            );
            setPlaidStatus("review");
        } catch (error) {
            const message = error instanceof Error ? error.message : "Plaid token exchange failed";
            setPlaidError(message);
            setPlaidStatus("error");
        }
    };

    const startPlaidLink = async () => {
        setPlaidStatus("loading");
        setPlaidError(null);
        setPlaidExchange(null);
        setSelectedPlaidAccountIds([]);
        try {
            const tokenResponse = await fetch("/api/plaid/link-token", {
                method: "POST",
                headers: clientApiScopeHeaders({ "Content-Type": "application/json" }),
            });
            if (!tokenResponse.ok) {
                throw new Error(await readApiError(tokenResponse, "Unable to create Plaid link token"));
            }
            const token = (await tokenResponse.json()) as PlaidLinkTokenResponse;

            setPlaidLinkToken(token);
            await loadPlaidLinkScript();

            if (!window.Plaid) {
                throw new Error("Plaid Link SDK did not initialize");
            }

            const handler = window.Plaid.create({
                token: token.linkToken,
                onSuccess: (publicToken, metadata) => {
                    void handlePlaidSuccess({ publicToken, metadata, token });
                },
                onExit: (error) => {
                    if (!error) {
                        setPlaidStatus("idle");
                        setPlaidLinkToken(null);
                        return;
                    }
                    setPlaidError(error.error_message ?? "Plaid Link closed before completion");
                    setPlaidStatus("error");
                },
            });
            handler.open();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Plaid Link failed";
            setPlaidError(message);
            setPlaidStatus("error");
        }
    };

    const onReconnect = (id: string) => {
        const account = accounts.find((candidate) => candidate.id === id);
        if (account?.provider === "plaid") {
            void startPlaidLink();
            return;
        }

        setBusyId(id);
        setTimeout(() => {
            reconnectAccount(id);
            setBusyId(null);
            toast.success("Reconnected");
        }, 450);
    };

    const togglePlaidAccount = (accountId: string) => {
        setSelectedPlaidAccountIds((current) =>
            current.includes(accountId)
                ? current.filter((id) => id !== accountId)
                : [...current, accountId],
        );
    };

    const connectSelectedPlaidAccounts = () => {
        if (!plaidExchange) return;
        setPlaidStatus("saving");
        const selected = new Set(selectedPlaidAccountIds);
        const lastSynced = new Date().toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        });
        const connectedAccounts = plaidExchange.accounts
            .filter((account) => selected.has(account.plaidAccountId))
            .map((account) =>
                plaidAccountToConnectedAccount({
                    account,
                    itemId: plaidExchange.itemId,
                    lastSynced,
                    tokenStored: plaidExchange.accessTokenStored,
                    tokenStorageMode: plaidExchange.accessTokenStorageMode,
                    tokenStorageDurable: plaidExchange.accessTokenStorageDurable,
                }),
            );

        connectPlaidAccounts(connectedAccounts);
        toast.success(`Connected ${connectedAccounts.length} Plaid account${connectedAccounts.length === 1 ? "" : "s"}`);
        setPlaidStatus("idle");
        setPlaidExchange(null);
        setPlaidLinkToken(null);
        setSelectedPlaidAccountIds([]);
    };

    return (
        <section
            className="pm-settings-card"
            aria-labelledby="pm-settings-accts-head"
            data-testid="integrations-card"
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
                    onClick={startPlaidLink}
                    disabled={plaidStatus === "loading" || plaidStatus === "saving"}
                >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {plaidStatus === "loading" ? "Opening..." : "Connect"}
                </button>
            </header>

            <PlaidReviewPanel
                status={plaidStatus}
                error={plaidError}
                linkToken={plaidLinkToken}
                exchange={plaidExchange}
                selectedPlaidAccountIds={selectedPlaidAccountIds}
                onToggle={togglePlaidAccount}
                onCancel={() => {
                    setPlaidStatus("idle");
                    setPlaidError(null);
                    setPlaidExchange(null);
                    setPlaidLinkToken(null);
                }}
                onRetry={startPlaidLink}
                onConnect={connectSelectedPlaidAccounts}
            />

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
                        const needsReconnect = a.status !== "reconciled" || (a.provider === "plaid" && a.syncReady === false);

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
                                        {a.provider === "plaid" && (
                                            <span className="pm-integration-provider">
                                                Plaid
                                            </span>
                                        )}
                                        {a.provider === "plaid" && a.syncReady === false && (
                                            <span className="pm-integration-provider is-warn">
                                                Sync paused
                                            </span>
                                        )}
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
                                            {formatConnectedAccountStatus(a, bucket.label)}
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

function PlaidReviewPanel({
    status,
    error,
    linkToken,
    exchange,
    selectedPlaidAccountIds,
    onToggle,
    onCancel,
    onRetry,
    onConnect,
}: {
    status: "idle" | "loading" | "review" | "saving" | "error";
    error: string | null;
    linkToken: PlaidLinkTokenResponse | null;
    exchange: PlaidExchangeClientResponse | null;
    selectedPlaidAccountIds: string[];
    onToggle: (accountId: string) => void;
    onCancel: () => void;
    onRetry: () => void;
    onConnect: () => void;
}) {
    if (status === "idle") return null;
    if (status === "loading") {
        return (
            <div className="pm-plaid-panel" data-testid="plaid-link-panel" data-state="loading">
                <p className="pm-plaid-panel-title">Launching Plaid Link</p>
                <p className="pm-plaid-panel-copy">Creating a link token and waiting for Plaid account authorization.</p>
            </div>
        );
    }
    if (status === "error") {
        return (
            <div className="pm-plaid-panel is-error" data-testid="plaid-link-panel" data-state="error">
                <p className="pm-plaid-panel-title">Plaid Link failed</p>
                <p className="pm-plaid-panel-copy">{error ?? "Try again from the connected accounts card."}</p>
                <div className="pm-plaid-actions">
                    <button type="button" className="pm-integration-action is-warn" onClick={onRetry}>
                        Retry Plaid Link
                    </button>
                    <button type="button" className="pm-integration-action" onClick={onCancel}>
                        Cancel
                    </button>
                </div>
            </div>
        );
    }
    if (!exchange) return null;

    const duplicateIds = new Set(exchange.duplicatePlaidAccountIds);
    const selectedCount = selectedPlaidAccountIds.length;

    return (
        <div className="pm-plaid-panel" data-testid="plaid-link-panel" data-state="review">
            <div className="pm-plaid-panel-head">
                <div>
                    <p className="pm-plaid-panel-title">Select Plaid accounts</p>
                    <p className="pm-plaid-panel-copy">
                        Plaid Link complete for {exchange.institution.name}. {formatPlaidTokenStorage(exchange)}
                    </p>
                </div>
                {linkToken && (
                    <span className="pm-plaid-token">{linkToken.environment}</span>
                )}
            </div>

            <div className="pm-plaid-account-list">
                {exchange.accounts.map((account) => (
                    <PlaidAccountOption
                        key={account.plaidAccountId}
                        account={account}
                        checked={selectedPlaidAccountIds.includes(account.plaidAccountId)}
                        duplicate={duplicateIds.has(account.plaidAccountId)}
                        onToggle={onToggle}
                    />
                ))}
            </div>

            <div className="pm-plaid-actions">
                <button
                    type="button"
                    className="pm-settings-card-cta"
                    onClick={onConnect}
                    disabled={selectedCount === 0 || status === "saving"}
                >
                    Connect selected
                </button>
                <button type="button" className="pm-integration-action" onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

function formatPlaidTokenStorage(exchange: PlaidExchangeClientResponse): string {
    if (!exchange.accessTokenStored) {
        return "Access token was not stored; reconnect before syncing.";
    }
    if (exchange.accessTokenStorageDurable) {
        return exchange.accessTokenStorageMode === "postgres"
            ? "Access token stored server-side in the durable registry."
            : "Access token stored server-side in the encrypted vault.";
    }
    return "Access token cached in this server session; reconnect after a server restart.";
}

function formatConnectedAccountStatus(
    account: {
        provider?: "manual" | "schwab" | "plaid";
        syncReady?: boolean;
        tokenStorageDurable?: boolean;
        tokenStorageMode?: "memory" | "encrypted_file" | "postgres";
        lastSynced: string;
    },
    fallbackLabel: string,
): string {
    if (account.provider !== "plaid") {
        return fallbackLabel === "Synced" ? `${fallbackLabel} · ${account.lastSynced}` : fallbackLabel;
    }

    if (account.syncReady === false) {
        return "Reconnect required · provider token unavailable";
    }

    if (account.tokenStorageDurable) {
        const storageLabel = account.tokenStorageMode === "postgres" ? "durable registry" : "encrypted vault";
        return `${fallbackLabel} · ${storageLabel} · ${account.lastSynced}`;
    }

    return `${fallbackLabel} · session token · ${account.lastSynced}`;
}

function PlaidAccountOption({
    account,
    checked,
    duplicate,
    onToggle,
}: {
    account: PlaidDiscoveredAccount;
    checked: boolean;
    duplicate: boolean;
    onToggle: (accountId: string) => void;
}) {
    return (
        <label className={`pm-plaid-account ${duplicate ? "is-duplicate" : ""}`}>
            <input
                type="checkbox"
                checked={checked}
                disabled={duplicate}
                onChange={() => onToggle(account.plaidAccountId)}
                aria-label={`Select ${account.name}`}
            />
            <span className="pm-plaid-account-main">
                <span className="pm-plaid-account-name">{account.name}</span>
                <span className="pm-plaid-account-meta">
                    {account.subtype} · ****{account.mask} · {formatCurrency(account.currentBalance)}
                </span>
            </span>
            <span className="pm-plaid-account-capability">
                {duplicate ? "Already connected" : account.capabilities.includes("investments") ? "Investments" : "Balances"}
            </span>
        </label>
    );
}
