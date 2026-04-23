"use client";

import { useMemo, useState } from "react";
import { Check, AlertTriangle, X } from "lucide-react";
import {
    BUYING_POWER_USD,
    COMMISSION_PER_TRADE_USD,
    CURRENT_POSITIONS,
    LIVE_PRICES,
    SEED_ORDERS,
} from "@/lib/execution/seed";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import type {
    Order,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
} from "@/types/execution";

/**
 * Phase 7 (AR-84) Execution Focus variant.
 *
 * Default layout: split order form on the left, today's orders on the
 * right. One screen, everything visible, no modals. Calm.
 *
 * Left card "New order":
 *   - Buy / Sell segmented toggle (green / red)
 *   - Ticker + live price hint
 *   - Quantity input
 *   - Order type select (market / limit / stop / stop_limit)
 *   - Limit price (conditional on limit / stop_limit)
 *   - Stop price (conditional on stop / stop_limit)
 *   - TIF segmented pill row (DAY / GTC / IOC / FOK)
 *   - Preview rows: Notional, Est. commission, Buying power after, Position after
 *   - Guardrail list with green/warn dots (concentration, sector, buying power, volatility)
 *   - Foot: Save draft + Review & submit (primary on buy, danger on sell)
 *
 * Right card "Today's orders":
 *   - Filter chips: All / Working / Filled / Rejected
 *   - Orders table with side pill + status pill
 *   - Approval queue banner when there are orders above the threshold
 *
 * All state is client-local. Submitting an order pushes into the local
 * list — the actual broker round-trip lands when the backend API is
 * wired in a follow-up. The backend shape matches `Order` so it's a
 * drop-in.
 */

type BlotterFilter = "all" | "working" | "filled" | "rejected";

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
    market: "Market",
    limit: "Limit",
    stop: "Stop",
    stop_limit: "Stop-limit",
};

const TIF_OPTIONS: TimeInForce[] = ["day", "gtc", "ioc", "fok"];
const TIF_LABELS: Record<TimeInForce, string> = {
    day: "DAY",
    gtc: "GTC",
    ioc: "IOC",
    fok: "FOK",
};

const STATUS_LABELS: Record<OrderStatus, string> = {
    pending: "Pending",
    working: "Working",
    filled: "Filled",
    cancelled: "Cancelled",
    rejected: "Rejected",
};

const STATUS_CLASS: Record<OrderStatus, string> = {
    pending: "pm-exec-status-pending",
    working: "pm-exec-status-working",
    filled: "pm-exec-status-filled",
    cancelled: "pm-exec-status-cancelled",
    rejected: "pm-exec-status-rejected",
};

// --------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------- //

function formatUsd(n: number, digits = 2): string {
    return n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
}

function formatTime(d: Date): string {
    return d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });
}

/** Resolve the effective per-share price for a draft order. */
function effectivePrice(ticker: string, type: OrderType, limit?: number, stop?: number): number {
    if ((type === "limit" || type === "stop_limit") && limit && limit > 0) return limit;
    if (type === "stop" && stop && stop > 0) return stop;
    return LIVE_PRICES[ticker] ?? 0;
}

// --------------------------------------------------------------------- //
// FocusVariant
// --------------------------------------------------------------------- //

export function FocusVariant() {
    const [orders, setOrders] = useState<Order[]>(SEED_ORDERS);
    const [filter, setFilter] = useState<BlotterFilter>("all");

    const onSubmitOrder = (draft: Order) => {
        setOrders((prev) => [draft, ...prev]);
    };

    const onCancel = (id: string) => {
        setOrders((prev) =>
            prev.map((o) =>
                o.id === id ? { ...o, status: "cancelled", updatedAt: new Date() } : o,
            ),
        );
    };

    const onApprove = (id: string) => {
        setOrders((prev) =>
            prev.map((o) =>
                o.id === id ? { ...o, status: "working", updatedAt: new Date() } : o,
            ),
        );
    };

    return (
        <div className="pm-exec-focus">
            <OrderForm onSubmit={onSubmitOrder} />
            <OrdersPanel
                orders={orders}
                filter={filter}
                onFilter={setFilter}
                onCancel={onCancel}
                onApprove={onApprove}
            />
        </div>
    );
}

// --------------------------------------------------------------------- //
// Order form — left card
// --------------------------------------------------------------------- //

interface OrderFormProps {
    onSubmit: (order: Order) => void;
}

function OrderForm({ onSubmit }: OrderFormProps) {
    const [side, setSide] = useState<OrderSide>("buy");
    const [ticker, setTicker] = useState<string>("AAPL");
    const [quantity, setQuantity] = useState<number>(50);
    const [type, setType] = useState<OrderType>("limit");
    const [limitPrice, setLimitPrice] = useState<number>(225.0);
    const [stopPrice, setStopPrice] = useState<number>(220.0);
    const [tif, setTif] = useState<TimeInForce>("day");

    // Guardrail settings (AR-89) — user prefs from the Settings store.
    // When a toggle is off, the corresponding check becomes a no-op.
    const guardrailPrefs = useSettingsStore((s) => s.guardrails);

    const tickerUpper = ticker.toUpperCase();
    const livePrice = LIVE_PRICES[tickerUpper];
    const price = effectivePrice(tickerUpper, type, limitPrice, stopPrice);
    const notional = price * (Number.isFinite(quantity) ? quantity : 0);
    const commission = COMMISSION_PER_TRADE_USD;
    const buyingPowerAfter =
        side === "buy"
            ? BUYING_POWER_USD - notional - commission
            : BUYING_POWER_USD + notional - commission;

    const currentPos = CURRENT_POSITIONS[tickerUpper];
    const currentQty = currentPos?.qty ?? 0;
    const qtyDelta = side === "buy" ? quantity : -quantity;
    const positionAfter = currentQty + qtyDelta;

    const showLimit = type === "limit" || type === "stop_limit";
    const showStop = type === "stop" || type === "stop_limit";

    const guardrails = useGuardrails({
        side,
        notional,
        buyingPowerAfter,
        positionAfter,
        ticker: tickerUpper,
        concentrationCapEnabled: guardrailPrefs.concentrationCapEnabled,
        concentrationCapPct: guardrailPrefs.concentrationCapPct,
    });

    const submitDisabled =
        !tickerUpper ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        (showLimit && (!limitPrice || limitPrice <= 0)) ||
        (showStop && (!stopPrice || stopPrice <= 0)) ||
        guardrails.some((g) => g.level === "fail");

    const handleSubmit = () => {
        if (submitDisabled) return;
        const draft: Order = {
            id: `o-${Date.now().toString(36)}`,
            portfolioId: "p-growth",
            ticker: tickerUpper,
            side,
            type,
            quantity,
            limitPrice: showLimit ? limitPrice : undefined,
            stopPrice: showStop ? stopPrice : undefined,
            status:
                guardrailPrefs.approvalThresholdEnabled &&
                notional > guardrailPrefs.approvalThresholdUsd
                    ? "pending"
                    : "working",
            filledQuantity: 0,
            timeInForce: tif,
            placedAt: new Date(),
            updatedAt: new Date(),
        };
        onSubmit(draft);
    };

    const submitLabel = side === "buy" ? "Review & buy" : "Review & sell";
    const submitClass =
        side === "buy" ? "pm-btn pm-btn-primary" : "pm-btn pm-btn-danger";

    return (
        <section
            className="pm-exec-form pm-card"
            aria-label="New order"
            data-side={side}
        >
            <header className="pm-exec-form-head">
                <h3 className="pm-exec-form-title">New order</h3>
                <span className="pm-exec-form-sub">
                    Draft routes to review. Never fills on click.
                </span>
            </header>

            {/* Side toggle */}
            <div className="pm-exec-side" role="tablist" aria-label="Order side">
                <button
                    type="button"
                    role="tab"
                    aria-selected={side === "buy"}
                    className={`pm-exec-side-btn is-buy${side === "buy" ? " is-active" : ""}`}
                    onClick={() => setSide("buy")}
                >
                    Buy
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={side === "sell"}
                    className={`pm-exec-side-btn is-sell${side === "sell" ? " is-active" : ""}`}
                    onClick={() => setSide("sell")}
                >
                    Sell
                </button>
            </div>

            {/* Ticker */}
            <label className="pm-exec-field">
                <span className="pm-exec-field-label">Ticker</span>
                <div className="pm-exec-field-wrap">
                    <input
                        type="text"
                        className="pm-exec-input"
                        value={ticker}
                        onChange={(e) => setTicker(e.target.value.toUpperCase())}
                        placeholder="AAPL"
                        maxLength={6}
                    />
                    <span className="pm-exec-field-hint num">
                        {livePrice ? formatUsd(livePrice) : "—"}
                    </span>
                </div>
            </label>

            {/* Qty + Type */}
            <div className="pm-exec-row-2">
                <label className="pm-exec-field">
                    <span className="pm-exec-field-label">Quantity</span>
                    <input
                        type="number"
                        className="pm-exec-input num"
                        value={quantity}
                        min={1}
                        step={1}
                        onChange={(e) => setQuantity(Number(e.target.value))}
                    />
                </label>

                <label className="pm-exec-field">
                    <span className="pm-exec-field-label">Order type</span>
                    <select
                        className="pm-exec-input"
                        value={type}
                        onChange={(e) => setType(e.target.value as OrderType)}
                    >
                        {(Object.keys(ORDER_TYPE_LABELS) as OrderType[]).map((t) => (
                            <option key={t} value={t}>{ORDER_TYPE_LABELS[t]}</option>
                        ))}
                    </select>
                </label>
            </div>

            {/* Conditional price rows */}
            {(showLimit || showStop) && (
                <div className="pm-exec-row-2">
                    {showLimit && (
                        <label className="pm-exec-field">
                            <span className="pm-exec-field-label">Limit price</span>
                            <input
                                type="number"
                                className="pm-exec-input num"
                                value={limitPrice}
                                step={0.01}
                                onChange={(e) => setLimitPrice(Number(e.target.value))}
                            />
                        </label>
                    )}
                    {showStop && (
                        <label className="pm-exec-field">
                            <span className="pm-exec-field-label">Stop price</span>
                            <input
                                type="number"
                                className="pm-exec-input num"
                                value={stopPrice}
                                step={0.01}
                                onChange={(e) => setStopPrice(Number(e.target.value))}
                            />
                        </label>
                    )}
                    {/* Ghost cell to keep the grid aligned when only one shows */}
                    {showLimit !== showStop && <div aria-hidden />}
                </div>
            )}

            {/* TIF */}
            <div className="pm-exec-field">
                <span className="pm-exec-field-label">Time in force</span>
                <div className="pm-exec-tif" role="tablist" aria-label="Time in force">
                    {TIF_OPTIONS.map((t) => (
                        <button
                            key={t}
                            type="button"
                            role="tab"
                            aria-selected={tif === t}
                            className={`pm-exec-tif-btn${tif === t ? " is-active" : ""}`}
                            onClick={() => setTif(t)}
                        >
                            {TIF_LABELS[t]}
                        </button>
                    ))}
                </div>
            </div>

            {/* Preview */}
            <div className="pm-exec-preview" role="list" aria-label="Order preview">
                <PreviewRow label="Notional" value={formatUsd(notional)} />
                <PreviewRow
                    label="Est. commission"
                    value={commission === 0 ? "Free" : formatUsd(commission)}
                />
                <PreviewRow
                    label="Buying power after"
                    value={formatUsd(buyingPowerAfter)}
                    tone={buyingPowerAfter < 0 ? "pm-num-neg" : ""}
                />
                <PreviewRow
                    label="Position after"
                    value={`${positionAfter.toLocaleString()} sh`}
                    tone={positionAfter < 0 ? "pm-num-neg" : ""}
                />
            </div>

            {/* Guardrails */}
            <div className="pm-exec-guardrails" role="list" aria-label="Guardrails">
                {guardrails.map((g) => (
                    <div
                        key={g.label}
                        className={`pm-exec-guardrail is-${g.level}`}
                        role="listitem"
                    >
                        <span className="pm-exec-guardrail-dot" aria-hidden="true" />
                        <span className="pm-exec-guardrail-label">{g.label}</span>
                        <span className="pm-exec-guardrail-msg">{g.message}</span>
                    </div>
                ))}
            </div>

            {/* Foot */}
            <footer className="pm-exec-form-foot">
                <button type="button" className="pm-btn pm-btn-ghost">
                    Save draft
                </button>
                <button
                    type="button"
                    className={submitClass}
                    disabled={submitDisabled}
                    onClick={handleSubmit}
                >
                    {submitLabel}
                </button>
            </footer>
        </section>
    );
}

function PreviewRow({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: string;
}) {
    return (
        <div className="pm-exec-preview-row" role="listitem">
            <span className="pm-exec-preview-label">{label}</span>
            <span className={`pm-exec-preview-value num${tone ? ` ${tone}` : ""}`}>
                {value}
            </span>
        </div>
    );
}

// --------------------------------------------------------------------- //
// Guardrails — pure derivation
// --------------------------------------------------------------------- //

type GuardrailLevel = "ok" | "warn" | "fail";
interface Guardrail {
    label: string;
    message: string;
    level: GuardrailLevel;
}

function useGuardrails({
    side,
    notional,
    buyingPowerAfter,
    positionAfter,
    ticker,
    concentrationCapEnabled,
    concentrationCapPct,
}: {
    side: OrderSide;
    notional: number;
    buyingPowerAfter: number;
    positionAfter: number;
    ticker: string;
    concentrationCapEnabled: boolean;
    concentrationCapPct: number;
}): Guardrail[] {
    return useMemo(() => {
        const bp: Guardrail =
            buyingPowerAfter < 0
                ? {
                    label: "Buying power",
                    message: `Short ${formatUsd(Math.abs(buyingPowerAfter))}`,
                    level: "fail",
                }
                : buyingPowerAfter < BUYING_POWER_USD * 0.05
                    ? {
                        label: "Buying power",
                        message: `Thin: ${formatUsd(buyingPowerAfter)} left`,
                        level: "warn",
                    }
                    : {
                        label: "Buying power",
                        message: `${formatUsd(buyingPowerAfter)} available after`,
                        level: "ok",
                    };

        // Concentration — post-trade position value as a % of NAV.
        // Thresholds come from the user's Settings › Guardrails card
        // (AR-89). When the toggle is off we surface a neutral chip so
        // the user still sees that the check ran — just with no ceiling.
        // The warn band kicks in at 80% of the hard cap so big names
        // light up amber before they block the order.
        const navUsd = 250_000;
        const postPosValue = positionAfter * (LIVE_PRICES[ticker] ?? 0);
        const concentrationPct = Math.abs(postPosValue) / navUsd;
        const capFrac = concentrationCapPct / 100;
        const warnFrac = capFrac * 0.8;
        const conc: Guardrail = !concentrationCapEnabled
            ? {
                label: "Concentration",
                message: `${(concentrationPct * 100).toFixed(1)}% of NAV (cap off)`,
                level: "ok",
            }
            : concentrationPct > capFrac
                ? {
                    label: "Concentration",
                    message: `${(concentrationPct * 100).toFixed(1)}% of NAV (cap ${concentrationCapPct}%)`,
                    level: "fail",
                }
                : concentrationPct > warnFrac
                    ? {
                        label: "Concentration",
                        message: `${(concentrationPct * 100).toFixed(1)}% of NAV`,
                        level: "warn",
                    }
                    : {
                        label: "Concentration",
                        message: `${(concentrationPct * 100).toFixed(1)}% of NAV`,
                        level: "ok",
                    };

        // Sector cap — faked from the ticker. Real impl joins to holdings.
        const techTickers = new Set(["AAPL", "MSFT", "NVDA", "GOOGL", "META", "AMD", "TSLA"]);
        const sectorHit = techTickers.has(ticker);
        const sector: Guardrail = sectorHit
            ? {
                label: "Sector cap",
                message: "Tech 47% of NAV (cap 55%)",
                level: "ok",
            }
            : {
                label: "Sector cap",
                message: "Within sector caps",
                level: "ok",
            };

        // Volatility — uses notional size as a proxy. Again, replaced by
        // real ATR/IV checks when the backend lands.
        const vol: Guardrail =
            notional > 50_000
                ? {
                    label: "Volatility",
                    message: "Size > 2× avg daily bar",
                    level: "warn",
                }
                : {
                    label: "Volatility",
                    message: "Within normal volatility band",
                    level: "ok",
                };

        // Short-sale check.
        const shortCheck: Guardrail | null =
            side === "sell" && positionAfter < 0
                ? {
                    label: "Short sale",
                    message: `Would open ${Math.abs(positionAfter)} share short`,
                    level: "warn",
                }
                : null;

        return [bp, conc, sector, vol, ...(shortCheck ? [shortCheck] : [])];
    }, [
        side,
        notional,
        buyingPowerAfter,
        positionAfter,
        ticker,
        concentrationCapEnabled,
        concentrationCapPct,
    ]);
}

// --------------------------------------------------------------------- //
// Orders panel — right card
// --------------------------------------------------------------------- //

interface OrdersPanelProps {
    orders: Order[];
    filter: BlotterFilter;
    onFilter: (f: BlotterFilter) => void;
    onCancel: (id: string) => void;
    onApprove: (id: string) => void;
}

function OrdersPanel({
    orders,
    filter,
    onFilter,
    onCancel,
    onApprove,
}: OrdersPanelProps) {
    // AR-89: the approval queue threshold is user-configurable. Reading
    // the slice here (not at FocusVariant) keeps prop plumbing shallow
    // and colocates the read with the only two places that need it:
    // the `approvalQueue` filter below and the banner's copy.
    const guardrailPrefs = useSettingsStore((s) => s.guardrails);
    const counts = useMemo(() => {
        const c: Record<BlotterFilter, number> = {
            all: orders.length,
            working: 0,
            filled: 0,
            rejected: 0,
        };
        for (const o of orders) {
            if (o.status === "working") c.working += 1;
            else if (o.status === "filled") c.filled += 1;
            else if (o.status === "rejected") c.rejected += 1;
        }
        return c;
    }, [orders]);

    const filtered = useMemo(() => {
        if (filter === "all") return orders;
        return orders.filter((o) => o.status === filter);
    }, [orders, filter]);

    const approvalQueue = useMemo(
        () =>
            orders.filter(
                (o) =>
                    o.status === "pending" ||
                    (o.status === "working" &&
                        guardrailPrefs.approvalThresholdEnabled &&
                        (o.limitPrice ?? LIVE_PRICES[o.ticker] ?? 0) * o.quantity >
                            guardrailPrefs.approvalThresholdUsd),
            ),
        [
            orders,
            guardrailPrefs.approvalThresholdEnabled,
            guardrailPrefs.approvalThresholdUsd,
        ],
    );

    return (
        <section className="pm-exec-blotter pm-card" aria-label="Today's orders">
            <header className="pm-exec-blotter-head">
                <h3 className="pm-exec-blotter-title">Today&rsquo;s orders</h3>
                <div className="pm-exec-chips" role="tablist" aria-label="Order filter">
                    {(["all", "working", "filled", "rejected"] as BlotterFilter[]).map((f) => (
                        <button
                            key={f}
                            type="button"
                            role="tab"
                            aria-selected={filter === f}
                            className={`pm-exec-chip${filter === f ? " is-active" : ""}`}
                            onClick={() => onFilter(f)}
                        >
                            {f === "all"
                                ? "All"
                                : f === "working"
                                    ? "Working"
                                    : f === "filled"
                                        ? "Filled"
                                        : "Rejected"}
                            <span className="pm-exec-chip-count">{counts[f]}</span>
                        </button>
                    ))}
                </div>
            </header>

            {approvalQueue.length > 0 && (
                <ApprovalBanner
                    orders={approvalQueue}
                    threshold={guardrailPrefs.approvalThresholdUsd}
                    onCancel={onCancel}
                    onApprove={onApprove}
                />
            )}

            <OrdersTable orders={filtered} onCancel={onCancel} />
        </section>
    );
}

function ApprovalBanner({
    orders,
    threshold,
    onCancel,
    onApprove,
}: {
    orders: Order[];
    threshold: number;
    onCancel: (id: string) => void;
    onApprove: (id: string) => void;
}) {
    return (
        <div className="pm-exec-approval" role="region" aria-label="Approval queue">
            <div className="pm-exec-approval-head">
                <AlertTriangle className="pm-exec-approval-icon" aria-hidden="true" />
                <div className="pm-exec-approval-text">
                    <div className="pm-exec-approval-title">
                        {orders.length} order{orders.length > 1 ? "s" : ""} above {formatUsd(threshold, 0)} threshold
                    </div>
                    <div className="pm-exec-approval-sub">
                        Cancel or approve before routing to the broker.
                    </div>
                </div>
            </div>
            <ul className="pm-exec-approval-list" role="list">
                {orders.map((o) => {
                    const price = o.limitPrice ?? LIVE_PRICES[o.ticker] ?? 0;
                    const notional = price * o.quantity;
                    return (
                        <li key={o.id} className="pm-exec-approval-row">
                            <span className={`pm-exec-side-pill is-${o.side}`}>
                                {o.side.toUpperCase()}
                            </span>
                            <span className="pm-exec-approval-ticker">{o.ticker}</span>
                            <span className="pm-exec-approval-qty num">
                                {o.quantity.toLocaleString()} @ {formatUsd(price)}
                            </span>
                            <span className="pm-exec-approval-notional num">
                                {formatUsd(notional)}
                            </span>
                            <div className="pm-exec-approval-actions">
                                <button
                                    type="button"
                                    className="pm-btn pm-btn-ghost pm-exec-btn-sm"
                                    onClick={() => onCancel(o.id)}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="pm-btn pm-btn-primary pm-exec-btn-sm"
                                    onClick={() => onApprove(o.id)}
                                >
                                    <Check className="pm-exec-btn-icon" aria-hidden="true" />
                                    Approve
                                </button>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function OrdersTable({
    orders,
    onCancel,
}: {
    orders: Order[];
    onCancel: (id: string) => void;
}) {
    if (orders.length === 0) {
        return (
            <div className="pm-exec-empty">
                No orders in this view.
            </div>
        );
    }

    return (
        <div className="pm-exec-table-wrap">
            <table className="pm-exec-table">
                <thead>
                    <tr>
                        <th scope="col">Time</th>
                        <th scope="col">Side</th>
                        <th scope="col">Ticker</th>
                        <th scope="col">Type</th>
                        <th scope="col" className="num-col">Qty</th>
                        <th scope="col" className="num-col">Price</th>
                        <th scope="col">Status</th>
                        <th scope="col" aria-label="Actions" />
                    </tr>
                </thead>
                <tbody>
                    {orders.map((o) => {
                        const price =
                            o.type === "market"
                                ? o.averageFillPrice ?? LIVE_PRICES[o.ticker]
                                : o.limitPrice ?? o.stopPrice;
                        return (
                            <tr key={o.id}>
                                <td className="num">{formatTime(o.placedAt)}</td>
                                <td>
                                    <span className={`pm-exec-side-pill is-${o.side}`}>
                                        {o.side.toUpperCase()}
                                    </span>
                                </td>
                                <td className="pm-exec-table-ticker">{o.ticker}</td>
                                <td>{ORDER_TYPE_LABELS[o.type]}</td>
                                <td className="num-col num">{o.quantity.toLocaleString()}</td>
                                <td className="num-col num">
                                    {price ? formatUsd(price) : "—"}
                                </td>
                                <td>
                                    <span className={`pm-exec-status ${STATUS_CLASS[o.status]}`}>
                                        {STATUS_LABELS[o.status]}
                                    </span>
                                </td>
                                <td className="pm-exec-table-action">
                                    {o.status === "working" && (
                                        <button
                                            type="button"
                                            className="pm-exec-cancel"
                                            onClick={() => onCancel(o.id)}
                                            aria-label={`Cancel ${o.ticker} order`}
                                        >
                                            <X className="pm-exec-cancel-icon" aria-hidden="true" />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
