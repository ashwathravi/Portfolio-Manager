export const SELL_DISCIPLINE_TRIGGER_TYPES = [
    "allocation_cap",
    "employer_vest",
    "position_doubled",
    "thesis_break",
    "drawdown_reunderwrite",
    "stale_thesis",
    "target_price",
    "target_allocation",
    "missing_thesis_no_add",
] as const;

export type SellDisciplineTriggerType = (typeof SELL_DISCIPLINE_TRIGGER_TYPES)[number];
export type SellDisciplineAction = "trim" | "recover_cost" | "re_underwrite" | "exit" | "no_add" | "review";
export type SellDisciplineRuleState = "active" | "triggered" | "snoozed" | "resolved";

export interface SellDisciplineAuditEvent {
    id: string;
    type: "triggered" | "snoozed" | "resolved" | "reactivated";
    reason: string;
    createdAt: string;
}

export interface SellDisciplineRule {
    id: string;
    type: SellDisciplineTriggerType;
    label: string;
    action: SellDisciplineAction;
    state: SellDisciplineRuleState;
    symbol?: string;
    thesisId?: string;
    thresholdPct?: number;
    targetPrice?: number;
    targetAllocationPct?: number;
    vestDate?: string;
    noAdd?: boolean;
    snoozedUntil?: string;
    resolvedAt?: string;
    stateReason?: string;
    lastTriggeredAt?: string;
    auditTrail?: SellDisciplineAuditEvent[];
}

export interface SellDisciplineHolding {
    id?: string;
    symbol?: string | null;
    name?: string | null;
    marketValue: number;
    quantity?: number;
    avgCost?: number;
    currentPrice?: number;
    allocationPct?: number;
    isEmployerStock?: boolean;
}

export interface SellDisciplineThesis {
    id: string;
    ticker: string;
    status?: "active" | "monitoring" | "archived" | string;
    targetPrice?: number;
    currentPrice?: number;
    dateUpdated?: string;
    healthScore?: number;
}

export interface SellDisciplineInput {
    rules: readonly SellDisciplineRule[];
    holdings: readonly SellDisciplineHolding[];
    theses?: readonly SellDisciplineThesis[];
    portfolioValue?: number;
    asOf?: Date | string;
    defaultThesisMaxAgeDays?: number;
}

export interface SellDisciplineTask {
    ruleId: string;
    ruleType: SellDisciplineTriggerType;
    label: string;
    action: SellDisciplineAction;
    state: SellDisciplineRuleState;
    symbol?: string;
    thesisId?: string;
    message: string;
    currentValue?: number;
    thresholdValue?: number;
    currentPct?: number;
    thresholdPct?: number;
    firedAt: string;
    noAdd: boolean;
    href: string;
    reason?: string;
}

export interface SellDisciplineSummary {
    activeRules: number;
    triggeredCount: number;
    snoozedCount: number;
    resolvedCount: number;
    tasks: SellDisciplineTask[];
}

const DEFAULT_THESIS_MAX_AGE_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const SELL_DISCIPLINE_ACTION_LABELS: Record<SellDisciplineAction, string> = {
    trim: "Trim",
    recover_cost: "Recover cost",
    re_underwrite: "Re-underwrite",
    exit: "Exit",
    no_add: "No add",
    review: "Review",
};

export const SELL_DISCIPLINE_TRIGGER_LABELS: Record<SellDisciplineTriggerType, string> = {
    allocation_cap: "Allocation cap",
    employer_vest: "Employer vest",
    position_doubled: "Position doubled",
    thesis_break: "Thesis break",
    drawdown_reunderwrite: "Drawdown re-underwrite",
    stale_thesis: "Stale thesis",
    target_price: "Target price",
    target_allocation: "Target allocation",
    missing_thesis_no_add: "Missing thesis no-add",
};

export const DEFAULT_SELL_DISCIPLINE_RULES: readonly SellDisciplineRule[] = [
    {
        id: "sell-goog-employer-cap",
        type: "allocation_cap",
        label: "GOOG employer-stock trim band",
        action: "trim",
        state: "active",
        symbol: "GOOG",
        thresholdPct: 25,
        noAdd: true,
    },
    {
        id: "sell-thesis-stale",
        type: "stale_thesis",
        label: "Review stale active theses",
        action: "re_underwrite",
        state: "active",
        thresholdPct: DEFAULT_THESIS_MAX_AGE_DAYS,
        noAdd: true,
    },
];

export function evaluateSellDiscipline(input: SellDisciplineInput): SellDisciplineSummary {
    const asOf = normalizeDate(input.asOf);
    const holdings = input.holdings.map(normalizeHolding);
    const theses = input.theses ?? [];
    const portfolioValue = safeMoney(
        input.portfolioValue ?? holdings.reduce((sum, holding) => sum + holding.marketValue, 0),
    );
    const tasks: SellDisciplineTask[] = [];
    let activeRules = 0;
    let snoozedCount = 0;
    let resolvedCount = 0;

    for (const rule of input.rules) {
        if (rule.state === "resolved") {
            resolvedCount += 1;
            continue;
        }
        if (isSnoozed(rule, asOf)) {
            snoozedCount += 1;
            continue;
        }
        activeRules += 1;
        const task = evaluateRule({
            rule,
            holdings,
            theses,
            portfolioValue,
            asOf,
            defaultThesisMaxAgeDays: input.defaultThesisMaxAgeDays ?? DEFAULT_THESIS_MAX_AGE_DAYS,
        });
        if (task) tasks.push(task);
    }

    return {
        activeRules,
        triggeredCount: tasks.length,
        snoozedCount,
        resolvedCount,
        tasks: tasks.sort((a, b) => taskRank(a) - taskRank(b)),
    };
}

export function snoozeSellDisciplineRule(
    rule: SellDisciplineRule,
    reason: string,
    snoozedUntil: Date | string,
    at: Date | string = new Date(),
): SellDisciplineRule {
    const capturedAt = normalizeDate(at).toISOString();
    return {
        ...rule,
        state: "snoozed",
        snoozedUntil: normalizeDate(snoozedUntil).toISOString(),
        stateReason: reason.trim(),
        auditTrail: appendAudit(rule, "snoozed", reason, capturedAt),
    };
}

export function resolveSellDisciplineRule(
    rule: SellDisciplineRule,
    reason: string,
    at: Date | string = new Date(),
): SellDisciplineRule {
    const capturedAt = normalizeDate(at).toISOString();
    return {
        ...rule,
        state: "resolved",
        resolvedAt: capturedAt,
        stateReason: reason.trim(),
        auditTrail: appendAudit(rule, "resolved", reason, capturedAt),
    };
}

export function reactivateSellDisciplineRule(
    rule: SellDisciplineRule,
    reason: string,
    at: Date | string = new Date(),
): SellDisciplineRule {
    const capturedAt = normalizeDate(at).toISOString();
    return {
        ...rule,
        state: "active",
        snoozedUntil: undefined,
        resolvedAt: undefined,
        stateReason: reason.trim(),
        auditTrail: appendAudit(rule, "reactivated", reason, capturedAt),
    };
}

export function sellDisciplineBlocksAdd(
    tasks: readonly SellDisciplineTask[],
    symbol: string,
): SellDisciplineTask | undefined {
    const normalized = normalizeSymbol(symbol);
    return tasks.find((task) => task.noAdd && normalizeSymbol(task.symbol) === normalized);
}

function evaluateRule({
    rule,
    holdings,
    theses,
    portfolioValue,
    asOf,
    defaultThesisMaxAgeDays,
}: {
    rule: SellDisciplineRule;
    holdings: NormalizedSellHolding[];
    theses: readonly SellDisciplineThesis[];
    portfolioValue: number;
    asOf: Date;
    defaultThesisMaxAgeDays: number;
}): SellDisciplineTask | null {
    const holding = findHolding(holdings, rule.symbol);
    const thesis = findThesis(theses, rule, holding?.symbol);
    const thresholdPct = safePercent(rule.thresholdPct);
    const targetPrice = safeMoney(rule.targetPrice ?? thesis?.targetPrice);
    const firedAt = asOf.toISOString();

    switch (rule.type) {
        case "allocation_cap": {
            if (!holding || thresholdPct <= 0) return null;
            const currentPct = percentOf(holding.marketValue, portfolioValue);
            if (currentPct <= thresholdPct) return null;
            return task(rule, {
                symbol: holding.symbol,
                thesisId: thesis?.id,
                message: `${holding.symbol} is ${fmtPct(currentPct)} of portfolio; policy cap is ${fmtPct(thresholdPct)}.`,
                currentValue: holding.marketValue,
                thresholdValue: valueFromPct(thresholdPct, portfolioValue),
                currentPct,
                thresholdPct,
                firedAt,
                href: "/portfolios/holdings",
            });
        }
        case "target_allocation": {
            if (!holding || safePercent(rule.targetAllocationPct) <= 0) return null;
            const targetPct = safePercent(rule.targetAllocationPct);
            const currentPct = percentOf(holding.marketValue, portfolioValue);
            if (currentPct <= targetPct) return null;
            return task(rule, {
                symbol: holding.symbol,
                thesisId: thesis?.id,
                message: `${holding.symbol} is above its ${fmtPct(targetPct)} target allocation.`,
                currentValue: holding.marketValue,
                thresholdValue: valueFromPct(targetPct, portfolioValue),
                currentPct,
                thresholdPct: targetPct,
                firedAt,
                href: "/portfolios/holdings",
            });
        }
        case "employer_vest": {
            if (!rule.vestDate) return null;
            const vestDate = normalizeDate(rule.vestDate);
            if (vestDate.getTime() > asOf.getTime()) return null;
            const symbol = normalizeSymbol(rule.symbol) || "GOOG";
            return task(rule, {
                symbol,
                thesisId: thesis?.id,
                message: `${symbol} vest date ${formatDate(vestDate)} is due; decide sell/hold before new exposure accumulates.`,
                firedAt,
                href: "/execution",
            });
        }
        case "position_doubled": {
            if (!holding || holding.costBasis <= 0 || holding.marketValue < holding.costBasis * 2) return null;
            return task(rule, {
                symbol: holding.symbol,
                thesisId: thesis?.id,
                message: `${holding.symbol} is above 2x cost basis; recover cost or document why size remains intentional.`,
                currentValue: holding.marketValue,
                thresholdValue: holding.costBasis * 2,
                firedAt,
                href: "/portfolios/holdings",
            });
        }
        case "drawdown_reunderwrite": {
            if (!holding || holding.costBasis <= 0 || thresholdPct <= 0) return null;
            const drawdownPct = ((holding.marketValue - holding.costBasis) / holding.costBasis) * 100;
            if (drawdownPct > -thresholdPct) return null;
            return task(rule, {
                symbol: holding.symbol,
                thesisId: thesis?.id,
                message: `${holding.symbol} is down ${fmtPct(Math.abs(drawdownPct))} from cost; re-underwrite before adding or averaging down.`,
                currentValue: holding.marketValue,
                thresholdPct,
                currentPct: drawdownPct,
                firedAt,
                href: thesis ? `/research/thesis/${holding.symbol.toLowerCase()}` : "/research",
            });
        }
        case "stale_thesis": {
            const maxAgeDays = thresholdPct > 0 ? thresholdPct : defaultThesisMaxAgeDays;
            const scopedThesis = rule.symbol || rule.thesisId
                ? thesis
                : theses.find((candidate) =>
                    candidate.status !== "archived" &&
                    Boolean(candidate.dateUpdated) &&
                    daysBetween(candidate.dateUpdated!, asOf) > maxAgeDays
                );
            if (!scopedThesis?.dateUpdated) return null;
            const ageDays = daysBetween(scopedThesis.dateUpdated, asOf);
            if (ageDays <= maxAgeDays) return null;
            return task(rule, {
                symbol: normalizeSymbol(scopedThesis.ticker),
                thesisId: scopedThesis.id,
                message: `${normalizeSymbol(scopedThesis.ticker)} thesis is ${ageDays} days old; policy asks for review inside ${maxAgeDays} days.`,
                currentValue: ageDays,
                thresholdValue: maxAgeDays,
                firedAt,
                href: `/research/thesis/${normalizeSymbol(scopedThesis.ticker).toLowerCase()}`,
            });
        }
        case "target_price": {
            if (!holding || targetPrice <= 0 || holding.currentPrice <= 0 || holding.currentPrice < targetPrice) return null;
            return task(rule, {
                symbol: holding.symbol,
                thesisId: thesis?.id,
                message: `${holding.symbol} trades at ${formatUsd(holding.currentPrice)}, above target ${formatUsd(targetPrice)}.`,
                currentValue: holding.currentPrice,
                thresholdValue: targetPrice,
                firedAt,
                href: thesis ? `/research/thesis/${holding.symbol.toLowerCase()}` : "/research",
            });
        }
        case "thesis_break": {
            if (!thesis) return null;
            const broken = thesis.status === "archived" || safePercent(100 - (thesis.healthScore ?? 100)) >= thresholdPct;
            if (!broken) return null;
            return task(rule, {
                symbol: normalizeSymbol(thesis.ticker),
                thesisId: thesis.id,
                message: thesis.status === "archived"
                    ? `${normalizeSymbol(thesis.ticker)} thesis is archived; exit or document the replacement thesis.`
                    : `${normalizeSymbol(thesis.ticker)} thesis health has fallen below policy threshold.`,
                currentValue: thesis.healthScore,
                thresholdValue: Math.max(0, 100 - thresholdPct),
                firedAt,
                href: `/research/thesis/${normalizeSymbol(thesis.ticker).toLowerCase()}`,
            });
        }
        case "missing_thesis_no_add": {
            if (!holding) return null;
            if (thesis && thesis.status !== "archived") return null;
            return task(rule, {
                symbol: holding.symbol,
                thesisId: thesis?.id,
                message: `${holding.symbol} has no active written thesis; policy says no new adds until one exists.`,
                currentValue: holding.marketValue,
                currentPct: percentOf(holding.marketValue, portfolioValue),
                firedAt,
                href: "/research",
            });
        }
    }
}

function task(
    rule: SellDisciplineRule,
    details: Omit<SellDisciplineTask, "ruleId" | "ruleType" | "label" | "action" | "state" | "noAdd">,
): SellDisciplineTask {
    return {
        ruleId: rule.id,
        ruleType: rule.type,
        label: rule.label,
        action: rule.action,
        state: "triggered",
        noAdd: rule.noAdd === true || rule.action === "no_add",
        ...details,
    };
}

interface NormalizedSellHolding extends SellDisciplineHolding {
    symbol: string;
    marketValue: number;
    quantity: number;
    avgCost: number;
    currentPrice: number;
    costBasis: number;
}

function normalizeHolding(holding: SellDisciplineHolding): NormalizedSellHolding {
    const quantity = safePositive(holding.quantity);
    const avgCost = safeMoney(holding.avgCost);
    const currentPrice = safeMoney(holding.currentPrice);
    const marketValue = safeMoney(holding.marketValue || quantity * currentPrice);
    return {
        ...holding,
        symbol: normalizeSymbol(holding.symbol),
        quantity,
        avgCost,
        currentPrice,
        marketValue,
        costBasis: quantity > 0 && avgCost > 0 ? quantity * avgCost : 0,
    };
}

function findHolding(
    holdings: readonly NormalizedSellHolding[],
    symbol: string | undefined,
): NormalizedSellHolding | undefined {
    const normalized = normalizeSymbol(symbol);
    if (normalized) return holdings.find((holding) => holding.symbol === normalized);
    return holdings.find((holding) => holding.isEmployerStock) ?? holdings[0];
}

function findThesis(
    theses: readonly SellDisciplineThesis[],
    rule: SellDisciplineRule,
    fallbackSymbol?: string,
): SellDisciplineThesis | undefined {
    if (rule.thesisId) return theses.find((thesis) => thesis.id === rule.thesisId);
    const symbol = normalizeSymbol(rule.symbol ?? fallbackSymbol);
    return theses.find((thesis) => normalizeSymbol(thesis.ticker) === symbol);
}

function isSnoozed(rule: SellDisciplineRule, asOf: Date): boolean {
    if (rule.state !== "snoozed") return false;
    if (!rule.snoozedUntil) return false;
    return normalizeDate(rule.snoozedUntil).getTime() > asOf.getTime();
}

function appendAudit(
    rule: SellDisciplineRule,
    type: SellDisciplineAuditEvent["type"],
    reason: string,
    createdAt: string,
): SellDisciplineAuditEvent[] {
    return [
        ...(rule.auditTrail ?? []),
        {
            id: `${rule.id}-${type}-${createdAt}`,
            type,
            reason: reason.trim(),
            createdAt,
        },
    ];
}

function taskRank(task: SellDisciplineTask): number {
    if (task.noAdd) return 0;
    if (task.action === "exit") return 1;
    if (task.action === "trim") return 2;
    return 3;
}

function daysBetween(value: string, asOf: Date): number {
    return Math.max(0, Math.floor((asOf.getTime() - normalizeDate(value).getTime()) / MS_PER_DAY));
}

function normalizeDate(value?: Date | string): Date {
    if (value instanceof Date) return value;
    if (typeof value === "string" && value.trim()) {
        return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
    }
    return new Date();
}

function normalizeSymbol(value: string | null | undefined): string {
    return value?.trim().toUpperCase() ?? "";
}

function percentOf(value: number, total: number): number {
    return total > 0 ? (safeMoney(value) / safeMoney(total)) * 100 : 0;
}

function valueFromPct(pct: number, total: number): number {
    return (safePercent(pct) / 100) * safeMoney(total);
}

function safePositive(value: number | undefined): number {
    return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

function safeMoney(value: number | undefined): number {
    return Number.isFinite(value) ? Math.max(0, Math.round((value as number) * 100) / 100) : 0;
}

function safePercent(value: number | undefined): number {
    return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

function fmtPct(value: number): string {
    if (!Number.isFinite(value)) return "0%";
    return `${value.toFixed(Math.abs(value) < 10 ? 1 : 0)}%`;
}

function formatUsd(value: number): string {
    return value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
    });
}

function formatDate(value: Date): string {
    return value.toISOString().slice(0, 10);
}
