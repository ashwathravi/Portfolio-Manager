"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    CURRENT_POSITIONS,
    LIVE_PRICES,
    SEED_ORDERS,
} from "@/lib/execution/seed";
import type { Order, OrderSide, OrderStatus, OrderType, TimeInForce } from "@/types/execution";

/**
 * Phase 7 (AR-86) Execution Terminal variant.
 *
 * Pro-trader surface. Dark-theme override (`#0a0f0c` background,
 * JetBrains Mono everywhere) that ignores the global app theme — the
 * terminal feels like a separate tool nested inside the workspace.
 *
 * Layout:
 *   ┌───────────────────────────────────────────────────────────────────┐
 *   │  TICKER · META · QUOTE · BID / ASK / VOL / VWAP / HI / LO         │
 *   ├────────────────┬─────────────────────┬────────────────────────────┤
 *   │  LEVEL II      │  COMMAND            │  TIME & SALES              │
 *   │  6 ask, 6 bid  │  > buy 100 NVDA @…  │  running tape              │
 *   │  mid / spread  │  parsed tokens      │                            │
 *   │  imbalance     │  hotkey legend      │  WORKING ORDERS            │
 *   │                │  ORDER TICKET       │                            │
 *   │                │                     │  POSITION                  │
 *   ├────────────────┴─────────────────────┴────────────────────────────┤
 *   │ CONN · LAT · SESSION · ORDERS · GUARDRAILS · CLOCK                │
 *   └───────────────────────────────────────────────────────────────────┘
 *
 * Hotkeys (while the terminal is focused):
 *   - `B` / `S`   toggle the order side
 *   - `M`         snap the limit price to the mid
 *   - ⌘↵ / Ctrl↵ submit the order ticket
 *   - Esc         clear the command input / cancel the ticket
 *
 * CLI parser: tokenizes the command line as the user types. Recognized
 * grammar (all optional / order-flexible):
 *
 *   <SIDE> <QTY> <TICKER> [@ <PRICE>] [TYPE] [TIF]
 *
 * e.g. `buy 100 nvda @ 116.32 limit day` → a complete working order
 * draft; `b 50 aapl` auto-fills to a market day order at the mid.
 */

// --------------------------------------------------------------------- //
// Static seed data — ticker metadata, L2 book, tape
// --------------------------------------------------------------------- //

const TERMINAL_TICKER = "NVDA";
const TERMINAL_META = {
    ticker: TERMINAL_TICKER,
    exchange: "NASDAQ",
    sector: "Semiconductors",
    floatMillions: 24_615,
};

interface L2Level {
    price: number;
    size: number; // shares in this level (hundreds-of-thousands)
    cum: number; // cumulative from top
}

function seedBook(midPrice: number, depth = 6, tick = 0.05): {
    bids: L2Level[];
    asks: L2Level[];
} {
    // Deterministic fake book — sizes biased toward top of book, visible
    // taper further out. Uses a simple sine-ish shape so it looks real.
    const bids: L2Level[] = [];
    const asks: L2Level[] = [];
    let bidCum = 0;
    let askCum = 0;
    for (let i = 0; i < depth; i++) {
        // Size pattern: 4_800, 3_200, 2_100, 1_500, 900, 600 — typical
        // waterfall. Bid side slightly bigger to simulate buy pressure.
        const bidSize = Math.round([5_200, 3_400, 2_300, 1_500, 950, 620][i] ?? 400);
        const askSize = Math.round([4_700, 3_050, 2_050, 1_420, 880, 560][i] ?? 380);
        bidCum += bidSize;
        askCum += askSize;
        bids.push({
            price: +(midPrice - tick / 2 - i * tick).toFixed(2),
            size: bidSize,
            cum: bidCum,
        });
        asks.push({
            price: +(midPrice + tick / 2 + i * tick).toFixed(2),
            size: askSize,
            cum: askCum,
        });
    }
    return { bids, asks };
}

interface TapePrint {
    id: string;
    time: Date;
    price: number;
    qty: number;
    side: OrderSide;
    isBlock: boolean;
}

function seedTape(midPrice: number, count = 18): TapePrint[] {
    // Pseudo-random but deterministic — uses a cheap LCG so the tape
    // doesn't flicker between renders. First print is the most recent.
    const prints: TapePrint[] = [];
    let s = 0x42a43;
    const now = Date.now();
    for (let i = 0; i < count; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const r = s / 0x7fffffff;
        const side: OrderSide = r > 0.48 ? "buy" : "sell";
        const tickOffset = Math.floor(r * 5) - 2;
        const price = +(midPrice + tickOffset * 0.05).toFixed(2);
        const qty =
            r > 0.92
                ? Math.round(5000 + r * 15_000) // block
                : Math.round(50 + r * 800); // normal lot
        prints.push({
            id: `t-${i}`,
            time: new Date(now - i * 1600),
            price,
            qty,
            side,
            isBlock: qty >= 5000,
        });
    }
    return prints;
}

// --------------------------------------------------------------------- //
// CLI parser
// --------------------------------------------------------------------- //

type TokenKind =
    | "side"
    | "qty"
    | "ticker"
    | "at"
    | "price"
    | "type"
    | "tif"
    | "error";

interface Token {
    kind: TokenKind;
    raw: string;
    value: string;
}

interface ParsedCommand {
    side?: OrderSide;
    qty?: number;
    ticker?: string;
    price?: number;
    type?: OrderType;
    tif?: TimeInForce;
    tokens: Token[];
    valid: boolean;
    error?: string;
}

const SIDE_MAP: Record<string, OrderSide> = {
    B: "buy",
    BUY: "buy",
    S: "sell",
    SELL: "sell",
};

const TYPE_MAP: Record<string, OrderType> = {
    MKT: "market",
    MARKET: "market",
    LMT: "limit",
    LIMIT: "limit",
    STP: "stop",
    STOP: "stop",
    STPLMT: "stop_limit",
};

const TIF_MAP: Record<string, TimeInForce> = {
    DAY: "day",
    GTC: "gtc",
    IOC: "ioc",
    FOK: "fok",
};

function parseCommand(raw: string): ParsedCommand {
    const trimmed = raw.trim();
    if (!trimmed) {
        return { tokens: [], valid: false };
    }
    const parts = trimmed.split(/\s+/);
    const tokens: Token[] = [];
    const cmd: ParsedCommand = { tokens, valid: false };

    let expectPrice = false;

    for (let i = 0; i < parts.length; i++) {
        const p = parts[i].toUpperCase();

        if (expectPrice) {
            const n = Number(p);
            if (Number.isFinite(n) && n > 0) {
                cmd.price = n;
                tokens.push({ kind: "price", raw: parts[i], value: n.toFixed(2) });
                expectPrice = false;
                continue;
            }
            tokens.push({ kind: "error", raw: parts[i], value: "price?" });
            expectPrice = false;
            cmd.error = "expected a price after @";
            continue;
        }

        if (SIDE_MAP[p] && !cmd.side) {
            cmd.side = SIDE_MAP[p];
            tokens.push({ kind: "side", raw: parts[i], value: cmd.side.toUpperCase() });
            continue;
        }

        if (p === "@") {
            tokens.push({ kind: "at", raw: "@", value: "@" });
            expectPrice = true;
            continue;
        }

        if (TYPE_MAP[p]) {
            cmd.type = TYPE_MAP[p];
            tokens.push({ kind: "type", raw: parts[i], value: cmd.type.toUpperCase() });
            continue;
        }

        if (TIF_MAP[p]) {
            cmd.tif = TIF_MAP[p];
            tokens.push({ kind: "tif", raw: parts[i], value: cmd.tif.toUpperCase() });
            continue;
        }

        // Qty — first numeric token that's not preceded by @.
        const asNum = Number(p);
        if (Number.isFinite(asNum) && !p.includes(".") && asNum > 0 && !cmd.qty) {
            cmd.qty = asNum;
            tokens.push({ kind: "qty", raw: parts[i], value: String(asNum) });
            continue;
        }

        // Ticker — uppercase word of 1–5 chars.
        if (/^[A-Z]{1,5}$/.test(p) && !cmd.ticker) {
            cmd.ticker = p;
            tokens.push({ kind: "ticker", raw: parts[i], value: p });
            continue;
        }

        tokens.push({ kind: "error", raw: parts[i], value: "?" });
        if (!cmd.error) cmd.error = `unrecognized: ${parts[i]}`;
    }

    // Defaults — match the feel of a real trading CLI where missing
    // pieces are implied.
    if (!cmd.type) cmd.type = cmd.price ? "limit" : "market";
    if (!cmd.tif) cmd.tif = "day";

    cmd.valid = Boolean(cmd.side && cmd.qty && cmd.ticker && !cmd.error);
    return cmd;
}

// --------------------------------------------------------------------- //
// Terminal component
// --------------------------------------------------------------------- //

export function TerminalVariant() {
    const mid = LIVE_PRICES[TERMINAL_TICKER] ?? 100;

    const [side, setSide] = useState<OrderSide>("buy");
    const [qty, setQty] = useState<number>(100);
    const [ticker, setTicker] = useState<string>(TERMINAL_TICKER);
    const [price, setPrice] = useState<number>(mid);
    const [type, setType] = useState<OrderType>("limit");
    const [tif, setTif] = useState<TimeInForce>("day");

    const [cmd, setCmd] = useState<string>("");
    const [orders, setOrders] = useState<Order[]>(SEED_ORDERS);
    const [sessionSecs, setSessionSecs] = useState(0);

    const inputRef = useRef<HTMLInputElement | null>(null);
    const rootRef = useRef<HTMLDivElement | null>(null);

    // Parse the command line on every keystroke so the UI lights up the
    // token pills in real time.
    const parsed = useMemo(() => parseCommand(cmd), [cmd]);

    // Apply parsed tokens to the ticket state — but only if the user
    // hasn't edited the ticket directly after typing. Simple model: the
    // CLI wins whenever the parse succeeds.
    useEffect(() => {
        // Parsed command tokens intentionally drive the ticket draft.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (parsed.side) setSide(parsed.side);
        if (parsed.qty) setQty(parsed.qty);
        if (parsed.ticker) setTicker(parsed.ticker);
        if (parsed.price) setPrice(parsed.price);
        if (parsed.type) setType(parsed.type);
        if (parsed.tif) setTif(parsed.tif);
    }, [parsed]);

    const { bids, asks } = useMemo(() => seedBook(mid), [mid]);
    const tape = useMemo(() => seedTape(mid), [mid]);
    const bestBid = bids[0]?.price ?? 0;
    const bestAsk = asks[0]?.price ?? 0;
    const midBookPrice = +((bestBid + bestAsk) / 2).toFixed(2);
    const spread = +(bestAsk - bestBid).toFixed(2);
    const totalBid = bids.reduce((a, b) => a + b.size, 0);
    const totalAsk = asks.reduce((a, b) => a + b.size, 0);
    const imbalance = totalBid / (totalBid + totalAsk); // 0..1

    const submit = useCallback(() => {
        if (!parsed.valid && (!qty || !ticker)) return;
        const draft: Order = {
            id: `o-${Date.now().toString(36)}`,
            portfolioId: "p-growth",
            ticker: ticker.toUpperCase(),
            side,
            type,
            quantity: qty,
            limitPrice: type === "limit" || type === "stop_limit" ? price : undefined,
            stopPrice: type === "stop" || type === "stop_limit" ? price : undefined,
            status: "working",
            filledQuantity: 0,
            timeInForce: tif,
            placedAt: new Date(),
            updatedAt: new Date(),
        };
        setOrders((prev) => [draft, ...prev]);
        setCmd("");
    }, [parsed, ticker, side, type, qty, price, tif]);

    const cancel = useCallback(() => {
        setCmd("");
    }, []);

    // Session clock — starts on mount, ticks every second. Displayed in
    // the bottom status strip as H:MM:SS.
    useEffect(() => {
        const id = setInterval(() => setSessionSecs((s) => s + 1), 1000);
        return () => clearInterval(id);
    }, []);

    // Hotkeys — attached to the root div so they only fire when the
    // terminal is in focus scope. Ignores keydowns inside the text
    // input EXCEPT for Escape and cmd/ctrl+Enter.
    const onKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            const inInput = (e.target as HTMLElement).tagName === "INPUT";
            const k = e.key;

            if (k === "Escape") {
                e.preventDefault();
                cancel();
                inputRef.current?.blur();
                return;
            }

            if ((e.metaKey || e.ctrlKey) && k === "Enter") {
                e.preventDefault();
                submit();
                return;
            }

            if (inInput) return; // don't steal B/S/M from the CLI box

            if (k === "b" || k === "B") {
                e.preventDefault();
                setSide("buy");
            } else if (k === "s" || k === "S") {
                e.preventDefault();
                setSide("sell");
            } else if (k === "m" || k === "M") {
                e.preventDefault();
                setPrice(midBookPrice);
            } else if (k === "/") {
                e.preventDefault();
                inputRef.current?.focus();
            }
        },
        [cancel, submit, midBookPrice],
    );

    const workingForTicker = useMemo(
        () => orders.filter((o) => o.status === "working"),
        [orders],
    );
    const positionSnap = CURRENT_POSITIONS[ticker.toUpperCase()] ?? {
        qty: 0,
        avgCost: 0,
    };
    const posUnrealizedUsd = positionSnap.qty * (mid - positionSnap.avgCost);
    const posUnrealizedPct = positionSnap.avgCost
        ? ((mid - positionSnap.avgCost) / positionSnap.avgCost) * 100
        : 0;

    return (
        <div
            ref={rootRef}
            className="pm-term"
            tabIndex={0}
            onKeyDown={onKeyDown}
            data-ticker={ticker}
        >
            {/* AR-92: the terminal variant was designed around a 3-col
                L2/CLI/tape grid that's genuinely hard to fit below 900px.
                We still render it — the user may have chosen it
                deliberately — but show a calm "Best on desktop" hint so
                they know the Focus variant is the better choice on narrow
                screens. The banner self-hides at ≥900px via CSS. */}
            <div className="pm-term-narrow-notice" role="note" aria-live="polite">
                <span className="pm-term-narrow-notice-dot" aria-hidden="true" />
                Terminal is best on desktop. Try the Focus variant below 900px.
            </div>
            <Header mid={mid} totalVol={52_340_000} vwap={+(mid - 0.12).toFixed(2)} />

            <div className="pm-term-grid">
                {/* Left: L2 book */}
                <section className="pm-term-panel" aria-label="Level II">
                    <PanelHead title="LEVEL II" sub={ticker} />
                    <BookTable
                        bids={bids}
                        asks={asks}
                        onClickPrice={(p) => setPrice(p)}
                    />
                    <BookFooter
                        bid={bestBid}
                        ask={bestAsk}
                        mid={midBookPrice}
                        spread={spread}
                        imbalance={imbalance}
                    />
                </section>

                {/* Center: command + ticket */}
                <section className="pm-term-panel" aria-label="Command">
                    <PanelHead title="COMMAND" sub="Press / to focus" />
                    <CommandPrompt
                        value={cmd}
                        onChange={setCmd}
                        parsed={parsed}
                        inputRef={inputRef}
                    />
                    <TokenStrip parsed={parsed} />
                    <HotkeyLegend />
                    <PanelHead title="ORDER TICKET" sub={parsed.valid ? "✓ VALID" : "DRAFT"} />
                    <OrderTicket
                        side={side}
                        ticker={ticker}
                        qty={qty}
                        price={price}
                        type={type}
                        tif={tif}
                        onSubmit={submit}
                        onCancel={cancel}
                    />
                </section>

                {/* Right: tape + working + position */}
                <section className="pm-term-panel" aria-label="Tape and positions">
                    <PanelHead title="TIME & SALES" sub={ticker} />
                    <Tape prints={tape} />
                    <PanelHead title="WORKING ORDERS" sub={`${workingForTicker.length}`} />
                    <WorkingOrdersList orders={workingForTicker} />
                    <PanelHead title="POSITION" sub={ticker} />
                    <PositionStats
                        qty={positionSnap.qty}
                        avgCost={positionSnap.avgCost}
                        mark={mid}
                        unrealizedUsd={posUnrealizedUsd}
                        unrealizedPct={posUnrealizedPct}
                    />
                </section>
            </div>

            <StatusStrip
                sessionSecs={sessionSecs}
                ordersToday={orders.length}
                guardrailsOk={true}
            />
        </div>
    );
}

// --------------------------------------------------------------------- //
// Header
// --------------------------------------------------------------------- //

function Header({ mid, totalVol, vwap }: { mid: number; totalVol: number; vwap: number }) {
    const prev = mid - 0.42;
    const delta = mid - prev;
    const deltaPct = (delta / prev) * 100;
    const dayHi = +(mid + 1.18).toFixed(2);
    const dayLo = +(mid - 2.04).toFixed(2);
    const deltaClass = delta >= 0 ? "is-up" : "is-down";

    return (
        <header className="pm-term-header">
            <div className="pm-term-head-left">
                <div className="pm-term-symbol">{TERMINAL_META.ticker}</div>
                <div className="pm-term-meta">
                    <span>{TERMINAL_META.exchange}</span>
                    <span className="pm-term-dot" aria-hidden="true" />
                    <span>{TERMINAL_META.sector}</span>
                    <span className="pm-term-dot" aria-hidden="true" />
                    <span>Float {TERMINAL_META.floatMillions.toLocaleString()}M</span>
                </div>
            </div>
            <div className="pm-term-head-center">
                <span className="pm-term-quote">${mid.toFixed(2)}</span>
                <span className={`pm-term-delta ${deltaClass}`}>
                    {delta >= 0 ? "+" : "−"}
                    {Math.abs(delta).toFixed(2)} ({deltaPct >= 0 ? "+" : "−"}
                    {Math.abs(deltaPct).toFixed(2)}%)
                </span>
            </div>
            <div className="pm-term-head-stats">
                <HeadStat label="BID" value={(mid - 0.03).toFixed(2)} />
                <HeadStat label="ASK" value={(mid + 0.02).toFixed(2)} />
                <HeadStat label="VOL" value={`${(totalVol / 1_000_000).toFixed(1)}M`} />
                <HeadStat label="VWAP" value={vwap.toFixed(2)} />
                <HeadStat label="HI" value={dayHi.toFixed(2)} />
                <HeadStat label="LO" value={dayLo.toFixed(2)} />
            </div>
        </header>
    );
}

function HeadStat({ label, value }: { label: string; value: string }) {
    return (
        <div className="pm-term-head-stat">
            <span className="pm-term-head-label">{label}</span>
            <span className="pm-term-head-value">{value}</span>
        </div>
    );
}

function PanelHead({ title, sub }: { title: string; sub?: string }) {
    return (
        <div className="pm-term-panel-head">
            <span className="pm-term-panel-title">{title}</span>
            {sub && <span className="pm-term-panel-sub">{sub}</span>}
        </div>
    );
}

// --------------------------------------------------------------------- //
// L2 book
// --------------------------------------------------------------------- //

function BookTable({
    bids,
    asks,
    onClickPrice,
}: {
    bids: L2Level[];
    asks: L2Level[];
    onClickPrice: (price: number) => void;
}) {
    const maxCum = Math.max(
        bids[bids.length - 1]?.cum ?? 1,
        asks[asks.length - 1]?.cum ?? 1,
    );
    // Asks ordered from furthest out to closest so they read top-to-bottom
    // toward the best ask right above the bid stack.
    const askRows = [...asks].reverse();
    return (
        <div className="pm-term-book">
            <div className="pm-term-book-headers">
                <span>SIZE</span>
                <span>PRICE</span>
                <span>CUM</span>
            </div>
            <div className="pm-term-book-asks">
                {askRows.map((lvl) => (
                    <BookRow
                        key={`a-${lvl.price}`}
                        level={lvl}
                        side="ask"
                        maxCum={maxCum}
                        onClick={() => onClickPrice(lvl.price)}
                    />
                ))}
            </div>
            <div className="pm-term-book-bids">
                {bids.map((lvl) => (
                    <BookRow
                        key={`b-${lvl.price}`}
                        level={lvl}
                        side="bid"
                        maxCum={maxCum}
                        onClick={() => onClickPrice(lvl.price)}
                    />
                ))}
            </div>
        </div>
    );
}

function BookRow({
    level,
    side,
    maxCum,
    onClick,
}: {
    level: L2Level;
    side: "bid" | "ask";
    maxCum: number;
    onClick: () => void;
}) {
    const pct = Math.min(100, (level.cum / maxCum) * 100);
    return (
        <button
            type="button"
            className={`pm-term-book-row is-${side}`}
            onClick={onClick}
            title={`Snap limit to ${level.price.toFixed(2)}`}
        >
            <span
                className="pm-term-book-fill"
                style={{ width: `${pct}%` }}
                aria-hidden="true"
            />
            <span className="pm-term-book-size">{level.size.toLocaleString()}</span>
            <span className={`pm-term-book-price is-${side}`}>
                {level.price.toFixed(2)}
            </span>
            <span className="pm-term-book-cum">{level.cum.toLocaleString()}</span>
        </button>
    );
}

function BookFooter({
    bid,
    ask,
    mid,
    spread,
    imbalance,
}: {
    bid: number;
    ask: number;
    mid: number;
    spread: number;
    imbalance: number;
}) {
    const imbalanceBias =
        imbalance > 0.55 ? "is-bid" : imbalance < 0.45 ? "is-ask" : "";
    return (
        <div className="pm-term-book-foot">
            <div className="pm-term-book-foot-row">
                <span>SPREAD</span>
                <span className="num">{spread.toFixed(2)}</span>
            </div>
            <div className="pm-term-book-foot-row">
                <span>MID</span>
                <span className="num">{mid.toFixed(2)}</span>
            </div>
            <div className="pm-term-book-foot-row">
                <span>IMB</span>
                <span className={`num ${imbalanceBias}`}>
                    {(imbalance * 100).toFixed(1)}% / {((1 - imbalance) * 100).toFixed(1)}%
                </span>
            </div>
            <div className="pm-term-book-foot-row">
                <span>BBO</span>
                <span className="num">
                    {bid.toFixed(2)} × {ask.toFixed(2)}
                </span>
            </div>
        </div>
    );
}

// --------------------------------------------------------------------- //
// Command prompt
// --------------------------------------------------------------------- //

function CommandPrompt({
    value,
    onChange,
    parsed,
    inputRef,
}: {
    value: string;
    onChange: (v: string) => void;
    parsed: ParsedCommand;
    inputRef: React.RefObject<HTMLInputElement | null>;
}) {
    return (
        <div
            className={`pm-term-cli${parsed.valid ? " is-valid" : parsed.error ? " is-error" : ""}`}
        >
            <span className="pm-term-cli-prompt" aria-hidden="true">
                &gt;
            </span>
            <input
                ref={inputRef}
                type="text"
                className="pm-term-cli-input"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="buy 100 nvda @ 116.32 limit day"
                spellCheck={false}
                autoComplete="off"
                aria-label="Command input"
            />
            <span className="pm-term-cli-status">
                {parsed.valid
                    ? "✓ VALID"
                    : parsed.error
                        ? "✗ ERROR"
                        : value
                            ? "…"
                            : ""}
            </span>
        </div>
    );
}

function TokenStrip({ parsed }: { parsed: ParsedCommand }) {
    if (parsed.tokens.length === 0) {
        return (
            <div className="pm-term-tokens is-empty" aria-hidden="true">
                <span>TOKENS</span>
                <span className="pm-term-tokens-hint">—</span>
            </div>
        );
    }
    return (
        <div className="pm-term-tokens" role="list" aria-label="Parsed tokens">
            {parsed.tokens.map((t, i) => (
                <span
                    key={`${i}-${t.raw}`}
                    className={`pm-term-token is-${t.kind}`}
                    role="listitem"
                >
                    <span className="pm-term-token-kind">{t.kind.toUpperCase()}</span>
                    <span className="pm-term-token-val">{t.value}</span>
                </span>
            ))}
        </div>
    );
}

function HotkeyLegend() {
    const keys: { k: string; desc: string }[] = [
        { k: "B", desc: "buy" },
        { k: "S", desc: "sell" },
        { k: "M", desc: "mid" },
        { k: "⌘↵", desc: "send" },
        { k: "⌘K", desc: "clear" },
        { k: "⌘/", desc: "focus" },
        { k: "ESC", desc: "cancel" },
    ];
    return (
        <div className="pm-term-keys" role="list" aria-label="Hotkeys">
            {keys.map((k) => (
                <span key={k.k} className="pm-term-key" role="listitem">
                    <kbd className="pm-term-kbd">{k.k}</kbd>
                    <span className="pm-term-key-desc">{k.desc}</span>
                </span>
            ))}
        </div>
    );
}

// --------------------------------------------------------------------- //
// Order ticket
// --------------------------------------------------------------------- //

function OrderTicket({
    side,
    ticker,
    qty,
    price,
    type,
    tif,
    onSubmit,
    onCancel,
}: {
    side: OrderSide;
    ticker: string;
    qty: number;
    price: number;
    type: OrderType;
    tif: TimeInForce;
    onSubmit: () => void;
    onCancel: () => void;
}) {
    const notional = qty * price;
    return (
        <div className={`pm-term-ticket is-${side}`}>
            <div className="pm-term-ticket-rows">
                <TicketRow label="SIDE" value={side.toUpperCase()} highlight />
                <TicketRow label="QTY" value={qty.toLocaleString()} />
                <TicketRow label="SYM" value={ticker.toUpperCase()} />
                <TicketRow label="PRICE" value={`$${price.toFixed(2)}`} />
                <TicketRow label="TYPE" value={type.toUpperCase()} />
                <TicketRow label="TIF" value={tif.toUpperCase()} />
                <TicketRow
                    label="NTNL"
                    value={notional.toLocaleString("en-US", {
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 0,
                    })}
                />
            </div>
            <div className="pm-term-ticket-actions">
                <button
                    type="button"
                    className="pm-term-btn is-ghost"
                    onClick={onCancel}
                >
                    ESC · Cancel
                </button>
                <button
                    type="button"
                    className={`pm-term-btn is-${side}`}
                    onClick={onSubmit}
                >
                    ⌘↵ · Send
                </button>
            </div>
        </div>
    );
}

function TicketRow({
    label,
    value,
    highlight,
}: {
    label: string;
    value: string;
    highlight?: boolean;
}) {
    return (
        <div className={`pm-term-ticket-row${highlight ? " is-highlight" : ""}`}>
            <span className="pm-term-ticket-label">{label}</span>
            <span className="pm-term-ticket-value">{value}</span>
        </div>
    );
}

// --------------------------------------------------------------------- //
// Time & sales tape
// --------------------------------------------------------------------- //

function Tape({ prints }: { prints: TapePrint[] }) {
    return (
        <div className="pm-term-tape" role="log" aria-live="polite">
            {prints.map((p) => (
                <div
                    key={p.id}
                    className={`pm-term-tape-row is-${p.side}${p.isBlock ? " is-block" : ""}`}
                >
                    <span className="pm-term-tape-time">
                        {p.time.toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                            hour12: false,
                        })}
                    </span>
                    <span className="pm-term-tape-price">{p.price.toFixed(2)}</span>
                    <span className="pm-term-tape-qty">{p.qty.toLocaleString()}</span>
                    <span className="pm-term-tape-side">{p.side === "buy" ? "▲" : "▼"}</span>
                </div>
            ))}
        </div>
    );
}

// --------------------------------------------------------------------- //
// Working orders + position
// --------------------------------------------------------------------- //

const STATUS_LABELS: Record<OrderStatus, string> = {
    pending: "PEND",
    working: "WKG",
    filled: "FILL",
    cancelled: "CXL",
    rejected: "REJ",
};

function WorkingOrdersList({ orders }: { orders: Order[] }) {
    if (orders.length === 0) {
        return <div className="pm-term-empty">No working orders.</div>;
    }
    return (
        <div className="pm-term-wo">
            {orders.map((o) => {
                const price = o.limitPrice ?? o.stopPrice ?? LIVE_PRICES[o.ticker] ?? 0;
                return (
                    <div key={o.id} className={`pm-term-wo-row is-${o.side}`}>
                        <span className="pm-term-wo-side">
                            {o.side === "buy" ? "B" : "S"}
                        </span>
                        <span className="pm-term-wo-tkr">{o.ticker}</span>
                        <span className="pm-term-wo-qty">{o.quantity}</span>
                        <span className="pm-term-wo-price">@{price.toFixed(2)}</span>
                        <span className="pm-term-wo-tif">{o.timeInForce.toUpperCase()}</span>
                        <span className="pm-term-wo-status">{STATUS_LABELS[o.status]}</span>
                    </div>
                );
            })}
        </div>
    );
}

function PositionStats({
    qty,
    avgCost,
    mark,
    unrealizedUsd,
    unrealizedPct,
}: {
    qty: number;
    avgCost: number;
    mark: number;
    unrealizedUsd: number;
    unrealizedPct: number;
}) {
    const uClass = unrealizedUsd >= 0 ? "is-up" : "is-down";
    return (
        <div className="pm-term-pos">
            <PosRow label="QTY" value={qty.toLocaleString()} />
            <PosRow label="AVG" value={`$${avgCost.toFixed(2)}`} />
            <PosRow label="MARK" value={`$${mark.toFixed(2)}`} />
            <PosRow
                label="P&L"
                value={`${unrealizedUsd >= 0 ? "+" : "−"}$${Math.abs(unrealizedUsd).toFixed(2)}`}
                className={uClass}
            />
            <PosRow
                label="P&L%"
                value={`${unrealizedPct >= 0 ? "+" : "−"}${Math.abs(unrealizedPct).toFixed(2)}%`}
                className={uClass}
            />
        </div>
    );
}

function PosRow({
    label,
    value,
    className,
}: {
    label: string;
    value: string;
    className?: string;
}) {
    return (
        <div className={`pm-term-pos-row${className ? ` ${className}` : ""}`}>
            <span className="pm-term-pos-label">{label}</span>
            <span className="pm-term-pos-value">{value}</span>
        </div>
    );
}

// --------------------------------------------------------------------- //
// Status strip
// --------------------------------------------------------------------- //

function formatSession(secs: number): string {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function StatusStrip({
    sessionSecs,
    ordersToday,
    guardrailsOk,
}: {
    sessionSecs: number;
    ordersToday: number;
    guardrailsOk: boolean;
}) {
    const [clock, setClock] = useState<string>("");
    useEffect(() => {
        const tick = () => {
            setClock(
                new Date().toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                }),
            );
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, []);

    return (
        <footer className="pm-term-status">
            <StatusCell label="CONN" value="LIVE" tone="up" />
            <StatusCell label="LAT" value="12 ms" />
            <StatusCell label="SESSION" value={formatSession(sessionSecs)} />
            <StatusCell label="ORDERS" value={String(ordersToday)} />
            <StatusCell
                label="GUARD"
                value={guardrailsOk ? "OK" : "WARN"}
                tone={guardrailsOk ? "up" : "warn"}
            />
            <StatusCell label="CLOCK" value={clock} />
        </footer>
    );
}

function StatusCell({
    label,
    value,
    tone,
}: {
    label: string;
    value: string;
    tone?: "up" | "warn";
}) {
    return (
        <div className={`pm-term-status-cell${tone ? ` is-${tone}` : ""}`}>
            <span className="pm-term-status-label">{label}</span>
            <span className="pm-term-status-value">{value}</span>
        </div>
    );
}
