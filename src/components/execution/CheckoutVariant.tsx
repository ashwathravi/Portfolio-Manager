"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Minus, Plus, Sparkles } from "lucide-react";
import {
    BUYING_POWER_USD,
    CURRENT_POSITIONS,
    LIVE_PRICES,
    SEED_ORDERS,
} from "@/lib/execution/seed";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import type {
    Order,
    OrderSide,
    OrderStatus,
} from "@/types/execution";

/**
 * Phase 7 (AR-85) Execution Checkout variant.
 *
 * Stripe-Checkout-style four-step wizard. Lower cognitive load than the
 * Focus variant because the user only makes one decision at a time:
 *
 *   1. SECURITY · pick the ticker.
 *   2. SIZING   · how many shares. Shortcut chips (10/25/50/100, 25% of
 *                 buying power, Match thesis target) keep typing to a
 *                 minimum; a limit slider with tick marks sets the price.
 *   3. THESIS   · why. Free-text + a short pre-canned set of thesis
 *                 anchors ("momentum breakout", "earnings beat", …).
 *   4. REVIEW   · confirm. A side-facing submit button ships the order.
 *
 * The right-hand receipt card is always visible. It recomputes live
 * every time the user nudges qty or drags the limit slider so the
 * impact bar (position % before → after), the locked-price countdown,
 * and the green-dot guardrail checks update in real time. That's the
 * whole point of Checkout: confidence before the click.
 *
 * Below the two-column split sits a compact recent-orders blotter so
 * the user can see what they already have working without leaving the
 * wizard.
 */

type CheckoutStep = "security" | "sizing" | "thesis" | "review";
const STEP_ORDER: CheckoutStep[] = ["security", "sizing", "thesis", "review"];
const STEP_LABELS: Record<CheckoutStep, string> = {
    security: "Security",
    sizing: "Sizing",
    thesis: "Thesis",
    review: "Review",
};

const THESIS_ANCHORS = [
    "Momentum breakout",
    "Earnings beat",
    "Mean reversion",
    "Sector rotation",
    "Pair-trade leg",
    "Rebalance top-up",
] as const;

const SECURITY_OPTIONS = ["AAPL", "MSFT", "NVDA", "TSLA", "GOOGL", "META", "AMZN"] as const;

// Locked-price window — the receipt pretends the quote is good for this
// long before the user needs to re-review. 60s keeps the urgency real
// without making the UI feel like it's racing the trader.
const LOCK_SECONDS = 60;

export function CheckoutVariant() {
    const [step, setStep] = useState<CheckoutStep>("sizing");
    const [side, setSide] = useState<OrderSide>("buy");
    const [ticker, setTicker] = useState<string>("NVDA");
    const [qty, setQty] = useState<number>(50);
    const [limit, setLimit] = useState<number>(LIVE_PRICES.NVDA ?? 100);
    const [thesis, setThesis] = useState<string>("");
    const [thesisAnchor, setThesisAnchor] = useState<string | null>(null);
    const [orders, setOrders] = useState<Order[]>(SEED_ORDERS);

    // AR-89: pull the user's guardrail prefs so the approval gate here
    // matches the Focus variant and the Settings › Guardrails card.
    const guardrailPrefs = useSettingsStore((s) => s.guardrails);

    // Re-seed the limit when the ticker changes so it defaults to the
    // current live price.
    useEffect(() => {
        const live = LIVE_PRICES[ticker];
        // Ticker changes should reset the locally buffered limit draft.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (live) setLimit(live);
    }, [ticker]);

    const stepIdx = STEP_ORDER.indexOf(step);
    const canBack = stepIdx > 0;
    const canNext = stepIdx < STEP_ORDER.length - 1;

    const goBack = () => {
        if (canBack) setStep(STEP_ORDER[stepIdx - 1]);
    };
    const goNext = () => {
        if (canNext) setStep(STEP_ORDER[stepIdx + 1]);
    };

    const onSubmit = () => {
        const draft: Order = {
            id: `o-${Date.now().toString(36)}`,
            portfolioId: "p-growth",
            ticker,
            side,
            type: "limit",
            quantity: qty,
            limitPrice: limit,
            status:
                guardrailPrefs.approvalThresholdEnabled &&
                limit * qty > guardrailPrefs.approvalThresholdUsd
                    ? "pending"
                    : "working",
            filledQuantity: 0,
            timeInForce: "day",
            placedAt: new Date(),
            updatedAt: new Date(),
        };
        setOrders((prev) => [draft, ...prev]);
        // Reset back to step 1 so the wizard is ready for the next order.
        setStep("security");
        setThesis("");
        setThesisAnchor(null);
    };

    return (
        <div className="pm-exec-checkout">
            <Stepper step={step} onJump={setStep} />

            <div className="pm-exec-checkout-split">
                <section className="pm-card pm-co-form">
                    {step === "security" && (
                        <SecurityStep
                            side={side}
                            ticker={ticker}
                            onChangeSide={setSide}
                            onChangeTicker={setTicker}
                        />
                    )}
                    {step === "sizing" && (
                        <SizingStep
                            ticker={ticker}
                            qty={qty}
                            limit={limit}
                            onChangeQty={setQty}
                            onChangeLimit={setLimit}
                        />
                    )}
                    {step === "thesis" && (
                        <ThesisStep
                            ticker={ticker}
                            anchor={thesisAnchor}
                            thesis={thesis}
                            onChangeAnchor={setThesisAnchor}
                            onChangeThesis={setThesis}
                        />
                    )}
                    {step === "review" && (
                        <ReviewStep
                            side={side}
                            ticker={ticker}
                            qty={qty}
                            limit={limit}
                            thesis={thesis}
                            thesisAnchor={thesisAnchor}
                        />
                    )}

                    <footer className="pm-co-form-foot">
                        <button
                            type="button"
                            className="pm-btn pm-btn-ghost"
                            disabled={!canBack}
                            onClick={goBack}
                        >
                            <ArrowLeft className="pm-co-foot-icon" aria-hidden="true" />
                            Back
                        </button>
                        {step === "review" ? (
                            <button
                                type="button"
                                className={side === "buy" ? "pm-btn pm-btn-primary" : "pm-btn pm-btn-danger"}
                                onClick={onSubmit}
                            >
                                Submit order
                                <ArrowRight className="pm-co-foot-icon" aria-hidden="true" />
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="pm-btn pm-btn-primary"
                                onClick={goNext}
                            >
                                Continue
                                <ArrowRight className="pm-co-foot-icon" aria-hidden="true" />
                            </button>
                        )}
                    </footer>
                </section>

                <Receipt side={side} ticker={ticker} qty={qty} limit={limit} />
            </div>

            <RecentOrders orders={orders} />
        </div>
    );
}

// --------------------------------------------------------------------- //
// Stepper
// --------------------------------------------------------------------- //

function Stepper({
    step,
    onJump,
}: {
    step: CheckoutStep;
    onJump: (s: CheckoutStep) => void;
}) {
    const currentIdx = STEP_ORDER.indexOf(step);
    return (
        <ol className="pm-co-stepper" role="list" aria-label="Checkout steps">
            {STEP_ORDER.map((s, i) => {
                const state: "done" | "active" | "pending" =
                    i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
                return (
                    <li key={s} className={`pm-co-step is-${state}`}>
                        <button
                            type="button"
                            className="pm-co-step-btn"
                            onClick={() => onJump(s)}
                            aria-current={state === "active" ? "step" : undefined}
                            disabled={state === "pending"}
                        >
                            <span className="pm-co-step-dot" aria-hidden="true">
                                {state === "done" ? (
                                    <Check className="pm-co-step-check" strokeWidth={3} />
                                ) : (
                                    <span className="pm-co-step-num">{i + 1}</span>
                                )}
                            </span>
                            <span className="pm-co-step-label">{STEP_LABELS[s]}</span>
                        </button>
                        {i < STEP_ORDER.length - 1 && (
                            <span className="pm-co-step-line" aria-hidden="true" />
                        )}
                    </li>
                );
            })}
        </ol>
    );
}

// --------------------------------------------------------------------- //
// Step 1 · Security
// --------------------------------------------------------------------- //

function SecurityStep({
    side,
    ticker,
    onChangeSide,
    onChangeTicker,
}: {
    side: OrderSide;
    ticker: string;
    onChangeSide: (s: OrderSide) => void;
    onChangeTicker: (t: string) => void;
}) {
    return (
        <div className="pm-co-step-body">
            <div className="pm-co-kicker">STEP 1 OF 4</div>
            <h2 className="pm-co-title">What do you want to trade?</h2>
            <p className="pm-co-helper">
                Pick the side and the security. The receipt on the right will
                recompute as you go.
            </p>

            <div className="pm-co-side">
                <button
                    type="button"
                    role="tab"
                    aria-selected={side === "buy"}
                    className={`pm-exec-side-btn is-buy${side === "buy" ? " is-active" : ""}`}
                    onClick={() => onChangeSide("buy")}
                >
                    Buy
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={side === "sell"}
                    className={`pm-exec-side-btn is-sell${side === "sell" ? " is-active" : ""}`}
                    onClick={() => onChangeSide("sell")}
                >
                    Sell
                </button>
            </div>

            <div className="pm-co-security-grid" role="radiogroup" aria-label="Security">
                {SECURITY_OPTIONS.map((t) => {
                    const active = t === ticker;
                    return (
                        <button
                            key={t}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            className={`pm-co-security${active ? " is-active" : ""}`}
                            onClick={() => onChangeTicker(t)}
                        >
                            <span className="pm-co-security-symbol">{t}</span>
                            <span className="pm-co-security-price num">
                                ${LIVE_PRICES[t]?.toFixed(2) ?? "—"}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// --------------------------------------------------------------------- //
// Step 2 · Sizing
// --------------------------------------------------------------------- //

function SizingStep({
    ticker,
    qty,
    limit,
    onChangeQty,
    onChangeLimit,
}: {
    ticker: string;
    qty: number;
    limit: number;
    onChangeQty: (q: number) => void;
    onChangeLimit: (v: number) => void;
}) {
    const livePrice = LIVE_PRICES[ticker] ?? 0;
    // Slider window: ±5% around live price.
    const sliderMin = +(livePrice * 0.95).toFixed(2);
    const sliderMax = +(livePrice * 1.05).toFixed(2);
    const sliderStep = 0.05;

    const shortcuts = [
        { label: "10", value: 10 },
        { label: "25", value: 25 },
        { label: "50", value: 50 },
        { label: "100", value: 100 },
        {
            label: "25% BP",
            value: Math.floor((BUYING_POWER_USD * 0.25) / (livePrice || 1)),
        },
        {
            label: "Match target",
            value: Math.max(10, Math.round(CURRENT_POSITIONS[ticker]?.qty ?? 50)),
        },
    ];

    const slippageBps =
        livePrice > 0
            ? ((limit - livePrice) / livePrice) * 10_000
            : 0;

    return (
        <div className="pm-co-step-body">
            <div className="pm-co-kicker">STEP 2 OF 4</div>
            <h2 className="pm-co-title">How much {ticker} would you like?</h2>
            <p className="pm-co-helper">
                Use the chips for common sizes. The limit slider below sets your
                price — slippage vs. the live quote is shown live.
            </p>

            <div className="pm-co-ticker-card">
                <div className="pm-co-ticker-symbol">{ticker}</div>
                <div className="pm-co-ticker-price num">
                    ${livePrice.toFixed(2)}
                    <span className="pm-co-ticker-label">Live</span>
                </div>
            </div>

            {/* Quantity input with -/+ steppers */}
            <div className="pm-co-qty-row">
                <button
                    type="button"
                    className="pm-co-qty-step"
                    onClick={() => onChangeQty(Math.max(1, qty - 1))}
                    aria-label="Decrement quantity"
                >
                    <Minus className="pm-co-qty-icon" aria-hidden="true" />
                </button>
                <input
                    type="number"
                    className="pm-co-qty-input num"
                    value={qty}
                    min={1}
                    step={1}
                    onChange={(e) => onChangeQty(Math.max(1, Number(e.target.value)))}
                    aria-label="Quantity"
                />
                <button
                    type="button"
                    className="pm-co-qty-step"
                    onClick={() => onChangeQty(qty + 1)}
                    aria-label="Increment quantity"
                >
                    <Plus className="pm-co-qty-icon" aria-hidden="true" />
                </button>
            </div>

            <div className="pm-co-chips">
                {shortcuts.map((s) => (
                    <button
                        key={s.label}
                        type="button"
                        className={`pm-co-chip${qty === s.value ? " is-active" : ""}`}
                        onClick={() => onChangeQty(s.value)}
                    >
                        {s.label}
                    </button>
                ))}
            </div>

            {/* Limit slider */}
            <div className="pm-co-limit">
                <div className="pm-co-limit-head">
                    <span className="pm-co-field-label">Limit price</span>
                    <span className="pm-co-limit-value num">${limit.toFixed(2)}</span>
                </div>
                <input
                    type="range"
                    className="pm-co-slider"
                    min={sliderMin}
                    max={sliderMax}
                    step={sliderStep}
                    value={limit}
                    onChange={(e) => onChangeLimit(Number(e.target.value))}
                    aria-label="Limit price"
                />
                <div className="pm-co-limit-ticks" aria-hidden="true">
                    <span className="num">${sliderMin.toFixed(2)}</span>
                    <span className="num">${livePrice.toFixed(2)}</span>
                    <span className="num">${sliderMax.toFixed(2)}</span>
                </div>
                <div className="pm-co-limit-hint">
                    Slippage vs. live:{" "}
                    <span
                        className={`num ${
                            slippageBps > 0
                                ? "pm-num-neg"
                                : slippageBps < 0
                                    ? "pm-num-pos"
                                    : ""
                        }`}
                    >
                        {slippageBps >= 0 ? "+" : "−"}
                        {Math.abs(slippageBps).toFixed(1)} bps
                    </span>
                </div>
            </div>
        </div>
    );
}

// --------------------------------------------------------------------- //
// Step 3 · Thesis
// --------------------------------------------------------------------- //

function ThesisStep({
    ticker,
    anchor,
    thesis,
    onChangeAnchor,
    onChangeThesis,
}: {
    ticker: string;
    anchor: string | null;
    thesis: string;
    onChangeAnchor: (a: string | null) => void;
    onChangeThesis: (t: string) => void;
}) {
    return (
        <div className="pm-co-step-body">
            <div className="pm-co-kicker">STEP 3 OF 4</div>
            <h2 className="pm-co-title">Why {ticker}, why now?</h2>
            <p className="pm-co-helper">
                Pick an anchor and add a sentence. Future-you will thank
                present-you when this trade is three months old and the charts
                look different.
            </p>

            <div className="pm-co-thesis-anchors" role="radiogroup" aria-label="Thesis anchor">
                {THESIS_ANCHORS.map((a) => {
                    const active = a === anchor;
                    return (
                        <button
                            key={a}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            className={`pm-co-chip${active ? " is-active" : ""}`}
                            onClick={() => onChangeAnchor(active ? null : a)}
                        >
                            <Sparkles className="pm-co-anchor-icon" aria-hidden="true" />
                            {a}
                        </button>
                    );
                })}
            </div>

            <label className="pm-co-field">
                <span className="pm-co-field-label">Notes</span>
                <textarea
                    className="pm-co-textarea"
                    rows={5}
                    value={thesis}
                    onChange={(e) => onChangeThesis(e.target.value)}
                    placeholder={`Breaking above the 50-day with ${ticker} upgrading guide next week. Sizing 1% of NAV.`}
                />
            </label>
        </div>
    );
}

// --------------------------------------------------------------------- //
// Step 4 · Review
// --------------------------------------------------------------------- //

function ReviewStep({
    side,
    ticker,
    qty,
    limit,
    thesis,
    thesisAnchor,
}: {
    side: OrderSide;
    ticker: string;
    qty: number;
    limit: number;
    thesis: string;
    thesisAnchor: string | null;
}) {
    const notional = qty * limit;
    return (
        <div className="pm-co-step-body">
            <div className="pm-co-kicker">STEP 4 OF 4</div>
            <h2 className="pm-co-title">Review before you click.</h2>
            <p className="pm-co-helper">
                One last look. The receipt to the right mirrors this summary —
                if everything agrees, hit submit.
            </p>

            <div className="pm-co-review-grid">
                <ReviewRow label="Side" value={side.toUpperCase()} />
                <ReviewRow label="Security" value={ticker} />
                <ReviewRow label="Quantity" value={`${qty.toLocaleString()} sh`} />
                <ReviewRow label="Limit price" value={`$${limit.toFixed(2)}`} />
                <ReviewRow
                    label="Notional"
                    value={notional.toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 2,
                    })}
                />
                <ReviewRow label="Time in force" value="DAY" />
                <ReviewRow
                    label="Thesis"
                    value={thesisAnchor ?? "—"}
                    sub={thesis || "No notes"}
                />
            </div>
        </div>
    );
}

function ReviewRow({
    label,
    value,
    sub,
}: {
    label: string;
    value: string;
    sub?: string;
}) {
    return (
        <div className="pm-co-review-row">
            <span className="pm-co-review-label">{label}</span>
            <div className="pm-co-review-val-col">
                <span className="pm-co-review-value">{value}</span>
                {sub && <span className="pm-co-review-sub">{sub}</span>}
            </div>
        </div>
    );
}

// --------------------------------------------------------------------- //
// Receipt (right card)
// --------------------------------------------------------------------- //

function Receipt({
    side,
    ticker,
    qty,
    limit,
}: {
    side: OrderSide;
    ticker: string;
    qty: number;
    limit: number;
}) {
    const livePrice = LIVE_PRICES[ticker] ?? 0;
    const notional = qty * limit;
    const currentPos = CURRENT_POSITIONS[ticker]?.qty ?? 0;
    const navUsd = 250_000;
    const posBeforePct = ((currentPos * livePrice) / navUsd) * 100;
    const posAfterShares = side === "buy" ? currentPos + qty : currentPos - qty;
    const posAfterPct = ((posAfterShares * livePrice) / navUsd) * 100;

    const lockSeconds = useLockCountdown(LOCK_SECONDS, [ticker, qty, limit]);

    const checks: { label: string; ok: boolean; hint: string }[] = [
        {
            label: "Concentration",
            ok: posAfterPct <= 30,
            hint: `${posAfterPct.toFixed(1)}% of NAV (cap 30%)`,
        },
        {
            label: "Buying power",
            ok: side === "sell" || notional <= BUYING_POWER_USD,
            hint:
                side === "buy"
                    ? `${((notional / BUYING_POWER_USD) * 100).toFixed(0)}% of buying power used`
                    : "No buying power drawn",
        },
        {
            label: "Volatility",
            ok: notional <= 50_000,
            hint: notional > 50_000 ? "Size > 2× avg daily bar" : "Within normal band",
        },
    ];

    return (
        <aside className="pm-card pm-co-receipt" aria-label="Order receipt">
            <header className="pm-co-receipt-head">
                <span className={`pm-exec-side-pill is-${side}`}>{side.toUpperCase()}</span>
                <span className="pm-co-receipt-ticker">{ticker}</span>
                <span className="pm-co-receipt-lock">
                    <span className="pm-co-lock-dot" aria-hidden="true" />
                    {lockSeconds}s
                </span>
            </header>

            <div className="pm-co-receipt-notional">
                <span className="pm-co-receipt-label">Notional</span>
                <span className="pm-co-receipt-big num">
                    {notional.toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 2,
                    })}
                </span>
            </div>

            <dl className="pm-co-receipt-params">
                <ReceiptParam label="Quantity" value={`${qty.toLocaleString()} sh`} />
                <ReceiptParam label="Limit" value={`$${limit.toFixed(2)}`} />
                <ReceiptParam label="Live" value={`$${livePrice.toFixed(2)}`} />
                <ReceiptParam label="Time in force" value="DAY" />
            </dl>

            {/* Impact bar */}
            <div className="pm-co-impact">
                <div className="pm-co-impact-head">
                    <span className="pm-co-field-label">Position impact</span>
                    <span className="pm-co-impact-delta num">
                        {posBeforePct.toFixed(1)}% → {posAfterPct.toFixed(1)}%
                    </span>
                </div>
                <div
                    className="pm-co-impact-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={30}
                    aria-valuenow={Math.abs(posAfterPct)}
                    aria-label="Position percent of NAV"
                >
                    <span
                        className="pm-co-impact-fill is-before"
                        style={{ width: `${Math.min(100, (posBeforePct / 30) * 100)}%` }}
                    />
                    <span
                        className="pm-co-impact-fill is-after"
                        style={{ width: `${Math.min(100, (Math.abs(posAfterPct) / 30) * 100)}%` }}
                    />
                    {/* Cap tick at 30% of NAV */}
                    <span className="pm-co-impact-cap" aria-hidden="true" />
                </div>
                <div className="pm-co-impact-scale">
                    <span>0%</span>
                    <span>15%</span>
                    <span>30%</span>
                </div>
            </div>

            {/* Checks */}
            <ul className="pm-co-checks" role="list">
                {checks.map((c) => (
                    <li
                        key={c.label}
                        className={`pm-co-check is-${c.ok ? "ok" : "fail"}`}
                    >
                        <span className="pm-co-check-dot" aria-hidden="true">
                            {c.ok ? (
                                <Check className="pm-co-check-icon" strokeWidth={3} />
                            ) : (
                                "!"
                            )}
                        </span>
                        <span className="pm-co-check-label">{c.label}</span>
                        <span className="pm-co-check-hint">{c.hint}</span>
                    </li>
                ))}
            </ul>
        </aside>
    );
}

function ReceiptParam({ label, value }: { label: string; value: string }) {
    return (
        <>
            <dt className="pm-co-receipt-pkey">{label}</dt>
            <dd className="pm-co-receipt-pval num">{value}</dd>
        </>
    );
}

/**
 * Locked-price countdown. Resets every time one of the deps changes
 * (ticker / qty / limit) so the lock starts fresh whenever the user
 * adjusts the order. Ticks every second.
 */
function useLockCountdown(initial: number, deps: unknown[]): number {
    const [s, setS] = useState(initial);
    useEffect(() => {
        setS(initial);
        const id = setInterval(() => {
            setS((prev) => (prev <= 0 ? initial : prev - 1));
        }, 1000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);
    return s;
}

// --------------------------------------------------------------------- //
// Compact recent-orders blotter (below the split)
// --------------------------------------------------------------------- //

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

function RecentOrders({ orders }: { orders: Order[] }) {
    const recent = useMemo(() => orders.slice(0, 4), [orders]);
    if (recent.length === 0) return null;
    return (
        <section className="pm-card pm-co-recent" aria-label="Recent orders">
            <header className="pm-co-recent-head">
                <h3 className="pm-co-recent-title">Recent orders</h3>
                <span className="pm-co-recent-sub">
                    Last {recent.length} of {orders.length}
                </span>
            </header>
            <ul className="pm-co-recent-list" role="list">
                {recent.map((o) => {
                    const price = o.limitPrice ?? o.stopPrice ?? o.averageFillPrice ?? LIVE_PRICES[o.ticker];
                    return (
                        <li key={o.id} className="pm-co-recent-row">
                            <span className={`pm-exec-side-pill is-${o.side}`}>
                                {o.side.toUpperCase()}
                            </span>
                            <span className="pm-co-recent-ticker">{o.ticker}</span>
                            <span className="pm-co-recent-qty num">
                                {o.quantity.toLocaleString()} @ ${price?.toFixed(2) ?? "—"}
                            </span>
                            <span className={`pm-exec-status ${STATUS_CLASS[o.status]}`}>
                                {STATUS_LABELS[o.status]}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
