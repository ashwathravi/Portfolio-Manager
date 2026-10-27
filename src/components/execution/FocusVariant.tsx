"use client";

import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
} from "react";
import { Check, AlertTriangle, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useQuotesQuery } from "@/lib/api/market-data/queries";
import { formatPlanTime, parseOrderPrefill, sortOrdersNewestFirst } from "@/lib/execution/blotter";
import { ORDER_STATUS_LABELS, type OrderStatusChange } from "@/lib/execution/order-status";
import {
    TICKET_SHORTCUTS,
    isEditableElement,
    resolveTicketShortcut,
} from "@/lib/execution/shortcuts";
import {
    OPTION_CONTRACT_MULTIPLIER,
    cashAfterOrder,
    defaultTicketAccountId,
    describeTicketPrice,
    orderDisplayPrice,
    orderNeedsApproval,
    orderPlanInput,
    orderValue,
    positionIn,
    ticketPriceFromQuote,
    type TicketAccount,
    type TicketPrice,
    type TradeTicketData,
} from "@/lib/execution/ticket";
import { useEasternDate } from "@/lib/hooks/useEasternDate";
import { useUiStore } from "@/lib/stores/uiStore";
import { tickerSchema } from "@/lib/validators/market-data";
import {
    chosenBucketForTrade,
    employerSymbols,
    evaluateSellDiscipline,
    evaluatePreTradeRiskPolicy,
    evaluateOptionOrderPolicy,
    sellDisciplineBlocksAdd,
    type PreTradeRiskPolicyCheck,
    type PreTradeRiskPolicyImpact,
    type OptionContractType,
    type OptionPolicyIssue,
    type SellDisciplineTask,
    policyHoldings,
    policyPortfolioValue,
} from "@/lib/risk-policy";
import { isSeedThesis } from "@/lib/research/thesis";
import { useThesisStore } from "@/lib/research/useThesisStore";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import { usePolicyPortfolio } from "@/components/providers/PolicyPortfolioProvider";
import type {
    Order,
    OrderInstrumentType,
    OrderPlanInput,
    OrderSide,
    OrderStatus,
    OrderType,
    TimeInForce,
} from "@/types/execution";
import { isRationaleComplete } from "@/types/trade";
import { track } from "@/lib/analytics/events";
import {
    PreTradeRationale,
    createRationaleDraft,
    finalizeRationale,
    type RationaleDraft,
} from "./PreTradeRationale";
import { RationaleSummary } from "./RationaleSummary";
import { AdherencePanel } from "./AdherencePanel";
import {
    SEED_ADHERENCE_RULES,
    SEED_THESIS_TO_STRATEGY,
} from "@/lib/adherence/seed";
import type { TradeContext } from "@/lib/adherence/evaluate";
import { SEED_STRATEGIES } from "@/lib/strategies/seed";

/**
 * Phase 7 (AR-84) Execution Focus variant.
 *
 * Default layout: split order form on the left, today's orders on the
 * right. One screen, everything visible, no modals. Calm.
 *
 * Left card "New order":
 *   - Account (one of the user's), Buy / Sell segmented toggle (green / red)
 *   - Ticker + its last price, labelled with where it came from (a stored
 *     close or the price stored with the holding; never live)
 *   - Quantity input
 *   - Order type select (market / limit / stop / stop_limit)
 *   - Limit price (conditional on limit / stop_limit)
 *   - Stop price (conditional on stop / stop_limit)
 *   - TIF segmented pill row (DAY / GTC / IOC / FOK)
 *   - Preview rows: Notional, Cash after, Position after (the account's)
 *   - Guardrail list with green/warn dots (price, cash, concentration)
 *   - Foot (sticky): one-line order summary + Review & submit (primary on
 *     buy, danger on sell). "Save draft" was removed — it never saved.
 *
 * Right card "Your orders":
 *   - Filter chips: All / Ready / Placed / Cancelled
 *   - Orders table with side pill + status pill
 *   - Approval queue banner when plans wait for the user's approval
 *
 * On the user's own data (launch item i53): accounts, cash, positions and
 * plans come from the server, and a submitted plan is saved to it. Atlas
 * never routes an order: the user places it at their broker and marks it
 * placed here.
 */

type BlotterFilter = "all" | "ready" | "placed" | "cancelled";

const FILTER_LABELS: Record<BlotterFilter, string> = {
    all: "All",
    ready: "Ready",
    placed: "Placed",
    cancelled: "Cancelled",
};

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
    market: "Market",
    limit: "Limit",
    stop: "Stop",
    stop_limit: "Stop-limit",
};

const INSTRUMENT_LABELS: Record<OrderInstrumentType, string> = {
    equity: "Stock",
    option: "Option / LEAPS",
};

const OPTION_CONTRACT_LABELS: Record<OptionContractType, string> = {
    call: "Call",
    put: "Put",
};

const TIF_OPTIONS: TimeInForce[] = ["day", "gtc", "ioc", "fok"];
const TIF_LABELS: Record<TimeInForce, string> = {
    day: "DAY",
    gtc: "GTC",
    ioc: "IOC",
    fok: "FOK",
};

const STATUS_CLASS: Record<OrderStatus, string> = {
    pending_approval: "pm-exec-status-pending",
    ready: "pm-exec-status-ready",
    placed: "pm-exec-status-placed",
    cancelled: "pm-exec-status-cancelled",
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

/** The per-share price a draft order is sized at: its limit or stop, else the last price. */
function effectivePrice(type: OrderType, limit: number, stop: number, lastPrice: number | undefined): number {
    if ((type === "limit" || type === "stop_limit") && limit > 0) return limit;
    if (type === "stop" && stop > 0) return stop;
    return lastPrice ?? 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function isSavedOrder(value: unknown): value is Order {
    const order = value as Partial<Order> | null;
    return typeof order?.id === "string" && typeof order.ticker === "string" && typeof order.status === "string";
}

// --------------------------------------------------------------------- //
// FocusVariant
// --------------------------------------------------------------------- //

export function FocusVariant({ ticket }: { ticket: TradeTicketData }) {
    const [orders, setOrders] = useState<Order[]>(ticket.orders);
    const [filter, setFilter] = useState<BlotterFilter>("all");
    const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
    const accountNames = useMemo(
        () => new Map(ticket.accounts.map((account) => [account.id, account.name])),
        [ticket.accounts],
    );

    /** Saves the plan; true once the server has it. */
    const saveOrder = async (input: OrderPlanInput): Promise<boolean> => {
        try {
            const response = await fetch("/api/orders", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok || !isSavedOrder(body?.data)) {
                toast.error(typeof body?.error === "string" ? body.error : "Couldn't save the order. Try again.");
                return false;
            }
            const saved = body.data;
            setOrders((prev) => [saved, ...prev.filter((o) => o.id !== saved.id)]);
            const what = `${saved.side === "buy" ? "Buy" : "Sell"} ${saved.quantity.toLocaleString("en-US")} ${saved.ticker}`;
            toast.success(saved.status === "pending_approval"
                ? `${what} saved. It's over your approval threshold: approve it before you place it.`
                : `${what} saved, ready to place at your broker.`);
            return true;
        } catch {
            toast.error("Couldn't save the order. Check your connection and try again.");
            return false;
        }
    };

    const changeStatus = async (order: Order, status: OrderStatusChange) => {
        if (busyIds.has(order.id)) return;
        setBusyIds((prev) => new Set(prev).add(order.id));
        try {
            const response = await fetch(`/api/orders/${order.id}`, {
                method: "PATCH",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status }),
            });
            const body = await response.json().catch(() => ({}));
            // A conflict answers with the plan as it is now: show that.
            const updated = isSavedOrder(body?.data) && body.data.id === order.id ? body.data : undefined;
            if (updated) setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)));
            if (!response.ok) {
                toast.error(typeof body?.error === "string" ? body.error : "Couldn't update the order. Try again.");
            }
        } catch {
            toast.error("Couldn't update the order. Check your connection and try again.");
        } finally {
            setBusyIds((prev) => {
                const next = new Set(prev);
                next.delete(order.id);
                return next;
            });
        }
    };

    return (
        <div className="pm-exec-focus">
            <OrderForm accounts={ticket.accounts} prices={ticket.prices} onSubmit={saveOrder} />
            <OrdersPanel
                orders={orders}
                accountNames={accountNames}
                busyIds={busyIds}
                filter={filter}
                onFilter={setFilter}
                onChangeStatus={changeStatus}
            />
        </div>
    );
}

// --------------------------------------------------------------------- //
// Order form — left card
// --------------------------------------------------------------------- //

interface OrderFormProps {
    accounts: readonly TicketAccount[];
    /** The last price of each ticker the user holds, by upper-case ticker. */
    prices: Readonly<Record<string, TicketPrice>>;
    /** Saves the plan; resolves true once the server has it. */
    onSubmit: (order: OrderPlanInput) => Promise<boolean>;
}

/** How long typing pauses before the ticket looks up a price. */
const PRICE_LOOKUP_DELAY_MS = 300;

function OrderForm({ accounts, prices, onSubmit }: OrderFormProps) {
    // `?symbol=NVDA&side=sell` (from position detail, Ask, etc.) pre-fills the ticket.
    const searchParams = useSearchParams();
    const [prefill] = useState(() => parseOrderPrefill(searchParams ?? new URLSearchParams()));
    const [accountId, setAccountId] = useState<string | undefined>(() => defaultTicketAccountId(accounts, prefill.ticker));
    const [instrumentType, setInstrumentType] = useState<OrderInstrumentType>("equity");
    const [side, setSide] = useState<OrderSide>(prefill.side ?? "buy");
    const [ticker, setTicker] = useState<string>(prefill.ticker ?? "");
    const [quantity, setQuantity] = useState<number>(1);
    const [type, setType] = useState<OrderType>("limit");
    // Until the user types one, a share's limit and stop follow its last price.
    const [limitPrice, setLimitPrice] = useState<number>(0);
    const [limitTouched, setLimitTouched] = useState(false);
    const [stopPrice, setStopPrice] = useState<number>(0);
    const [stopTouched, setStopTouched] = useState(false);
    const [tif, setTif] = useState<TimeInForce>("day");
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [saving, setSaving] = useState(false);
    const tickerInputRef = useRef<HTMLInputElement>(null);
    const quantityInputRef = useRef<HTMLInputElement>(null);
    const [optionContractType, setOptionContractType] = useState<OptionContractType>("call");
    const [optionStrike, setOptionStrike] = useState<number>(0);
    const [optionExpiry, setOptionExpiry] = useState<string>("");
    const [maxLossAcknowledged, setMaxLossAcknowledged] = useState(false);
    const [whatMustBeTrueByExpiry, setWhatMustBeTrueByExpiry] = useState("");
    const [plannedExitRule, setPlannedExitRule] = useState("");
    const [riskPolicyOverrideReason, setRiskPolicyOverrideReason] = useState("");

    // Guardrail settings (AR-89) — user prefs from the Settings store.
    // When a toggle is off, the corresponding check becomes a no-op.
    const guardrailPrefs = useSettingsStore((s) => s.guardrails);
    const riskPolicy = useSettingsStore((s) => s.riskPolicy);
    const optionsRiskPolicy = riskPolicy.optionsRiskPolicy;
    const sellDisciplineRules = riskPolicy.sellDisciplineRules;
    // The risk policy checks the order against the user's own holdings and
    // the theses they wrote (launch item i54). When they couldn't be loaded,
    // the checks say so and the order needs a reason.
    const { portfolio: policyPortfolio, unavailable: policyUnavailable } = usePolicyPortfolio();
    const policyHoldingRows = useMemo(
        () => policyHoldings(policyPortfolio.holdings, riskPolicy),
        [policyPortfolio.holdings, riskPolicy],
    );
    const policyValue = useMemo(() => policyPortfolioValue(policyPortfolio), [policyPortfolio]);
    const policyEmployerSymbols = useMemo(() => employerSymbols(riskPolicy), [riskPolicy]);
    const { theses } = useThesisStore();
    // AR-109: JournalPlus pre-trade rationale. When `rationaleRequired`
    // is on, submit is gated on a completed rationale panel.
    const rationaleRequired = useSettingsStore(
        (s) => s.execution.rationaleRequired,
    );
    // AR-110: cooldown seconds when the caution mood is tagged. Read
    // reactively so flipping the Settings preset mid-session takes
    // effect on the next Submit press.
    const cooldownSeconds = useSettingsStore(
        (s) => s.execution.cooldownSeconds,
    );

    const handleTickerChange = (value: string) => {
        setTicker(value.toUpperCase());
        // A new ticker's limit and stop start from its own last price.
        setLimitTouched(false);
        setStopTouched(false);
    };

    // Rationale draft owned here so the parent can finalize it on
    // submit and attach it to the Order. Reset after a successful
    // submit so the next order starts fresh and `capturedAt` reflects
    // the new render.
    const [rationaleDraft, setRationaleDraft] = useState<RationaleDraft>(() =>
        createRationaleDraft(),
    );

    // If the user flips rationaleRequired off, then back on mid-session,
    // the stale `capturedAt` on the draft would produce a huge
    // `timeToDecisionMs` that's meaningless (the panel wasn't even
    // visible for most of it). Reset the draft on false→true so the
    // clock starts from the moment the panel actually mounts again.
    const prevRequiredRef = useRef(rationaleRequired);
    useEffect(() => {
        let resetTimer: number | undefined;
        if (rationaleRequired && !prevRequiredRef.current) {
            resetTimer = window.setTimeout(() => {
                setRationaleDraft(createRationaleDraft());
            }, 0);
        }
        prevRequiredRef.current = rationaleRequired;
        return () => {
            if (resetTimer !== undefined) {
                window.clearTimeout(resetTimer);
            }
        };
    }, [rationaleRequired]);

    // AR-110 cooldown state. `cooldownEndMs` is the wall-clock moment
    // the Submit button re-enables, or `null` when no cooldown is
    // running. We tick `cooldownNow` every ~250ms so the remaining
    // seconds render even though we never mutate `cooldownEndMs` during
    // the wait — that way the timer is frame-independent and survives
    // React strict-mode double-renders.
    const [cooldownEndMs, setCooldownEndMs] = useState<number | null>(null);
    const [cooldownNow, setCooldownNow] = useState<number>(() => Date.now());

    useEffect(() => {
        if (cooldownEndMs == null) return;
        const tick = () => setCooldownNow(Date.now());
        const id = window.setInterval(tick, 250);
        return () => window.clearInterval(id);
    }, [cooldownEndMs]);

    // When the ticking clock catches up to the end time, clear the
    // cooldown once — so Submit re-enables and the button label
    // switches back.
    useEffect(() => {
        if (cooldownEndMs != null && cooldownNow >= cooldownEndMs) {
            const resetTimer = window.setTimeout(() => {
                setCooldownEndMs(null);
            }, 0);
            return () => window.clearTimeout(resetTimer);
        }
        return undefined;
    }, [cooldownEndMs, cooldownNow]);

    // If the user changes mood to a non-caution option mid-cooldown
    // (e.g., realizes they weren't FOMO-ing after all), clear the
    // cooldown immediately. The nudge is about the caution mood, not
    // punishment for having pressed Submit.
    const moodIsCaution =
        rationaleDraft.mood === "fomo" || rationaleDraft.mood === "revenge";
    useEffect(() => {
        if (!moodIsCaution && cooldownEndMs != null) {
            const resetTimer = window.setTimeout(() => {
                setCooldownEndMs(null);
            }, 0);
            return () => window.clearTimeout(resetTimer);
        }
        return undefined;
    }, [moodIsCaution, cooldownEndMs]);

    const isOptionOrder = instrumentType === "option";
    const tickerUpper = ticker.toUpperCase();
    const account = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId]);
    const todayEt = useEasternDate();

    // The ticker's last price: the server sent the held ones; any other is
    // looked up from the same price store once typing pauses.
    const [lookupTicker, setLookupTicker] = useState(prefill.ticker ?? "");
    useEffect(() => {
        const id = window.setTimeout(() => setLookupTicker(tickerUpper), PRICE_LOOKUP_DELAY_MS);
        return () => window.clearTimeout(id);
    }, [tickerUpper]);
    const knownPrice = prices[tickerUpper];
    const lookupReady = lookupTicker === tickerUpper && tickerSchema.safeParse(lookupTicker).success;
    const quoteQuery = useQuotesQuery(lookupReady && !knownPrice ? [lookupTicker] : [], {
        staleTime: 5 * 60_000,
        retry: false,
    });
    const fetchedQuote = lookupReady && !knownPrice ? quoteQuery.data?.[lookupTicker] : undefined;
    const tickerPrice: TicketPrice | undefined = knownPrice ?? (fetchedQuote ? ticketPriceFromQuote(fetchedQuote) : undefined);
    const lastPrice = tickerPrice?.price;
    const priceLookupPending = !knownPrice && tickerUpper !== "" && (lookupTicker !== tickerUpper || quoteQuery.isFetching);
    const priceNote = !tickerUpper
        ? undefined
        : priceLookupPending
            ? "Looking up the last close…"
            : describeTicketPrice(tickerPrice, todayEt);

    const handleInstrumentChange = (next: OrderInstrumentType) => {
        setInstrumentType(next);
        setQuantity(1);
        setMaxLossAcknowledged(false);
        setWhatMustBeTrueByExpiry("");
        setPlannedExitRule("");
        setRiskPolicyOverrideReason("");
        if (next === "option") {
            // No options prices yet: the user enters the premium, strike and expiry.
            setSide("buy");
            setType("limit");
            setLimitPrice(0);
            setLimitTouched(true);
            setOptionContractType("call");
            setOptionStrike(lastPrice ? Math.round(lastPrice) : 0);
            setOptionExpiry("");
            return;
        }
        setLimitTouched(false);
        setStopTouched(false);
    };

    const suggestedPrice = lastPrice ? round2(lastPrice) : 0;
    const limitValue = isOptionOrder || limitTouched ? limitPrice : suggestedPrice;
    const stopValue = stopTouched ? stopPrice : suggestedPrice;

    const orderTypeOptions = isOptionOrder
        ? (["limit"] as OrderType[])
        : (Object.keys(ORDER_TYPE_LABELS) as OrderType[]);
    const price = isOptionOrder
        ? limitValue
        : effectivePrice(type, limitValue, stopValue, lastPrice);
    const cleanQuantity = Number.isFinite(quantity) ? quantity : 0;
    const exposureMultiplier = isOptionOrder ? OPTION_CONTRACT_MULTIPLIER : 1;
    const notional = price * cleanQuantity * exposureMultiplier;
    const cash = account?.cash ?? 0;
    const cashAfter = cashAfterOrder(cash, side, notional);

    const currentQty = useMemo(
        () => (isOptionOrder ? 0 : positionIn(account, tickerUpper).quantity),
        [isOptionOrder, account, tickerUpper],
    );
    const qtyDelta = side === "buy" ? cleanQuantity : -cleanQuantity;
    const positionAfter = currentQty + qtyDelta;

    const showLimit = type === "limit" || type === "stop_limit";
    const showStop = type === "stop" || type === "stop_limit";

    // What the user holds of the ticker across every account, valued as Today values it.
    const heldValue = useMemo(
        () => policyPortfolio.holdings
            .filter((holding) => holding.symbol.toUpperCase() === tickerUpper)
            .reduce((sum, holding) => sum + holding.marketValue, 0),
        [policyPortfolio.holdings, tickerUpper],
    );

    const baseGuardrails = useGuardrails({
        side,
        orderType: type,
        isOptionOrder,
        ticker: tickerUpper,
        priceKnown: lastPrice !== undefined,
        priceLookupPending,
        accountName: account?.name ?? "the account",
        cashAfter,
        positionAfter,
        postPositionValue: isOptionOrder ? notional : heldValue + (side === "buy" ? notional : -notional),
        portfolioValue: policyValue,
        concentrationCapEnabled: guardrailPrefs.concentrationCapEnabled,
        concentrationCapPct: guardrailPrefs.concentrationCapPct,
        shortUnitLabel: isOptionOrder ? "contract" : "share",
    });

    const optionOrderPolicy = useMemo(
        () =>
            evaluateOptionOrderPolicy({
                isOption: isOptionOrder,
                underlying: tickerUpper,
                contractType: optionContractType,
                strike: optionStrike,
                expiry: optionExpiry,
                quantity,
                premium: price,
                side,
                totalPortfolioValue: policyValue,
                liquidNetWorth: policyValue,
                linkedThesisId: rationaleDraft.thesisId,
                maxLossAcknowledged,
                whatMustBeTrueByExpiry,
                plannedExitRule,
                // No options feed yet: no option positions, rather than example ones.
                existingPositions: [],
                policy: optionsRiskPolicy,
            }),
        [
            policyValue,
            isOptionOrder,
            tickerUpper,
            optionContractType,
            optionStrike,
            optionExpiry,
            quantity,
            price,
            side,
            rationaleDraft.thesisId,
            maxLossAcknowledged,
            whatMustBeTrueByExpiry,
            plannedExitRule,
            optionsRiskPolicy,
        ],
    );
    const optionGuardrails = useMemo(
        () => buildOptionGuardrails(isOptionOrder, optionOrderPolicy.checks),
        [isOptionOrder, optionOrderPolicy.checks],
    );
    const sellDisciplineSummary = useMemo(
        () =>
            evaluateSellDiscipline({
                rules: sellDisciplineRules,
                holdings: policyHoldingRows,
                theses: theses.filter((thesis) => !isSeedThesis(thesis)),
                portfolioValue: policyValue,
            }),
        [sellDisciplineRules, policyHoldingRows, theses, policyValue],
    );
    const sellDisciplineGuardrail = useMemo(
        () => buildSellDisciplineGuardrail(side, tickerUpper, sellDisciplineSummary.tasks),
        [side, tickerUpper, sellDisciplineSummary.tasks],
    );
    const selectedThesis = useMemo(
        () => theses.find((thesis) => thesis.id === rationaleDraft.thesisId),
        [theses, rationaleDraft.thesisId],
    );
    const riskPolicyImpact = useMemo(
        () =>
            evaluatePreTradeRiskPolicy({
                holdings: policyHoldingRows,
                portfolioValue: policyValue,
                trade: {
                    ticker: tickerUpper,
                    side,
                    quantity,
                    price,
                    instrumentType,
                    marketValue: notional,
                    policyBucket: chosenBucketForTrade(riskPolicy, tickerUpper, instrumentType),
                    optionPremiumAtRisk: isOptionOrder ? optionOrderPolicy.premiumAtRisk : undefined,
                    linkedThesisId: rationaleDraft.thesisId,
                    thesisUpdatedAt: selectedThesis?.dateUpdated,
                },
                existingOptionPositions: [],
                bucketPolicies: riskPolicy.bucketPolicies,
                themeCaps: riskPolicy.themeCaps,
                optionsRiskPolicy,
                maxSinglePositionPct: guardrailPrefs.concentrationCapPct,
                overrideReason: riskPolicyOverrideReason,
                employerSymbols: policyEmployerSymbols,
                portfolioUnavailable: policyUnavailable,
            }),
        [
            policyUnavailable,
            policyHoldingRows,
            policyValue,
            policyEmployerSymbols,
            tickerUpper,
            side,
            quantity,
            price,
            instrumentType,
            notional,
            isOptionOrder,
            optionOrderPolicy.premiumAtRisk,
            rationaleDraft.thesisId,
            selectedThesis?.dateUpdated,
            riskPolicy,
            optionsRiskPolicy,
            guardrailPrefs.concentrationCapPct,
            riskPolicyOverrideReason,
        ],
    );
    const riskPolicyGuardrail = useMemo(
        () => buildRiskPolicyGuardrail(riskPolicyImpact),
        [riskPolicyImpact],
    );
    const guardrails = useMemo(
        () => [
            ...baseGuardrails,
            ...optionGuardrails,
            ...(sellDisciplineGuardrail ? [sellDisciplineGuardrail] : []),
            riskPolicyGuardrail,
        ],
        [baseGuardrails, optionGuardrails, sellDisciplineGuardrail, riskPolicyGuardrail],
    );

    // AR-111 live adherence. Resolve the strategy by mapping the draft
    // rationale's thesis id — the rationale chip row commits thesisId
    // synchronously when the user picks or creates a thesis, so by the
    // time the user is finalizing conviction/mood the mapping is stable.
    // (Strategies are still examples until launch item i55.)
    //
    // We pass a fully-formed `TradeContext` rather than threading raw
    // form state so the evaluator stays ignorant of the ticket shape.
    // `nav` is the user's portfolio, holdings and cash.
    const resolvedStrategyId = rationaleDraft.thesisId
        ? SEED_THESIS_TO_STRATEGY[rationaleDraft.thesisId]
        : undefined;
    const adherenceRules = resolvedStrategyId
        ? SEED_ADHERENCE_RULES[resolvedStrategyId] ?? []
        : [];
    const strategyName = useMemo(() => {
        if (!resolvedStrategyId) return undefined;
        return SEED_STRATEGIES.find((s) => s.id === resolvedStrategyId)?.name;
    }, [resolvedStrategyId]);

    const liveContext = useMemo<TradeContext>(() => {
        const nav = policyValue > 0 ? policyValue : undefined;
        // Post-trade market value of the subject position. Uses the last
        // price (or effective limit/stop) so the % is computed against the
        // same dollar figure the user sees in the preview.
        const postMarketValue = isOptionOrder
            ? positionAfter * price * OPTION_CONTRACT_MULTIPLIER
            : positionAfter * price;
        // Rationale is finalized only when the draft is complete; partial
        // drafts won't satisfy `thesis_required` or `min_conviction`,
        // which is the honest answer mid-compose.
        const rationale = isRationaleComplete(rationaleDraft)
            ? finalizeRationale(rationaleDraft)
            : null;
        return {
            ticker: tickerUpper,
            side,
            nav,
            postMarketValue,
            // The example strategies' sector caps name sectors the
            // securities master doesn't use; unknown sectors pass.
            sector: undefined,
            sectorExposurePct: undefined,
            // No live earnings data yet; evaluator treats this as neutral
            // pass so the row renders "—" instead of crying wolf.
            daysUntilEarnings: null,
            // Stop price only exists on stop / stop_limit orders. Passing
            // `undefined` on market / limit is the whole point of the rule
            // firing: the discipline check asks "did you set a stop?"
            stopLoss: showStop ? stopValue : undefined,
            rationale,
            executedAt: new Date().toISOString(),
        };
    }, [
        policyValue,
        tickerUpper,
        side,
        isOptionOrder,
        positionAfter,
        price,
        showStop,
        stopValue,
        rationaleDraft,
    ]);

    // AR-109: the rationale block has its own completeness gate.
    // Isolated from the other order-level gates so the Submit button's
    // disabled state is explainable ("rationale incomplete" vs
    // "concentration cap breached"), and so the gate can be toggled
    // off wholesale via the settings slice without re-threading
    // conditions through the rest of the form.
    const rationaleComplete = isRationaleComplete(rationaleDraft);
    const rationaleBlocksSubmit = rationaleRequired && !rationaleComplete;

    // AR-110: running cooldown blocks submit too, but separately — the
    // button gets a "Hold on… Ns" label instead of the generic disabled
    // state so the user knows what's happening.
    const cooldownActive = cooldownEndMs != null && cooldownNow < cooldownEndMs;
    const cooldownRemainingSec = cooldownActive && cooldownEndMs != null
        ? Math.max(0, Math.ceil((cooldownEndMs - cooldownNow) / 1000))
        : 0;
    // Fraction of the cooldown still remaining, 0..1. Drives the bar
    // fill on the Submit button via `--pm-cooldown-progress`.
    const cooldownFraction =
        cooldownActive && cooldownEndMs != null && cooldownSeconds > 0
            ? Math.max(
                  0,
                  Math.min(
                      1,
                      (cooldownEndMs - cooldownNow) / (cooldownSeconds * 1000),
                  ),
              )
            : 0;

    const submitDisabled =
        !account ||
        !tickerUpper ||
        !Number.isFinite(quantity) ||
        quantity <= 0 ||
        (showLimit && !(limitValue > 0)) ||
        (showStop && !(stopValue > 0)) ||
        (isOptionOrder && (!optionStrike || optionStrike <= 0 || !optionExpiry.trim())) ||
        guardrails.some((g) => g.level === "fail") ||
        rationaleBlocksSubmit ||
        cooldownActive ||
        saving;

    const handleSubmit = async () => {
        if (submitDisabled || !account) return;
        // AR-110 cooldown gate. If the user tagged a caution mood and
        // the cooldown preset is non-zero, the first Submit press
        // *starts* the timer instead of firing. Second press (after
        // the timer clears) actually submits. We deliberately don't
        // auto-submit when the timer ends — that would violate the
        // "never fills on click" promise and the user might have
        // walked away.
        if (
            moodIsCaution &&
            cooldownSeconds > 0 &&
            cooldownEndMs == null
        ) {
            const now = Date.now();
            setCooldownEndMs(now + cooldownSeconds * 1000);
            setCooldownNow(now);
            // Fire-and-forget analytics. The mood narrow is safe here —
            // `moodIsCaution` is only true when mood is literally
            // 'fomo' or 'revenge'.
            track("trade.cooldown.started", {
                ticker: tickerUpper,
                side,
                notionalUsd: notional,
                mood: rationaleDraft.mood as "fomo" | "revenge",
                cooldownSeconds,
            });
            return;
        }
        // Finalize the rationale if it's complete. If the setting is
        // off and the user didn't fill one in, we stamp a "skipped"
        // analytics event so weekly-review surfaces can still surface
        // the miss — the audit trail matters even when the feature is
        // disabled.
        const rationale = rationaleComplete
            ? finalizeRationale(rationaleDraft)
            : undefined;

        const plan = orderPlanInput({
            portfolioId: account.id,
            instrumentType,
            ticker: tickerUpper,
            side,
            type,
            quantity,
            limitPrice: limitValue,
            stopPrice: stopValue,
            timeInForce: tif,
            price: tickerPrice,
            needsApproval: orderNeedsApproval(isOptionOrder ? optionOrderPolicy.premiumAtRisk : notional, guardrailPrefs),
            rationale,
            optionDetails: isOptionOrder
                ? {
                    underlying: tickerUpper,
                    contractType: optionContractType,
                    strike: optionStrike,
                    expiry: optionExpiry,
                    premium: price,
                    contractMultiplier: OPTION_CONTRACT_MULTIPLIER,
                    premiumAtRisk: optionOrderPolicy.premiumAtRisk,
                    notionalEquivalent: optionOrderPolicy.notionalEquivalent,
                    maxLossAcknowledged,
                    whatMustBeTrueByExpiry: whatMustBeTrueByExpiry.trim(),
                    plannedExitRule: plannedExitRule.trim(),
                }
                : undefined,
            policy: riskPolicyImpact,
            overrideReason: riskPolicyOverrideReason,
        });
        setSaving(true);
        const saved = await onSubmit(plan);
        setSaving(false);
        // Not saved: the ticket stays as it was so the user can try again.
        if (!saved) return;
        if (rationale) {
            track("trade.rationale.submitted", {
                ticker: tickerUpper,
                side,
                notionalUsd: notional,
                setupType: rationale.setupType,
                mood: rationale.mood,
                conviction: rationale.conviction,
                rationaleLength: rationale.rationale.length,
                timeToDecisionMs: rationale.timeToDecisionMs,
            });
        } else {
            // Only `setting_off` is reachable here: if the setting is on
            // but the rationale is incomplete, `rationaleBlocksSubmit`
            // would have disabled the button and we wouldn't be
            // executing. The `unsupported_flow` label belongs to other
            // surfaces (Checkout, Terminal) that will track their own
            // skipped events when they wire rationale capture.
            track("trade.rationale.skipped", {
                ticker: tickerUpper,
                side,
                notionalUsd: notional,
                reason: "setting_off",
            });
        }
        // Reset the rationale so the next ticket renders with a fresh
        // `capturedAt` and an empty form.
        setRationaleDraft(createRationaleDraft());
        setRiskPolicyOverrideReason("");
        if (isOptionOrder) {
            setMaxLossAcknowledged(false);
            setWhatMustBeTrueByExpiry("");
            setPlannedExitRule("");
        }
    };

    // --- Keyboard mode -------------------------------------------------------
    // Latest-value ref so the window listener subscribes once but always
    // sees the current handler, options, and help state.
    const keyboardRef = useRef({ handleSubmit, orderTypeOptions, showShortcuts: false });
    useEffect(() => {
        keyboardRef.current = { handleSubmit, orderTypeOptions, showShortcuts };
    });
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const action = resolveTicketShortcut({
                key: e.key,
                metaKey: e.metaKey,
                ctrlKey: e.ctrlKey,
                altKey: e.altKey,
                repeat: e.repeat,
                inEditable: isEditableElement(document.activeElement),
                overlayOpen: useUiStore.getState().commandOpen,
            });
            if (!action) return;
            const current = keyboardRef.current;
            switch (action.kind) {
                case "side":
                    setSide(action.side);
                    break;
                case "orderType":
                    if (!current.orderTypeOptions.includes(action.orderType)) return;
                    setType(action.orderType);
                    break;
                case "focus":
                    (action.field === "ticker" ? tickerInputRef : quantityInputRef).current?.select();
                    break;
                case "submit":
                    void current.handleSubmit();
                    break;
                case "help":
                    setShowShortcuts((v) => !v);
                    break;
                case "escape":
                    if (current.showShortcuts) {
                        setShowShortcuts(false);
                    } else if (isEditableElement(document.activeElement)) {
                        (document.activeElement as HTMLElement).blur();
                    } else {
                        return;
                    }
                    break;
            }
            e.preventDefault();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    const baseSubmitLabel = side === "buy" ? "Save buy order" : "Save sell order";
    const submitLabel = cooldownActive
        ? `Hold on\u2026 ${cooldownRemainingSec}s`
        : saving
            ? "Saving\u2026"
            : baseSubmitLabel;
    const submitClass = `pm-btn ${
        side === "buy" ? "pm-btn-primary" : "pm-btn-danger"
    } pm-exec-submit`;

    // Title attribute explains the "why" for a screen reader or a
    // hover. Cooldown message wins over rationale because it's the
    // more immediate reason Submit is dark.
    const submitTitle = cooldownActive
        ? `Cooldown: ${cooldownRemainingSec}s remaining before the ticket unlocks`
        : rationaleBlocksSubmit
            ? "Fill in the rationale to enable submit"
            : undefined;

    return (
        <section
            className="pm-exec-form pm-card"
            aria-label="New order"
            data-side={side}
        >
            <header className="pm-exec-form-head">
                <h3 className="pm-exec-form-title">New order</h3>
                <span className="pm-exec-form-sub">
                    Saved for you to place at your broker. Atlas never places orders.
                </span>
                <button
                    type="button"
                    className="pm-exec-kbd-toggle"
                    aria-expanded={showShortcuts}
                    aria-controls="exec-shortcuts"
                    onClick={() => setShowShortcuts((v) => !v)}
                    title="Keyboard shortcuts (?)"
                >
                    <kbd>?</kbd> Shortcuts
                </button>
            </header>

            {showShortcuts && (
                <div id="exec-shortcuts" className="pm-exec-kbd-sheet" role="region" aria-label="Keyboard shortcuts">
                    <ul>
                        {TICKET_SHORTCUTS.map((s) => (
                            <li key={s.label}>
                                <span className="pm-exec-kbd-keys">
                                    {s.keys.map((k) => <kbd key={k}>{k}</kbd>)}
                                </span>
                                {s.label}
                            </li>
                        ))}
                    </ul>
                    <p>Letters work when you are not typing in a field. Reviewing still checks your rules.</p>
                </div>
            )}

            {/* Account */}
            <label className="pm-exec-field">
                <span className="pm-exec-field-label">Account</span>
                <select
                    className="pm-exec-input"
                    aria-label="Account"
                    value={accountId ?? ""}
                    onChange={(e) => setAccountId(e.target.value)}
                >
                    {accounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                </select>
            </label>

            {/* Instrument toggle */}
            <div className="pm-exec-instrument" role="tablist" aria-label="Instrument type">
                {(["equity", "option"] as OrderInstrumentType[]).map((next) => (
                    <button
                        key={next}
                        type="button"
                        role="tab"
                        aria-selected={instrumentType === next}
                        className={`pm-exec-instrument-btn${instrumentType === next ? " is-active" : ""}`}
                        onClick={() => handleInstrumentChange(next)}
                    >
                        {INSTRUMENT_LABELS[next]}
                    </button>
                ))}
            </div>

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
                        ref={tickerInputRef}
                        type="text"
                        className="pm-exec-input"
                        aria-label="Ticker"
                        aria-describedby={priceNote ? "exec-price-note" : undefined}
                        value={ticker}
                        onChange={(e) => handleTickerChange(e.target.value)}
                        placeholder="AAPL"
                        maxLength={10}
                    />
                    <span className="pm-exec-field-hint num" data-testid="ticker-price">
                        {lastPrice ? formatUsd(lastPrice) : "—"}
                    </span>
                </div>
                {priceNote && (
                    <span id="exec-price-note" className="pm-exec-field-note" data-testid="ticker-price-note">
                        {priceNote}
                    </span>
                )}
            </label>

            {/* Qty + Type */}
            <div className="pm-exec-row-2">
                <label className="pm-exec-field">
                    <span className="pm-exec-field-label">Quantity</span>
                    <input
                        ref={quantityInputRef}
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
                        {orderTypeOptions.map((t) => (
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
                                value={limitValue || ""}
                                min={0}
                                step={0.01}
                                onChange={(e) => {
                                    setLimitPrice(Number(e.target.value));
                                    setLimitTouched(true);
                                }}
                            />
                        </label>
                    )}
                    {showStop && (
                        <label className="pm-exec-field">
                            <span className="pm-exec-field-label">Stop price</span>
                            <input
                                type="number"
                                className="pm-exec-input num"
                                value={stopValue || ""}
                                min={0}
                                step={0.01}
                                onChange={(e) => {
                                    setStopPrice(Number(e.target.value));
                                    setStopTouched(true);
                                }}
                            />
                        </label>
                    )}
                    {/* Ghost cell to keep the grid aligned when only one shows */}
                    {showLimit !== showStop && <div aria-hidden />}
                </div>
            )}

            {isOptionOrder && (
                <section
                    className="pm-exec-option-panel"
                    aria-label="Options policy details"
                    data-status={optionOrderPolicy.status}
                >
                    <div className="pm-exec-option-grid">
                        <label className="pm-exec-field">
                            <span className="pm-exec-field-label">Option contract</span>
                            <select
                                className="pm-exec-input"
                                value={optionContractType}
                                onChange={(e) => setOptionContractType(e.target.value as OptionContractType)}
                            >
                                {(Object.keys(OPTION_CONTRACT_LABELS) as OptionContractType[]).map((contractType) => (
                                    <option key={contractType} value={contractType}>
                                        {OPTION_CONTRACT_LABELS[contractType]}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="pm-exec-field">
                            <span className="pm-exec-field-label">Option strike</span>
                            <input
                                type="number"
                                className="pm-exec-input num"
                                value={optionStrike || ""}
                                min={0.01}
                                step={0.01}
                                onChange={(e) => setOptionStrike(Number(e.target.value))}
                            />
                        </label>

                        <label className="pm-exec-field">
                            <span className="pm-exec-field-label">Option expiry</span>
                            <input
                                type="date"
                                className="pm-exec-input"
                                value={optionExpiry}
                                onChange={(e) => setOptionExpiry(e.target.value)}
                            />
                        </label>
                    </div>

                    <div className="pm-exec-option-metrics" aria-label="Option risk preview">
                        <PreviewRow label="Premium at risk" value={formatUsd(optionOrderPolicy.premiumAtRisk)} />
                        <PreviewRow label="Notional equivalent" value={formatUsd(optionOrderPolicy.notionalEquivalent)} />
                        <PreviewRow label="Days to expiry" value={`${optionOrderPolicy.daysToExpiry.toLocaleString()}d`} />
                    </div>

                    <label className="pm-exec-field">
                        <span className="pm-exec-field-label">What must be true by expiry?</span>
                        <textarea
                            className="pm-exec-textarea"
                            value={whatMustBeTrueByExpiry}
                            onChange={(e) => setWhatMustBeTrueByExpiry(e.target.value)}
                            rows={2}
                            maxLength={240}
                            placeholder="Name the business or market condition the option needs before expiry."
                        />
                    </label>

                    <label className="pm-exec-field">
                        <span className="pm-exec-field-label">Exit / roll rule</span>
                        <textarea
                            className="pm-exec-textarea"
                            value={plannedExitRule}
                            onChange={(e) => setPlannedExitRule(e.target.value)}
                            rows={2}
                            maxLength={180}
                            placeholder="Example: close at 50% loss or roll 90 days before expiry."
                        />
                    </label>

                    <label className="pm-exec-checkbox-row">
                        <input
                            type="checkbox"
                            checked={maxLossAcknowledged}
                            onChange={(e) => setMaxLossAcknowledged(e.target.checked)}
                        />
                        <span>
                            I understand the option max loss is the premium paid.
                        </span>
                    </label>
                </section>
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
                <PreviewRow
                    label={isOptionOrder ? "Premium debit" : "Notional"}
                    value={formatUsd(notional)}
                />
                <PreviewRow
                    label="Cash after"
                    value={formatUsd(cashAfter)}
                    tone={cashAfter < 0 ? "pm-num-neg" : ""}
                />
                <PreviewRow
                    label="Position after"
                    value={`${positionAfter.toLocaleString()} ${isOptionOrder ? "ct" : "sh"}`}
                    tone={positionAfter < 0 ? "pm-num-neg" : ""}
                />
            </div>

            <RiskPolicyImpactPanel
                impact={riskPolicyImpact}
                overrideReason={riskPolicyOverrideReason}
                onOverrideReasonChange={setRiskPolicyOverrideReason}
            />

            {/* Guardrails */}
            <div className="pm-exec-guardrails" role="list" aria-label="Guardrails">
                {guardrails.map((g) => (
                    <div
                        key={`${g.label}-${g.message}`}
                        className={`pm-exec-guardrail is-${g.level}`}
                        role="listitem"
                    >
                        <span className="pm-exec-guardrail-dot" aria-hidden="true" />
                        <span className="pm-exec-guardrail-label">{g.label}</span>
                        <span className="pm-exec-guardrail-msg">{g.message}</span>
                    </div>
                ))}
            </div>

            {/* Pre-trade rationale (AR-109 / JournalPlus). Rendered only
                when the user has the capture enabled. The parent owns
                `rationaleDraft` so the gate on Submit sees the same
                draft the panel is editing, and so the draft resets on
                successful submit. */}
            {rationaleRequired && (
                <PreTradeRationale
                    ticker={tickerUpper}
                    value={rationaleDraft}
                    onChange={setRationaleDraft}
                />
            )}

            {/* AR-111 live adherence check. Only renders when a strategy
                has been resolved from the rationale's thesis id and that
                strategy has at least one discipline rule. Non-blocking
                in v1 — Submit stays enabled even on a failing score; the
                panel exists to inform the decision, not to override it. */}
            <AdherencePanel
                rules={adherenceRules}
                context={liveContext}
                strategyName={strategyName}
            />

            {/* Foot */}
            <footer className="pm-exec-form-foot">
                <span className="pm-exec-foot-summary num" aria-live="polite">
                    {side === "buy" ? "Buy" : "Sell"} {quantity.toLocaleString("en-US")} {tickerUpper || "—"}
                </span>
                <button
                    type="button"
                    className={submitClass}
                    disabled={submitDisabled}
                    onClick={() => void handleSubmit()}
                    title={submitTitle}
                    data-cooldown={cooldownActive ? "true" : undefined}
                    style={
                        cooldownActive
                            ? ({
                                  ["--pm-cooldown-progress" as string]:
                                      cooldownFraction,
                              } as CSSProperties)
                            : undefined
                    }
                >
                    <span>{submitLabel}</span>
                    <kbd className="pm-exec-submit-kbd" aria-hidden="true">⌘↵</kbd>
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

function RiskPolicyImpactPanel({
    impact,
    overrideReason,
    onOverrideReasonChange,
}: {
    impact: PreTradeRiskPolicyImpact;
    overrideReason: string;
    onOverrideReasonChange: (value: string) => void;
}) {
    const visibleChecks = impact.failedChecks.length > 0
        ? impact.failedChecks
        : impact.checks
            .filter((check) => check.direction === "risk_reducing" || check.direction === "risk_increasing")
            .slice(0, 3);
    const tone = impact.decision === "allowed"
        ? impact.direction === "risk_reducing"
            ? "reducing"
            : "inside"
        : "override";

    return (
        <section
            className="pm-exec-policy-impact"
            data-testid="risk-policy-impact"
            data-tone={tone}
            aria-label="Risk policy impact"
        >
            <header className="pm-exec-policy-impact-head">
                <div>
                    <div className="pm-exec-policy-kicker">Risk policy</div>
                    <h4 className="pm-exec-policy-title">{impact.summary}</h4>
                </div>
                <span className={`pm-exec-policy-pill is-${tone}`}>
                    {impact.decision === "allowed"
                        ? impact.direction === "risk_reducing"
                            ? "Reducing"
                            : "Inside"
                        : "Override needed"}
                </span>
            </header>

            {visibleChecks.length > 0 && (
                <div className="pm-exec-policy-checks">
                    {visibleChecks.map((check) => (
                        <PolicyCheckRow key={`${check.ruleType}-${check.label}`} check={check} />
                    ))}
                </div>
            )}

            {impact.requiresOverride && (
                <label className="pm-exec-field">
                    <span className="pm-exec-field-label">Override reason</span>
                    <textarea
                        className="pm-exec-textarea"
                        value={overrideReason}
                        onChange={(event) => onOverrideReasonChange(event.target.value)}
                        rows={2}
                        maxLength={240}
                        placeholder="Record why this policy exception is intentional."
                    />
                </label>
            )}
        </section>
    );
}

function PolicyCheckRow({ check }: { check: PreTradeRiskPolicyCheck }) {
    return (
        <div
            className="pm-exec-policy-check"
            data-status={check.status}
            data-rule-type={check.ruleType}
        >
            <div className="pm-exec-policy-check-main">
                <span className="pm-exec-policy-check-label">{check.label}</span>
                <span className="pm-exec-policy-check-msg">{check.message}</span>
            </div>
            <div className="pm-exec-policy-metrics" aria-label={`${check.label} exposure`}>
                <span>
                    <b>Now</b>
                    {formatPolicyPct(check.currentPct)}
                </span>
                <span>
                    <b>Post</b>
                    {formatPolicyPct(check.postPct)}
                </span>
                <span>
                    <b>Limit</b>
                    {formatPolicyPct(check.thresholdPct)}
                </span>
            </div>
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
    orderType,
    isOptionOrder,
    ticker,
    priceKnown,
    priceLookupPending,
    accountName,
    cashAfter,
    positionAfter,
    postPositionValue,
    portfolioValue,
    concentrationCapEnabled,
    concentrationCapPct,
    shortUnitLabel = "share",
}: {
    side: OrderSide;
    orderType: OrderType;
    isOptionOrder: boolean;
    ticker: string;
    /** Atlas has a last price for the ticker. */
    priceKnown: boolean;
    priceLookupPending: boolean;
    accountName: string;
    cashAfter: number;
    positionAfter: number;
    /** The user's position in the ticker across every account once placed, in dollars. */
    postPositionValue: number;
    /** Holdings and cash across every account. */
    portfolioValue: number;
    concentrationCapEnabled: boolean;
    concentrationCapPct: number;
    shortUnitLabel?: string;
}): Guardrail[] {
    return useMemo(() => {
        // A market order is sized at the last price: without one there's
        // nothing to check it against, so the user sets a limit instead.
        const priceCheck: Guardrail | null =
            ticker && !isOptionOrder && orderType === "market" && !priceKnown && !priceLookupPending
                ? {
                    label: "Price",
                    message: `No price for ${ticker} yet. Use a limit order to size it.`,
                    level: "fail",
                }
                : null;

        // The account's cash as Atlas has it. Many accounts don't track
        // cash here (or trade on margin), so running short only warns.
        const cash: Guardrail =
            cashAfter < 0
                ? {
                    label: "Cash",
                    message: `${formatUsd(Math.abs(cashAfter))} more than ${accountName}'s cash`,
                    level: "warn",
                }
                : {
                    label: "Cash",
                    message: `${formatUsd(cashAfter)} left in ${accountName}`,
                    level: "ok",
                };

        // Concentration — the post-trade position, across accounts, as a %
        // of the portfolio. Thresholds come from the user's Settings ›
        // Guardrails card (AR-89). When the toggle is off we surface a
        // neutral chip so the user still sees that the check ran — just
        // with no ceiling. The warn band kicks in at 80% of the hard cap so
        // big names light up amber before they block the order.
        const concentrationPct = portfolioValue > 0 ? Math.max(0, postPositionValue) / portfolioValue : null;
        const capFrac = concentrationCapPct / 100;
        const warnFrac = capFrac * 0.8;
        const share = concentrationPct === null ? "" : `${(concentrationPct * 100).toFixed(1)}% of your portfolio`;
        const conc: Guardrail = concentrationPct === null
            ? {
                label: "Concentration",
                message: "No portfolio value to compare with yet",
                level: "ok",
            }
            : !concentrationCapEnabled
                ? {
                    label: "Concentration",
                    message: `${share} (cap off)`,
                    level: "ok",
                }
                : concentrationPct > capFrac
                    ? {
                        label: "Concentration",
                        message: `${share} (cap ${concentrationCapPct}%)`,
                        level: "fail",
                    }
                    : {
                        label: "Concentration",
                        message: share,
                        level: concentrationPct > warnFrac ? "warn" : "ok",
                    };

        // Short-sale check: selling more than the account holds.
        const shortCheck: Guardrail | null =
            side === "sell" && positionAfter < 0
                ? {
                    label: "Short sale",
                    message: `Would open ${Math.abs(positionAfter)} ${shortUnitLabel} short in ${accountName}`,
                    level: "warn",
                }
                : null;

        return [...(priceCheck ? [priceCheck] : []), cash, conc, ...(shortCheck ? [shortCheck] : [])];
    }, [
        side,
        orderType,
        isOptionOrder,
        ticker,
        priceKnown,
        priceLookupPending,
        accountName,
        cashAfter,
        positionAfter,
        postPositionValue,
        portfolioValue,
        concentrationCapEnabled,
        concentrationCapPct,
        shortUnitLabel,
    ]);
}

function buildOptionGuardrails(
    isOptionOrder: boolean,
    checks: readonly OptionPolicyIssue[],
): Guardrail[] {
    if (!isOptionOrder) return [];
    if (checks.length === 0) {
        return [{
            label: "Options policy",
            message: "Inside premium, thesis, max-loss, and expiry rules",
            level: "ok",
        }];
    }

    return checks.map((check) => ({
        label: optionIssueLabel(check.code),
        message: check.message,
        level: check.severity === "breached" || check.severity === "missing_data"
            ? "fail"
            : "warn",
    }));
}

function buildSellDisciplineGuardrail(
    side: OrderSide,
    ticker: string,
    tasks: readonly SellDisciplineTask[],
): Guardrail | null {
    const task = sellDisciplineBlocksAdd(tasks, ticker);
    if (!task) return null;
    if (side === "sell") {
        return {
            label: "Sell discipline",
            message: `${task.label} is open; this ticket reduces the flagged exposure.`,
            level: "ok",
        };
    }
    return {
        label: "Sell discipline",
        message: `No-add rule triggered: ${task.label}`,
        level: "fail",
    };
}

function buildRiskPolicyGuardrail(impact: PreTradeRiskPolicyImpact): Guardrail {
    if (impact.blocksSubmit) {
        return {
            label: "Risk policy",
            message: impact.summary,
            level: "fail",
        };
    }
    if (impact.failedChecks.length > 0) {
        return {
            label: "Risk policy",
            message: impact.summary,
            level: "warn",
        };
    }
    return {
        label: "Risk policy",
        message: impact.summary,
        level: "ok",
    };
}

function optionIssueLabel(code: string): string {
    switch (code) {
        case "missing_thesis":
            return "Options thesis";
        case "max_loss_ack":
            return "Max loss ack";
        case "expiry_truth":
            return "Expiry thesis";
        case "exit_rule":
            return "Exit rule";
        case "position_size_cap":
        case "position_size_watch":
            return "Position size";
        case "total_options_cap":
        case "loss_budget_cap":
            return "Options budget";
        case "near_expiry":
        case "expired_contract":
            return "Expiry window";
        case "short_option":
            return "Short option";
        case "invalid_quantity":
        case "invalid_premium":
        case "invalid_strike":
        case "invalid_expiry":
            return "Contract details";
        default:
            return "Options policy";
    }
}

function formatPolicyPct(value: number): string {
    if (!Number.isFinite(value)) return "—";
    return `${value.toFixed(Math.abs(value) < 10 ? 1 : 0)}%`;
}

// --------------------------------------------------------------------- //
// Orders panel — right card
// --------------------------------------------------------------------- //

interface OrdersPanelProps {
    orders: Order[];
    accountNames: ReadonlyMap<string, string>;
    /** Plans with a status change on its way. */
    busyIds: ReadonlySet<string>;
    filter: BlotterFilter;
    onFilter: (f: BlotterFilter) => void;
    onChangeStatus: (order: Order, status: OrderStatusChange) => void;
}

function OrdersPanel({
    orders,
    accountNames,
    busyIds,
    filter,
    onFilter,
    onChangeStatus,
}: OrdersPanelProps) {
    // AR-89: the approval threshold is user-configurable; the banner names it.
    const approvalThresholdUsd = useSettingsStore((s) => s.guardrails.approvalThresholdUsd);
    const todayEt = useEasternDate();
    const counts = useMemo(() => {
        const c: Record<BlotterFilter, number> = {
            all: orders.length,
            ready: 0,
            placed: 0,
            cancelled: 0,
        };
        for (const o of orders) {
            if (o.status === "ready" || o.status === "placed" || o.status === "cancelled") c[o.status] += 1;
        }
        return c;
    }, [orders]);

    const filtered = useMemo(() => {
        const rows = filter === "all" ? orders : orders.filter((o) => o.status === filter);
        return sortOrdersNewestFirst(rows);
    }, [orders, filter]);

    const approvalQueue = useMemo(
        () => sortOrdersNewestFirst(orders.filter((o) => o.status === "pending_approval")),
        [orders],
    );

    return (
        <section
            className="pm-exec-blotter pm-card"
            aria-label="Your orders"
            aria-live="polite"
        >
            <header className="pm-exec-blotter-head">
                <h3 className="pm-exec-blotter-title">Your orders</h3>
                <div className="pm-exec-chips" role="tablist" aria-label="Order filter">
                    {(["all", "ready", "placed", "cancelled"] as BlotterFilter[]).map((f) => (
                        <button
                            key={f}
                            type="button"
                            role="tab"
                            aria-selected={filter === f}
                            className={`pm-exec-chip${filter === f ? " is-active" : ""}`}
                            onClick={() => onFilter(f)}
                        >
                            {FILTER_LABELS[f]}
                            <span className="pm-exec-chip-count">{counts[f]}</span>
                        </button>
                    ))}
                </div>
            </header>

            {approvalQueue.length > 0 && (
                <ApprovalBanner
                    orders={approvalQueue}
                    threshold={approvalThresholdUsd}
                    busyIds={busyIds}
                    onChangeStatus={onChangeStatus}
                />
            )}

            <OrdersTable
                orders={filtered}
                accountNames={accountNames}
                busyIds={busyIds}
                todayEt={todayEt}
                empty={orders.length === 0 ? "No orders yet. Orders you save appear here." : "No orders in this view."}
                onChangeStatus={onChangeStatus}
            />
        </section>
    );
}

function ApprovalBanner({
    orders,
    threshold,
    busyIds,
    onChangeStatus,
}: {
    orders: Order[];
    threshold: number;
    busyIds: ReadonlySet<string>;
    onChangeStatus: (order: Order, status: OrderStatusChange) => void;
}) {
    return (
        <div
            className="pm-exec-approval"
            role="region"
            aria-label="Approval queue"
            aria-live="polite"
        >
            <div className="pm-exec-approval-head">
                <AlertTriangle className="pm-exec-approval-icon" aria-hidden="true" />
                <div className="pm-exec-approval-text">
                    <div className="pm-exec-approval-title">
                        {orders.length} order{orders.length > 1 ? "s" : ""} need{orders.length > 1 ? "" : "s"} your approval
                    </div>
                    <div className="pm-exec-approval-sub">
                        Over your {formatUsd(threshold, 0)} approval threshold. Approve before you place {orders.length > 1 ? "them" : "it"} at your broker, or cancel.
                    </div>
                </div>
            </div>
            <ul className="pm-exec-approval-list" role="list">
                {orders.map((o) => {
                    const price = orderDisplayPrice(o);
                    const unit = o.instrumentType === "option" ? "ct" : "sh";
                    const busy = busyIds.has(o.id);
                    return (
                        <li key={o.id} className="pm-exec-approval-row">
                            <span className={`pm-exec-side-pill is-${o.side}`}>
                                {o.side.toUpperCase()}
                            </span>
                            <span className="pm-exec-approval-ticker">{o.ticker}</span>
                            <span className="pm-exec-approval-qty num">
                                {o.quantity.toLocaleString()} {unit} @ {price ? formatUsd(price) : "—"}
                            </span>
                            <span className="pm-exec-approval-notional num">
                                {formatUsd(orderValue(o))}
                            </span>
                            <div className="pm-exec-approval-actions">
                                <button
                                    type="button"
                                    className="pm-btn pm-btn-ghost pm-exec-btn-sm"
                                    disabled={busy}
                                    onClick={() => onChangeStatus(o, "cancelled")}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    className="pm-btn pm-btn-primary pm-exec-btn-sm"
                                    disabled={busy}
                                    onClick={() => onChangeStatus(o, "ready")}
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
    accountNames,
    busyIds,
    todayEt,
    empty,
    onChangeStatus,
}: {
    orders: Order[];
    accountNames: ReadonlyMap<string, string>;
    busyIds: ReadonlySet<string>;
    todayEt: string;
    empty: string;
    onChangeStatus: (order: Order, status: OrderStatusChange) => void;
}) {
    if (orders.length === 0) {
        return (
            <div className="pm-exec-empty">
                {empty}
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
                        const price = orderDisplayPrice(o);
                        const optionSuffix = o.optionDetails
                            ? ` ${o.optionDetails.strike}${o.optionDetails.contractType === "call" ? "C" : "P"}`
                            : "";
                        const quantityUnit = o.instrumentType === "option" ? " ct" : "";
                        const busy = busyIds.has(o.id);
                        // AR-109: orders placed with a rationale render
                        // a subordinate summary row beneath the main
                        // row. Stays out of the scannable column flow
                        // but keeps the "why" one glance away.
                        return [
                            <tr key={o.id} data-order-id={o.id} data-created-at={o.createdAt} data-status={o.status}>
                                <td className="num">{formatPlanTime(o.createdAt, todayEt)}</td>
                                <td>
                                    <span className={`pm-exec-side-pill is-${o.side}`}>
                                        {o.side.toUpperCase()}
                                    </span>
                                </td>
                                <td className="pm-exec-table-ticker">
                                    {o.ticker}{optionSuffix}
                                    <span className="pm-exec-table-account">{accountNames.get(o.portfolioId) ?? ""}</span>
                                </td>
                                <td>{ORDER_TYPE_LABELS[o.type]}</td>
                                <td className="num-col num">
                                    {o.quantity.toLocaleString()}{quantityUnit}
                                </td>
                                <td className="num-col num">
                                    {price ? formatUsd(price) : "—"}
                                </td>
                                <td>
                                    <span className={`pm-exec-status ${STATUS_CLASS[o.status]}`}>
                                        {ORDER_STATUS_LABELS[o.status]}
                                    </span>
                                </td>
                                <td className="pm-exec-table-action">
                                    {o.status === "ready" && (
                                        <button
                                            type="button"
                                            className="pm-exec-place"
                                            disabled={busy}
                                            onClick={() => onChangeStatus(o, "placed")}
                                            aria-label={`Mark ${o.ticker} order placed`}
                                            title="Mark placed at your broker"
                                        >
                                            <Check className="pm-exec-cancel-icon" aria-hidden="true" />
                                        </button>
                                    )}
                                    {o.status !== "cancelled" && (
                                        <button
                                            type="button"
                                            className="pm-exec-cancel"
                                            disabled={busy}
                                            onClick={() => onChangeStatus(o, "cancelled")}
                                            aria-label={`Cancel ${o.ticker} order`}
                                            title={o.status === "placed" ? "Cancelled at your broker" : "Cancel"}
                                        >
                                            <X className="pm-exec-cancel-icon" aria-hidden="true" />
                                        </button>
                                    )}
                                </td>
                            </tr>,
                            o.rationale && (
                                <tr
                                    key={`${o.id}-rat`}
                                    className="pm-exec-table-rationale-row"
                                >
                                    <td colSpan={8}>
                                        <RationaleSummary
                                            rationale={o.rationale}
                                            compact
                                        />
                                    </td>
                                </tr>
                            ),
                        ];
                    })}
                </tbody>
            </table>
        </div>
    );
}
