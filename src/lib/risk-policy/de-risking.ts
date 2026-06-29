import type { PolicyBucketId } from "./buckets";

export const EMPLOYER_STOCK_PLAN_STATES = ["draft", "active", "paused", "completed"] as const;
export type EmployerStockPlanState = (typeof EMPLOYER_STOCK_PLAN_STATES)[number];

export const EMPLOYER_STOCK_TRIM_METHODS = ["fixed_amount", "fixed_percent", "vest_driven"] as const;
export type EmployerStockTrimMethod = (typeof EMPLOYER_STOCK_TRIM_METHODS)[number];

export const EMPLOYER_STOCK_TRIM_CADENCES = ["monthly", "quarterly"] as const;
export type EmployerStockTrimCadence = (typeof EMPLOYER_STOCK_TRIM_CADENCES)[number];

export const EMPLOYER_STOCK_VEST_ACTIONS = ["sell_all", "sell_half", "hold"] as const;
export type EmployerStockVestAction = (typeof EMPLOYER_STOCK_VEST_ACTIONS)[number];

export interface EmployerStockDeRiskingPlan {
    id: string;
    label: string;
    symbols: string[];
    state: EmployerStockPlanState;
    targetAllocationPct: number;
    intermediateTargetPct: number;
    trimCadence: EmployerStockTrimCadence;
    trimMethod: EmployerStockTrimMethod;
    trimAmountUsd: number;
    trimPercentOfPosition: number;
    defaultVestAction: EmployerStockVestAction;
    plannedVestValueUsd: number;
    nextActionDate?: string;
    nextVestDate?: string;
    destination: PolicyBucketId | "core_index" | "cash_reserve" | "custom";
    destinationLabel: string;
    taxReservePct: number;
    maxTaxImpactUsd?: number;
    accountLocation?: "taxable" | "retirement" | "mixed" | "unknown";
}

export interface EmployerStockHolding {
    id?: string;
    symbol?: string | null;
    name?: string | null;
    marketValue: number;
    quantity?: number;
    currentPrice?: number;
}

export interface EmployerStockTrimSlice {
    symbol: string;
    sellUsd: number;
    shares: number;
}

export interface EmployerStockTrimStep {
    sequence: number;
    dueDate: string;
    sellUsd: number;
    estimatedTaxReserveUsd: number;
    destinationLabel: string;
    projectedAllocationPct: number;
    slices: EmployerStockTrimSlice[];
}

export interface EmployerStockNextAction {
    dueDate: string;
    overdue: boolean;
    label: string;
    detail: string;
    sellUsd: number;
    estimatedTaxReserveUsd: number;
    href: string;
}

export interface EmployerStockDeRiskingSummary {
    plan: EmployerStockDeRiskingPlan;
    status: "inside" | "watch" | "breached" | "missing_data";
    currentValueUsd: number;
    currentAllocationPct: number;
    targetValueUsd: number;
    intermediateTargetValueUsd: number;
    breachUsd: number;
    breachPct: number;
    sellToTargetUsd: number;
    sellToIntermediateUsd: number;
    sharesToSellToTarget: number;
    sharesToSellToIntermediate: number;
    projectedTargetAllocationPct: number;
    projectedIntermediateAllocationPct: number;
    schedule: EmployerStockTrimStep[];
    nextAction?: EmployerStockNextAction;
    missingSymbols: string[];
    disclaimer: string;
}

export interface ComputeEmployerStockDeRiskingInput {
    holdings: readonly EmployerStockHolding[];
    portfolioValue: number;
    plan?: EmployerStockDeRiskingPlan | null;
    asOf?: Date | string;
}

export const DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN: EmployerStockDeRiskingPlan = {
    id: "goog-derisk-v1",
    label: "GOOG employer stock de-risking",
    symbols: ["GOOG", "GOOGL"],
    state: "draft",
    targetAllocationPct: 20,
    intermediateTargetPct: 25,
    trimCadence: "monthly",
    trimMethod: "fixed_amount",
    trimAmountUsd: 25_000,
    trimPercentOfPosition: 5,
    defaultVestAction: "sell_all",
    plannedVestValueUsd: 0,
    destination: "core_index",
    destinationLabel: "Broad core index",
    taxReservePct: 0,
    accountLocation: "unknown",
};

const DISCLAIMER =
    "Planning output only. It does not execute trades and is not personalized tax or financial advice.";

export function computeEmployerStockDeRisking(
    input: ComputeEmployerStockDeRiskingInput,
): EmployerStockDeRiskingSummary {
    const plan = normalizePlan(input.plan);
    const asOf = normalizeDate(input.asOf);
    const portfolioValue = safeMoney(input.portfolioValue);
    const targetSymbols = new Set(plan.symbols.map(normalizeSymbol).filter(Boolean));
    const matched = input.holdings
        .map((holding) => ({
            ...holding,
            symbol: normalizeSymbol(holding.symbol),
            marketValue: safeMoney(holding.marketValue),
            quantity: safeNumber(holding.quantity),
            currentPrice: safeNumber(holding.currentPrice),
        }))
        .filter((holding) => holding.symbol && targetSymbols.has(holding.symbol) && holding.marketValue > 0);

    const currentValueUsd = roundMoney(matched.reduce((sum, holding) => sum + holding.marketValue, 0));
    const currentAllocationPct = percentOf(currentValueUsd, portfolioValue);
    const targetPct = clampPct(plan.targetAllocationPct);
    const intermediatePct = Math.max(targetPct, clampPct(plan.intermediateTargetPct));
    const targetValueUsd = roundMoney(portfolioValue * (targetPct / 100));
    const intermediateTargetValueUsd = roundMoney(portfolioValue * (intermediatePct / 100));
    const sellToTargetUsd = roundMoney(Math.max(0, currentValueUsd - targetValueUsd));
    const sellToIntermediateUsd = roundMoney(Math.max(0, currentValueUsd - intermediateTargetValueUsd));
    const breachPct = Math.max(0, currentAllocationPct - targetPct);
    const breachUsd = sellToTargetUsd;

    const status = classifyPlanStatus({
        plan,
        portfolioValue,
        currentValueUsd,
        currentAllocationPct,
        targetPct,
        sellToTargetUsd,
    });
    const scheduleTargetUsd = sellToIntermediateUsd > 0 ? sellToIntermediateUsd : sellToTargetUsd;
    const schedule = buildTrimSchedule({
        holdings: matched,
        plan,
        sellTargetUsd: scheduleTargetUsd,
        portfolioValue,
        currentValueUsd,
        asOf,
    });
    const nextAction = buildNextAction({
        plan,
        status,
        schedule,
        asOf,
        currentAllocationPct,
        targetPct,
    });

    return {
        plan,
        status,
        currentValueUsd,
        currentAllocationPct,
        targetValueUsd,
        intermediateTargetValueUsd,
        breachUsd,
        breachPct,
        sellToTargetUsd,
        sellToIntermediateUsd,
        sharesToSellToTarget: estimateSharesForSale(matched, sellToTargetUsd),
        sharesToSellToIntermediate: estimateSharesForSale(matched, sellToIntermediateUsd),
        projectedTargetAllocationPct: percentOf(Math.max(0, currentValueUsd - sellToTargetUsd), portfolioValue),
        projectedIntermediateAllocationPct: percentOf(
            Math.max(0, currentValueUsd - sellToIntermediateUsd),
            portfolioValue,
        ),
        schedule,
        nextAction,
        missingSymbols: matched.length === 0 ? [...targetSymbols] : [],
        disclaimer: DISCLAIMER,
    };
}

export function computeTrimAmountToTarget({
    currentValueUsd,
    portfolioValue,
    targetAllocationPct,
}: {
    currentValueUsd: number;
    portfolioValue: number;
    targetAllocationPct: number;
}): {
    targetValueUsd: number;
    sellUsd: number;
    currentAllocationPct: number;
    breachPct: number;
} {
    const safePortfolioValue = safeMoney(portfolioValue);
    const safeCurrentValue = safeMoney(currentValueUsd);
    const targetPct = clampPct(targetAllocationPct);
    const targetValueUsd = roundMoney(safePortfolioValue * (targetPct / 100));
    const sellUsd = roundMoney(Math.max(0, safeCurrentValue - targetValueUsd));
    const currentAllocationPct = percentOf(safeCurrentValue, safePortfolioValue);

    return {
        targetValueUsd,
        sellUsd,
        currentAllocationPct,
        breachPct: Math.max(0, currentAllocationPct - targetPct),
    };
}

function normalizePlan(plan?: EmployerStockDeRiskingPlan | null): EmployerStockDeRiskingPlan {
    const merged = {
        ...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN,
        ...(plan ?? {}),
    };
    const symbols = (merged.symbols?.length ? merged.symbols : DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN.symbols)
        .map(normalizeSymbol)
        .filter(Boolean);

    return {
        ...merged,
        symbols: symbols.length > 0 ? [...new Set(symbols)] : [...DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN.symbols],
        state: EMPLOYER_STOCK_PLAN_STATES.includes(merged.state)
            ? merged.state
            : DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN.state,
        targetAllocationPct: clampPct(merged.targetAllocationPct),
        intermediateTargetPct: clampPct(merged.intermediateTargetPct),
        trimCadence: merged.trimCadence === "quarterly" ? "quarterly" : "monthly",
        trimMethod: EMPLOYER_STOCK_TRIM_METHODS.includes(merged.trimMethod)
            ? merged.trimMethod
            : DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN.trimMethod,
        trimAmountUsd: safeMoney(merged.trimAmountUsd),
        trimPercentOfPosition: clampPct(merged.trimPercentOfPosition),
        defaultVestAction: EMPLOYER_STOCK_VEST_ACTIONS.includes(merged.defaultVestAction)
            ? merged.defaultVestAction
            : DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN.defaultVestAction,
        plannedVestValueUsd: safeMoney(merged.plannedVestValueUsd),
        destinationLabel: merged.destinationLabel?.trim() || DEFAULT_EMPLOYER_STOCK_DERISKING_PLAN.destinationLabel,
        taxReservePct: clampPct(merged.taxReservePct),
        maxTaxImpactUsd: merged.maxTaxImpactUsd == null ? undefined : safeMoney(merged.maxTaxImpactUsd),
    };
}

function classifyPlanStatus({
    plan,
    portfolioValue,
    currentValueUsd,
    currentAllocationPct,
    targetPct,
    sellToTargetUsd,
}: {
    plan: EmployerStockDeRiskingPlan;
    portfolioValue: number;
    currentValueUsd: number;
    currentAllocationPct: number;
    targetPct: number;
    sellToTargetUsd: number;
}): EmployerStockDeRiskingSummary["status"] {
    if (portfolioValue <= 0 || currentValueUsd <= 0) return "missing_data";
    if (plan.state === "paused") return "watch";
    if (plan.state === "completed" && sellToTargetUsd > 0) return "watch";
    if (sellToTargetUsd > 0) return "breached";
    if (currentAllocationPct >= targetPct * 0.9) return "watch";
    return "inside";
}

function buildTrimSchedule({
    holdings,
    plan,
    sellTargetUsd,
    portfolioValue,
    currentValueUsd,
    asOf,
}: {
    holdings: readonly EmployerStockHolding[];
    plan: EmployerStockDeRiskingPlan;
    sellTargetUsd: number;
    portfolioValue: number;
    currentValueUsd: number;
    asOf: Date;
}): EmployerStockTrimStep[] {
    if (sellTargetUsd <= 0 || plan.state === "completed") return [];

    const stepAmount = computeStepAmount(plan, currentValueUsd, sellTargetUsd);
    if (stepAmount <= 0) return [];

    const startDate = parseDateOnly(plan.nextActionDate ?? plan.nextVestDate) ?? asOf;
    const steps: EmployerStockTrimStep[] = [];
    let remaining = sellTargetUsd;
    let cumulativeSold = 0;

    for (let i = 0; i < 12 && remaining > 0.01; i += 1) {
        const sellUsd = roundMoney(Math.min(remaining, stepAmount));
        cumulativeSold = roundMoney(cumulativeSold + sellUsd);
        remaining = roundMoney(remaining - sellUsd);
        steps.push({
            sequence: i + 1,
            dueDate: addCadence(startDate, plan.trimCadence, i).toISOString().slice(0, 10),
            sellUsd,
            estimatedTaxReserveUsd: roundMoney(sellUsd * (plan.taxReservePct / 100)),
            destinationLabel: plan.destinationLabel,
            projectedAllocationPct: percentOf(Math.max(0, currentValueUsd - cumulativeSold), portfolioValue),
            slices: allocateSaleAcrossHoldings(holdings, sellUsd),
        });
    }

    return steps;
}

function computeStepAmount(
    plan: EmployerStockDeRiskingPlan,
    currentValueUsd: number,
    sellTargetUsd: number,
): number {
    if (plan.trimMethod === "fixed_percent") {
        return roundMoney(currentValueUsd * (plan.trimPercentOfPosition / 100));
    }
    if (plan.trimMethod === "vest_driven") {
        const vestSellPct = plan.defaultVestAction === "sell_all"
            ? 1
            : plan.defaultVestAction === "sell_half"
                ? 0.5
                : 0;
        return roundMoney(plan.plannedVestValueUsd * vestSellPct);
    }
    return roundMoney(Math.min(sellTargetUsd, plan.trimAmountUsd));
}

function buildNextAction({
    plan,
    status,
    schedule,
    asOf,
    currentAllocationPct,
    targetPct,
}: {
    plan: EmployerStockDeRiskingPlan;
    status: EmployerStockDeRiskingSummary["status"];
    schedule: readonly EmployerStockTrimStep[];
    asOf: Date;
    currentAllocationPct: number;
    targetPct: number;
}): EmployerStockNextAction | undefined {
    if (plan.state !== "active") return undefined;
    const first = schedule[0];
    const explicitDue = parseDateOnly(plan.nextActionDate);
    const dueDate = first?.dueDate ?? explicitDue?.toISOString().slice(0, 10);
    if (!dueDate) return undefined;
    const overdue = parseDateOnly(dueDate)!.getTime() <= startOfDay(asOf).getTime();

    if (!first) {
        return {
            dueDate,
            overdue,
            label: "Review GOOG de-risking plan",
            detail: status === "inside"
                ? `Target reached at ${currentAllocationPct.toFixed(1)}% vs ${targetPct}% cap. Decide whether to keep, pause, or complete the plan.`
                : "Plan is active but needs current holdings or trim assumptions before a schedule can be generated.",
            sellUsd: 0,
            estimatedTaxReserveUsd: 0,
            href: "/settings",
        };
    }

    return {
        dueDate: first.dueDate,
        overdue,
        label: overdue ? "GOOG trim due" : "Next GOOG trim",
        detail: `${formatCurrency(first.sellUsd)} to ${first.destinationLabel}; projected allocation ${first.projectedAllocationPct.toFixed(1)}%.`,
        sellUsd: first.sellUsd,
        estimatedTaxReserveUsd: first.estimatedTaxReserveUsd,
        href: "/settings",
    };
}

function allocateSaleAcrossHoldings(
    holdings: readonly EmployerStockHolding[],
    sellUsd: number,
): EmployerStockTrimSlice[] {
    const currentValue = holdings.reduce((sum, holding) => sum + safeMoney(holding.marketValue), 0);
    if (currentValue <= 0 || sellUsd <= 0) return [];

    return holdings
        .map((holding) => {
            const marketValue = safeMoney(holding.marketValue);
            const symbol = normalizeSymbol(holding.symbol) || "UNKNOWN";
            const sellForHolding = roundMoney(sellUsd * (marketValue / currentValue));
            return {
                symbol,
                sellUsd: sellForHolding,
                shares: estimateShares(holding, sellForHolding),
            };
        })
        .filter((slice) => slice.sellUsd > 0)
        .sort((a, b) => b.sellUsd - a.sellUsd);
}

function estimateSharesForSale(holdings: readonly EmployerStockHolding[], sellUsd: number): number {
    return roundShares(
        allocateSaleAcrossHoldings(holdings, sellUsd).reduce((sum, slice) => sum + slice.shares, 0),
    );
}

function estimateShares(holding: EmployerStockHolding, sellUsd: number): number {
    const price = safeNumber(holding.currentPrice);
    if (price > 0) return roundShares(sellUsd / price);
    const marketValue = safeMoney(holding.marketValue);
    const quantity = safeNumber(holding.quantity);
    if (marketValue > 0 && quantity > 0) return roundShares(quantity * (sellUsd / marketValue));
    return 0;
}

function addCadence(start: Date, cadence: EmployerStockTrimCadence, offset: number): Date {
    return new Date(Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth() + (cadence === "quarterly" ? offset * 3 : offset),
        start.getUTCDate(),
    ));
}

function normalizeDate(value?: Date | string): Date {
    if (value instanceof Date) return value;
    const parsed = parseDateOnly(value);
    return parsed ?? new Date();
}

function parseDateOnly(value?: string): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function startOfDay(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function normalizeSymbol(symbol: string | null | undefined): string {
    return symbol?.trim().toUpperCase() ?? "";
}

function safeMoney(value: number | undefined): number {
    return roundMoney(Number.isFinite(value) ? Math.max(0, value ?? 0) : 0);
}

function safeNumber(value: number | undefined): number {
    return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function clampPct(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
}

function percentOf(value: number, total: number): number {
    return total > 0 ? (value / total) * 100 : 0;
}

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

function roundShares(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(value);
}
