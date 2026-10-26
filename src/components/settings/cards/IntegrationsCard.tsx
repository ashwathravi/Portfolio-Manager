"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Link2, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { plaidSyncMessage, type SyncedAccountSummary } from "@/lib/plaid/sync-summary";
import type { PlaidConnection, PlaidConnectionAccount } from "@/lib/plaid/connections";
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
 * Settings › Connected accounts: the user's Plaid connections, from the
 * database (launch item i46), each with its accounts and what they sync
 * into, and what to do next with it (launch items i44 and i45):
 *   - + Connect opens Plaid Link; the accounts found are reviewed and the
 *     picked ones synced into portfolios straight away.
 *   - Sync now brings a connection's picked accounts up to date.
 *   - Reconnect opens Link in update mode when the institution wants its
 *     user to sign in again, or consent is about to end.
 *   - Disconnect ends Atlas's access at Plaid; the accounts already brought
 *     in stay on Accounts until deleted there.
 *   - Accounts not picked yet (linked before picks were kept) are picked here.
 *
 * The browser sees Link and account metadata only; access tokens stay
 * server-side (`/api/plaid/exchange-public-token`).
 */

const CONNECTIONS_KEY = ["plaid-connections"] as const;

function formatCurrency(value: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(value);
}

function formatWhen(iso: string | null): string {
    if (!iso) return "not synced yet";
    return `synced ${new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
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

/** The user's connections; none when linked accounts aren't set up here. */
async function fetchConnections(): Promise<PlaidConnection[]> {
    const response = await fetch("/api/plaid/connections", { credentials: "same-origin" });
    if (response.status === 503) return [];
    if (!response.ok) throw new Error(await readApiError(response, "Couldn't load the connected accounts."));
    return ((await response.json()) as { data: PlaidConnection[] }).data;
}

/**
 * Syncs a connection's picked investment accounts into portfolios (launch
 * item i44). With `plaidAccountIds`, the accounts just picked: those of its
 * accounts still waiting for a pick sync from now on, the rest don't.
 */
async function syncPlaidConnection(itemId: string, plaidAccountIds?: readonly string[]): Promise<{ ok: boolean; message: string }> {
    try {
        const response = await fetch("/api/plaid/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ itemId, ...(plaidAccountIds ? { plaidAccountIds } : {}) }),
        });
        if (!response.ok) return { ok: false, message: await readApiError(response, "Couldn't sync the linked accounts. Try again.") };
        const body = (await response.json()) as { data: { accounts: SyncedAccountSummary[]; overLimit?: string[] } };
        return { ok: true, message: plaidSyncMessage(body.data.accounts, body.data.overLimit) };
    } catch {
        return { ok: false, message: "Couldn't reach Atlas to sync. Try again." };
    }
}

/** A Link token: a new connection, or with `itemId` update mode for one of the user's. */
async function createLinkToken(itemId?: string): Promise<PlaidLinkTokenResponse> {
    const response = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        ...(itemId ? { body: JSON.stringify({ itemId }) } : {}),
    });
    if (!response.ok) throw new Error(await readApiError(response, "Unable to create Plaid link token"));
    return (await response.json()) as PlaidLinkTokenResponse;
}

export function IntegrationsCard() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const connectionsQuery = useQuery({ queryKey: CONNECTIONS_KEY, queryFn: fetchConnections, staleTime: 30_000 });
    const connections = connectionsQuery.data ?? [];

    // The connection an action is running on, against double clicks.
    const [busyItem, setBusyItem] = useState<string | null>(null);
    const [plaidStatus, setPlaidStatus] = useState<"idle" | "loading" | "review" | "saving" | "error">("idle");
    const [plaidError, setPlaidError] = useState<string | null>(null);
    const [plaidLinkToken, setPlaidLinkToken] = useState<PlaidLinkTokenResponse | null>(null);
    const [plaidExchange, setPlaidExchange] = useState<PlaidExchangeClientResponse | null>(null);
    const [selectedPlaidAccountIds, setSelectedPlaidAccountIds] = useState<string[]>([]);

    /** After a change: this list, the pages' data, and the sidebar's account count. */
    const refreshAfterChange = () => {
        router.refresh();
        void queryClient.invalidateQueries({ queryKey: CONNECTIONS_KEY });
        void queryClient.invalidateQueries({ queryKey: ["portfolios"] });
    };

    const runSync = async (itemId: string, plaidAccountIds?: readonly string[]) => {
        setBusyItem(itemId);
        const result = await syncPlaidConnection(itemId, plaidAccountIds);
        setBusyItem(null);
        if (result.ok) toast.success(result.message);
        else toast.error(result.message);
        refreshAfterChange();
        return result.ok;
    };

    const onDisconnect = async (connection: PlaidConnection) => {
        const name = connection.institutionName ?? "this connection";
        if (!window.confirm(
            `Disconnect ${name}? Atlas stops syncing its accounts and its access through Plaid ends. `
            + "The accounts already brought in stay on Accounts until you delete them there.",
        )) return;
        setBusyItem(connection.itemId);
        try {
            const response = await fetch(`/api/plaid/connections/${encodeURIComponent(connection.itemId)}`, {
                method: "DELETE",
                credentials: "same-origin",
            });
            if (!response.ok) throw new Error(await readApiError(response, "Couldn't disconnect. Try again."));
            toast.success(`Disconnected ${name}.`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Couldn't disconnect. Try again.");
        } finally {
            setBusyItem(null);
            refreshAfterChange();
        }
    };

    const existingPlaidAccountIds = connections.flatMap((c) => c.accounts.map((a) => a.plaidAccountId));

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
                headers: { "Content-Type": "application/json" },
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
            const duplicateIds = new Set(exchange.duplicatePlaidAccountIds);

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

    const openLink = async (token: PlaidLinkTokenResponse, onSuccess: (publicToken: string, metadata: PlaidLinkMetadata) => void) => {
        await loadPlaidLinkScript();
        if (!window.Plaid) throw new Error("Plaid Link SDK did not initialize");
        const handler = window.Plaid.create({
            token: token.linkToken,
            onSuccess,
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
    };

    const startPlaidLink = async () => {
        setPlaidStatus("loading");
        setPlaidError(null);
        setPlaidExchange(null);
        setSelectedPlaidAccountIds([]);
        try {
            const token = await createLinkToken();
            setPlaidLinkToken(token);
            await openLink(token, (publicToken, metadata) => {
                void handlePlaidSuccess({ publicToken, metadata, token });
            });
        } catch (error) {
            setPlaidError(error instanceof Error ? error.message : "Plaid Link failed");
            setPlaidStatus("error");
        }
    };

    /** Link's update mode: the user signs in to the institution again, then it syncs. */
    const onReconnect = async (connection: PlaidConnection) => {
        setPlaidStatus("loading");
        setPlaidError(null);
        try {
            const token = await createLinkToken(connection.itemId);
            await openLink(token, () => {
                setPlaidStatus("idle");
                void runSync(connection.itemId);
            });
        } catch (error) {
            setPlaidError(error instanceof Error ? error.message : "Plaid Link failed");
            setPlaidStatus("error");
        }
    };

    const togglePlaidAccount = (accountId: string) => {
        setSelectedPlaidAccountIds((current) =>
            current.includes(accountId)
                ? current.filter((id) => id !== accountId)
                : [...current, accountId],
        );
    };

    const connectSelectedPlaidAccounts = async () => {
        if (!plaidExchange) return;
        setPlaidStatus("saving");
        // Bring the picked accounts' holdings and transactions in now, not tonight.
        await runSync(plaidExchange.itemId, selectedPlaidAccountIds);
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
                onConnect={() => void connectSelectedPlaidAccounts()}
            />

            <div className="pm-integrations">
                {connections.length === 0 ? (
                    <div className="pm-integrations-empty">
                        {connectionsQuery.isPending
                            ? "Loading connected accounts…"
                            : <>No accounts connected yet. Click <strong>+ Connect</strong> to link a brokerage.</>}
                    </div>
                ) : (
                    connections.map((connection) => (
                        <ConnectionRow
                            key={connection.itemId}
                            connection={connection}
                            busy={busyItem === connection.itemId}
                            onSync={(picked) => void runSync(connection.itemId, picked)}
                            onReconnect={() => void onReconnect(connection)}
                            onDisconnect={() => void onDisconnect(connection)}
                        />
                    ))
                )}
            </div>
        </section>
    );
}

const STATUS_LABELS: Record<PlaidConnection["status"], { tone: "ok" | "warn"; text: string } | null> = {
    active: null,
    login_required: { tone: "warn", text: "Sign in again" },
    pending_expiration: { tone: "warn", text: "Access ends soon" },
};

function isInvestment(account: PlaidConnectionAccount): boolean {
    return account.type === "investment";
}

function accountStatus(account: PlaidConnectionAccount) {
    if (!isInvestment(account)) return <span className="pm-plaid-sync-note">Balances only; not synced</span>;
    if (account.syncStatus === "sync_ready") {
        return account.portfolio
            ? <span className="pm-plaid-sync-note is-ok">Syncs into <Link href="/portfolios/accounts">{account.portfolio.name}</Link></span>
            : <span className="pm-plaid-sync-note is-ok">Syncs at the next sync</span>;
    }
    if (account.syncStatus === "excluded") return <span className="pm-plaid-sync-note">Not synced</span>;
    return <span className="pm-plaid-sync-note is-warn">Waiting for you to choose</span>;
}

function ConnectionRow({
    connection,
    busy,
    onSync,
    onReconnect,
    onDisconnect,
}: {
    connection: PlaidConnection;
    busy: boolean;
    onSync: (picked?: string[]) => void;
    onReconnect: () => void;
    onDisconnect: () => void;
}) {
    const label = STATUS_LABELS[connection.status];
    const name = connection.institutionName ?? "Linked institution";
    const syncing = connection.accounts.filter((a) => isInvestment(a) && a.syncStatus === "sync_ready").length;
    const waiting = connection.accounts.filter((a) => isInvestment(a) && a.syncStatus === "awaiting_selection");
    const [picked, setPicked] = useState<string[]>([]);
    const needsLogin = connection.status === "login_required";

    return (
        <div className={`pm-integration-row pm-plaid-connection is-${label?.tone ?? "ok"}`} data-testid="plaid-connection">
            <div className="pm-integration-logo" aria-hidden="true">{name.charAt(0).toUpperCase()}</div>
            <div className="pm-integration-meta">
                <div className="pm-integration-name">
                    {name}
                    <span className="pm-integration-provider">Plaid</span>
                    {label && <span className="pm-integration-provider is-warn">{label.text}</span>}
                </div>
                <div className="pm-integration-status">
                    {label ? (
                        <AlertTriangle className="pm-integration-status-icon" aria-hidden="true" />
                    ) : (
                        <CheckCircle2 className="pm-integration-status-icon" aria-hidden="true" />
                    )}
                    <span>
                        {syncing} {syncing === 1 ? "account syncs" : "accounts sync"} · {formatWhen(connection.lastSuccessfulSyncAt)}
                    </span>
                </div>
                <ul className="pm-plaid-connection-accounts" aria-label={`${name} accounts`}>
                    {connection.accounts.map((account) => (
                        <li key={account.plaidAccountId}>
                            <span className="pm-plaid-account-name">
                                {account.name}
                                {account.mask && <span className="pm-integration-mask"> ••{account.mask}</span>}
                            </span>
                            {accountStatus(account)}
                        </li>
                    ))}
                </ul>
                {waiting.length > 0 && (
                    <div className="pm-plaid-pick" data-testid="plaid-pick">
                        <p className="pm-plaid-panel-copy">Choose which of these accounts to sync into Atlas:</p>
                        {waiting.map((account) => (
                            <label key={account.plaidAccountId} className="pm-plaid-account">
                                <input
                                    type="checkbox"
                                    checked={picked.includes(account.plaidAccountId)}
                                    onChange={() => setPicked((current) => current.includes(account.plaidAccountId)
                                        ? current.filter((id) => id !== account.plaidAccountId)
                                        : [...current, account.plaidAccountId])}
                                    aria-label={`Sync ${account.name}`}
                                />
                                <span className="pm-plaid-account-main">
                                    <span className="pm-plaid-account-name">{account.name}</span>
                                    <span className="pm-plaid-account-meta">{account.subtype}{account.mask ? ` · ••${account.mask}` : ""}</span>
                                </span>
                            </label>
                        ))}
                        <div className="pm-plaid-actions">
                            <button
                                type="button"
                                className="pm-settings-card-cta"
                                disabled={busy || picked.length === 0 || needsLogin}
                                onClick={() => onSync(picked)}
                            >
                                Sync selected
                            </button>
                        </div>
                    </div>
                )}
            </div>
            <div className="pm-plaid-connection-actions">
                {connection.status === "active" || connection.status === "pending_expiration" ? (
                    <button type="button" className="pm-integration-action is-ghost" onClick={() => onSync()} disabled={busy}>
                        {busy ? "…" : "Sync now"}
                    </button>
                ) : null}
                {connection.status !== "active" && (
                    <button type="button" className="pm-integration-action is-warn" onClick={onReconnect} disabled={busy}>
                        Reconnect
                    </button>
                )}
                <button type="button" className="pm-integration-action" onClick={onDisconnect} disabled={busy}>
                    Disconnect
                </button>
            </div>
        </div>
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
                    {status === "saving" ? "Bringing in holdings…" : "Connect selected"}
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
