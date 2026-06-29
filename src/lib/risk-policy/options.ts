export const OPTION_CONTRACT_TYPES = ["call", "put"] as const;

export type OptionContractType = (typeof OPTION_CONTRACT_TYPES)[number];
export type OptionRiskStatus = "inside" | "watch" | "breached" | "missing_data";

export interface OptionsRiskPolicy {
    watchPositionPremiumPct: number;
    maxPositionPremiumPct: number;
    maxUnderlyingPremiumPct: number;
    maxTotalPremiumPct: number;
    maxLossBudgetPct: number;
    expiryWarningDays: number;
    expiryClusterDays: number;
    expiryClusterMaxPremiumPct: number;
}

export interface OptionRiskPosition {
    id: string;
    underlying: string;
    contractType: OptionContractType;
    strike: number;
    expiry: string;
    quantity: number;
    premiumPaid: number;
    currentPremium: number;
    underlyingPrice?: number;
    contractMultiplier?: number;
    linkedThesisId?: string;
    thesisTitle?: string;
    whatMustBeTrueByExpiry?: string;
    plannedExitRule?: string;
    account?: string;
    openedAt?: string;
}

export interface OptionPolicyIssue {
    code: string;
    severity: OptionRiskStatus;
    message: string;
}

export interface OptionLedgerRow extends OptionRiskPosition {
    symbol: string;
    contractMultiplier: number;
    direction: "long" | "short";
    premiumAtRisk: number;
    currentValue: number;
    notionalEquivalent: number;
    daysToExpiry: number;
    premiumPctOfPortfolio: number;
    currentValuePctOfPortfolio: number;
    premiumPctOfLiquidNetWorth?: number;
    status: OptionRiskStatus;
    issues: OptionPolicyIssue[];
}

export interface OptionUnderlyingExposure {
    underlying: string;
    premiumAtRisk: number;
    currentValue: number;
    notionalEquivalent: number;
    percentOfPortfolio: number;
    status: OptionRiskStatus;
}

export interface OptionRiskLedgerInput {
    positions: readonly OptionRiskPosition[];
    totalPortfolioValue: number;
    liquidNetWorth?: number;
    policy?: Partial<OptionsRiskPolicy>;
    asOf?: Date | string;
}

export interface OptionRiskLedgerSummary {
    totalPortfolioValue: number;
    liquidNetWorth?: number;
    totalPremiumAtRisk: number;
    totalCurrentValue: number;
    totalNotionalEquivalent: number;
    totalPremiumPctOfPortfolio: number;
    totalCurrentValuePctOfPortfolio: number;
    totalPremiumPctOfLiquidNetWorth?: number;
    expiringPremiumAtRisk: number;
    expiringPremiumPctOfPortfolio: number;
    status: OptionRiskStatus;
    rows: OptionLedgerRow[];
    underlyingExposures: OptionUnderlyingExposure[];
    actionPrompts: string[];
    policy: OptionsRiskPolicy;
}

export interface OptionOrderPolicyInput {
    isOption: boolean;
    underlying: string;
    contractType: OptionContractType;
    strike: number;
    expiry: string;
    quantity: number;
    premium: number;
    side: "buy" | "sell";
    totalPortfolioValue: number;
    liquidNetWorth?: number;
    linkedThesisId?: string;
    maxLossAcknowledged?: boolean;
    whatMustBeTrueByExpiry?: string;
    plannedExitRule?: string;
    existingPositions?: readonly OptionRiskPosition[];
    policy?: Partial<OptionsRiskPolicy>;
    asOf?: Date | string;
}

export interface OptionOrderPolicyResult {
    status: OptionRiskStatus;
    blocksSubmit: boolean;
    premiumAtRisk: number;
    notionalEquivalent: number;
    premiumPctOfPortfolio: number;
    premiumPctOfLiquidNetWorth?: number;
    daysToExpiry: number;
    checks: OptionPolicyIssue[];
}

export const DEFAULT_OPTIONS_RISK_POLICY: OptionsRiskPolicy = {
    watchPositionPremiumPct: 1,
    maxPositionPremiumPct: 2,
    maxUnderlyingPremiumPct: 3,
    maxTotalPremiumPct: 5,
    maxLossBudgetPct: 5,
    expiryWarningDays: 90,
    expiryClusterDays: 45,
    expiryClusterMaxPremiumPct: 1,
};

export const DEFAULT_OPTION_RISK_POSITIONS: readonly OptionRiskPosition[] = [
    {
        id: "opt-aapl-2027-250c",
        underlying: "AAPL",
        contractType: "call",
        strike: 250,
        expiry: "2027-01-15",
        quantity: 3,
        premiumPaid: 18.2,
        currentPremium: 14.5,
        underlyingPrice: 182.45,
        linkedThesisId: "seed-aapl-services",
        thesisTitle: "Services margin expansion",
        whatMustBeTrueByExpiry: "AI and services growth must re-rate earnings before January 2027.",
        plannedExitRule: "Exit if premium loses 50% or roll 90 days before expiry.",
        account: "Taxable brokerage",
        openedAt: "2026-02-01",
    },
    {
        id: "opt-rivn-2027-25c",
        underlying: "RIVN",
        contractType: "call",
        strike: 25,
        expiry: "2027-01-16",
        quantity: 30,
        premiumPaid: 4.4,
        currentPremium: 1.9,
        underlyingPrice: 14.2,
        whatMustBeTrueByExpiry: "Delivery growth and gross margin need to inflect before the 2027 cycle.",
        plannedExitRule: "Close before 120 days to expiry unless thesis is re-underwritten.",
        account: "Taxable brokerage",
        openedAt: "2026-03-12",
    },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computeOptionRiskLedger(input: OptionRiskLedgerInput): OptionRiskLedgerSummary {
    const policy = normalizePolicy(input.policy);
    const totalPortfolioValue = safeMoney(input.totalPortfolioValue);
    const liquidNetWorth = input.liquidNetWorth === undefined ? undefined : safeMoney(input.liquidNetWorth);
    const asOf = startOfDay(normalizeDate(input.asOf));
    const rows = input.positions
        .map((position) => buildOptionLedgerRow(position, totalPortfolioValue, liquidNetWorth, policy, asOf))
        .sort((a, b) => a.daysToExpiry - b.daysToExpiry || b.premiumAtRisk - a.premiumAtRisk);

    const totalPremiumAtRisk = roundMoney(rows.reduce((sum, row) => sum + row.premiumAtRisk, 0));
    const totalCurrentValue = roundMoney(rows.reduce((sum, row) => sum + row.currentValue, 0));
    const totalNotionalEquivalent = roundMoney(rows.reduce((sum, row) => sum + row.notionalEquivalent, 0));
    const totalPremiumPctOfPortfolio = percentOf(totalPremiumAtRisk, totalPortfolioValue);
    const totalCurrentValuePctOfPortfolio = percentOf(totalCurrentValue, totalPortfolioValue);
    const totalPremiumPctOfLiquidNetWorth = liquidNetWorth === undefined
        ? undefined
        : percentOf(totalPremiumAtRisk, liquidNetWorth);
    const expiringPremiumAtRisk = roundMoney(
        rows
            .filter((row) => row.daysToExpiry >= 0 && row.daysToExpiry <= policy.expiryClusterDays)
            .reduce((sum, row) => sum + row.premiumAtRisk, 0),
    );
    const expiringPremiumPctOfPortfolio = percentOf(expiringPremiumAtRisk, totalPortfolioValue);
    const underlyingExposures = buildUnderlyingExposures(rows, totalPortfolioValue, policy);
    const summaryIssues = buildSummaryIssues({
        totalPremiumPctOfPortfolio,
        totalPremiumPctOfLiquidNetWorth,
        expiringPremiumPctOfPortfolio,
        policy,
    });

    const allIssues = [
        ...rows.flatMap((row) => row.issues),
        ...underlyingExposures.flatMap((row) =>
            row.status === "breached"
                ? [{
                    code: "underlying_cap",
                    severity: "breached" as const,
                    message: `${row.underlying} options exceed the per-underlying premium cap.`,
                }]
                : [],
        ),
        ...summaryIssues,
    ];
    const status = worstStatus(allIssues.map((issue) => issue.severity));
    const actionPrompts = buildActionPrompts(rows, underlyingExposures, summaryIssues);

    return {
        totalPortfolioValue,
        liquidNetWorth,
        totalPremiumAtRisk,
        totalCurrentValue,
        totalNotionalEquivalent,
        totalPremiumPctOfPortfolio,
        totalCurrentValuePctOfPortfolio,
        totalPremiumPctOfLiquidNetWorth,
        expiringPremiumAtRisk,
        expiringPremiumPctOfPortfolio,
        status,
        rows,
        underlyingExposures,
        actionPrompts,
        policy,
    };
}

export function evaluateOptionOrderPolicy(input: OptionOrderPolicyInput): OptionOrderPolicyResult {
    if (!input.isOption) {
        return {
            status: "inside",
            blocksSubmit: false,
            premiumAtRisk: 0,
            notionalEquivalent: 0,
            premiumPctOfPortfolio: 0,
            premiumPctOfLiquidNetWorth: input.liquidNetWorth === undefined ? undefined : 0,
            daysToExpiry: 0,
            checks: [],
        };
    }

    const policy = normalizePolicy(input.policy);
    const quantity = safeQuantity(input.quantity);
    const premium = safeMoney(input.premium);
    const multiplier = DEFAULT_CONTRACT_MULTIPLIER;
    const totalPortfolioValue = safeMoney(input.totalPortfolioValue);
    const liquidNetWorth = input.liquidNetWorth === undefined ? undefined : safeMoney(input.liquidNetWorth);
    const asOf = startOfDay(normalizeDate(input.asOf));
    const expiry = parseDateOnly(input.expiry);
    const expiryTime = expiry.getTime();
    const daysToExpiry = Number.isFinite(expiryTime)
        ? Math.ceil((expiryTime - asOf.getTime()) / MS_PER_DAY)
        : 0;
    const premiumAtRisk = roundMoney(quantity * multiplier * premium);
    const notionalEquivalent = roundMoney(quantity * multiplier * safeMoney(input.strike));
    const premiumPctOfPortfolio = percentOf(premiumAtRisk, totalPortfolioValue);
    const premiumPctOfLiquidNetWorth = liquidNetWorth === undefined
        ? undefined
        : percentOf(premiumAtRisk, liquidNetWorth);
    const checks: OptionPolicyIssue[] = [];

    if (quantity <= 0) {
        checks.push({
            code: "invalid_quantity",
            severity: "breached",
            message: "Option contracts must be greater than zero.",
        });
    }
    if (premium <= 0) {
        checks.push({
            code: "invalid_premium",
            severity: "breached",
            message: "Option premium must be greater than zero.",
        });
    }
    if (safeMoney(input.strike) <= 0) {
        checks.push({
            code: "invalid_strike",
            severity: "breached",
            message: "Option strike must be greater than zero.",
        });
    }
    if (!Number.isFinite(expiryTime)) {
        checks.push({
            code: "invalid_expiry",
            severity: "breached",
            message: "Option expiry must be a valid date.",
        });
    }
    if (input.side === "sell") {
        checks.push({
            code: "short_option",
            severity: "breached",
            message: "Short option orders are blocked until undefined max loss is explicitly modeled.",
        });
    }
    if (!input.linkedThesisId) {
        checks.push({
            code: "missing_thesis",
            severity: "breached",
            message: "Options require a linked thesis before submit.",
        });
    }
    if (!input.maxLossAcknowledged) {
        checks.push({
            code: "max_loss_ack",
            severity: "breached",
            message: "Acknowledge max loss before routing an option order.",
        });
    }
    if (!input.whatMustBeTrueByExpiry?.trim()) {
        checks.push({
            code: "expiry_truth",
            severity: "breached",
            message: "Define what must be true by expiry.",
        });
    }
    if (!input.plannedExitRule?.trim()) {
        checks.push({
            code: "exit_rule",
            severity: "breached",
            message: "Define the exit, roll, or expire rule.",
        });
    }
    if (daysToExpiry < 0) {
        checks.push({
            code: "expired_contract",
            severity: "breached",
            message: "Expiry is in the past.",
        });
    } else if (daysToExpiry <= policy.expiryWarningDays) {
        checks.push({
            code: "near_expiry",
            severity: "watch",
            message: `${daysToExpiry} days to expiry.`,
        });
    }
    if (premiumPctOfPortfolio > policy.maxPositionPremiumPct) {
        checks.push({
            code: "position_size_cap",
            severity: "breached",
            message: `Premium at risk is ${premiumPctOfPortfolio.toFixed(1)}% of portfolio; cap is ${policy.maxPositionPremiumPct}%.`,
        });
    } else if (premiumPctOfPortfolio >= policy.watchPositionPremiumPct) {
        checks.push({
            code: "position_size_watch",
            severity: "watch",
            message: `Premium at risk is ${premiumPctOfPortfolio.toFixed(1)}% of portfolio.`,
        });
    }

    const afterPremium = premiumAtRisk + (input.existingPositions ?? [])
        .reduce((sum, position) => sum + optionPremiumAtRisk(position), 0);
    const afterPremiumPct = percentOf(afterPremium, totalPortfolioValue);
    if (afterPremiumPct > policy.maxTotalPremiumPct) {
        checks.push({
            code: "total_options_cap",
            severity: "breached",
            message: `Total options premium would reach ${afterPremiumPct.toFixed(1)}%; cap is ${policy.maxTotalPremiumPct}%.`,
        });
    }

    const status = worstStatus(checks.map((check) => check.severity));
    return {
        status,
        blocksSubmit: checks.some((check) => check.severity === "breached"),
        premiumAtRisk,
        notionalEquivalent,
        premiumPctOfPortfolio,
        premiumPctOfLiquidNetWorth,
        daysToExpiry,
        checks,
    };
}

export function optionCurrentValue(position: OptionRiskPosition): number {
    return roundMoney(
        Math.abs(safeQuantity(position.quantity)) *
        safeMultiplier(position.contractMultiplier) *
        safeMoney(position.currentPremium),
    );
}

export function optionPremiumAtRisk(position: Pick<OptionRiskPosition, "quantity" | "premiumPaid" | "contractMultiplier">): number {
    return roundMoney(
        Math.abs(safeQuantity(position.quantity)) *
        safeMultiplier(position.contractMultiplier) *
        safeMoney(position.premiumPaid),
    );
}

function buildOptionLedgerRow(
    position: OptionRiskPosition,
    totalPortfolioValue: number,
    liquidNetWorth: number | undefined,
    policy: OptionsRiskPolicy,
    asOf: Date,
): OptionLedgerRow {
    const underlying = normalizeSymbol(position.underlying);
    const contractMultiplier = safeMultiplier(position.contractMultiplier);
    const quantity = safeQuantity(position.quantity);
    const premiumAtRisk = optionPremiumAtRisk(position);
    const currentValue = optionCurrentValue(position);
    const notionalBase = safeMoney(position.underlyingPrice ?? position.strike);
    const notionalEquivalent = roundMoney(quantity * contractMultiplier * notionalBase);
    const expiryDate = parseDateOnly(position.expiry);
    const daysToExpiry = Math.ceil((expiryDate.getTime() - asOf.getTime()) / MS_PER_DAY);
    const premiumPctOfPortfolio = percentOf(premiumAtRisk, totalPortfolioValue);
    const currentValuePctOfPortfolio = percentOf(currentValue, totalPortfolioValue);
    const premiumPctOfLiquidNetWorth = liquidNetWorth === undefined ? undefined : percentOf(premiumAtRisk, liquidNetWorth);
    const issues = buildRowIssues({
        position,
        daysToExpiry,
        premiumPctOfPortfolio,
        policy,
    });

    return {
        ...position,
        underlying,
        symbol: formatOptionSymbol(underlying, position.expiry, position.contractType, position.strike),
        contractMultiplier,
        direction: position.quantity >= 0 ? "long" : "short",
        premiumAtRisk,
        currentValue,
        notionalEquivalent,
        daysToExpiry,
        premiumPctOfPortfolio,
        currentValuePctOfPortfolio,
        premiumPctOfLiquidNetWorth,
        status: worstStatus(issues.map((issue) => issue.severity)),
        issues,
    };
}

function buildRowIssues({
    position,
    daysToExpiry,
    premiumPctOfPortfolio,
    policy,
}: {
    position: OptionRiskPosition;
    daysToExpiry: number;
    premiumPctOfPortfolio: number;
    policy: OptionsRiskPolicy;
}): OptionPolicyIssue[] {
    const issues: OptionPolicyIssue[] = [];
    if (position.quantity < 0) {
        issues.push({
            code: "short_option",
            severity: "breached",
            message: "Short option max loss is not bounded in v1.",
        });
    }
    if (daysToExpiry < 0) {
        issues.push({
            code: "expired_contract",
            severity: "breached",
            message: "Contract has expired.",
        });
    } else if (daysToExpiry <= policy.expiryWarningDays) {
        issues.push({
            code: "near_expiry",
            severity: "watch",
            message: `${daysToExpiry} days to expiry.`,
        });
    }
    if (premiumPctOfPortfolio > policy.maxPositionPremiumPct) {
        issues.push({
            code: "position_size_cap",
            severity: "breached",
            message: `Premium at risk exceeds ${policy.maxPositionPremiumPct}% cap.`,
        });
    } else if (premiumPctOfPortfolio >= policy.watchPositionPremiumPct) {
        issues.push({
            code: "position_size_watch",
            severity: "watch",
            message: `Premium at risk is above ${policy.watchPositionPremiumPct}% watch band.`,
        });
    }
    if (!position.linkedThesisId) {
        issues.push({
            code: "missing_thesis",
            severity: "missing_data",
            message: "No linked thesis.",
        });
    }
    if (!position.whatMustBeTrueByExpiry?.trim()) {
        issues.push({
            code: "expiry_truth",
            severity: "missing_data",
            message: "Missing expiry truth test.",
        });
    }
    if (!position.plannedExitRule?.trim()) {
        issues.push({
            code: "exit_rule",
            severity: "missing_data",
            message: "Missing exit, roll, or expire rule.",
        });
    }
    return issues;
}

function buildSummaryIssues({
    totalPremiumPctOfPortfolio,
    totalPremiumPctOfLiquidNetWorth,
    expiringPremiumPctOfPortfolio,
    policy,
}: {
    totalPremiumPctOfPortfolio: number;
    totalPremiumPctOfLiquidNetWorth?: number;
    expiringPremiumPctOfPortfolio: number;
    policy: OptionsRiskPolicy;
}): OptionPolicyIssue[] {
    const issues: OptionPolicyIssue[] = [];
    if (totalPremiumPctOfPortfolio > policy.maxTotalPremiumPct) {
        issues.push({
            code: "total_options_cap",
            severity: "breached",
            message: `Total options premium exceeds ${policy.maxTotalPremiumPct}% cap.`,
        });
    }
    if (
        totalPremiumPctOfLiquidNetWorth !== undefined &&
        totalPremiumPctOfLiquidNetWorth > policy.maxLossBudgetPct
    ) {
        issues.push({
            code: "loss_budget_cap",
            severity: "breached",
            message: `Options max-loss budget exceeds ${policy.maxLossBudgetPct}% of liquid net worth.`,
        });
    }
    if (expiringPremiumPctOfPortfolio > policy.expiryClusterMaxPremiumPct) {
        issues.push({
            code: "expiry_cluster",
            severity: "watch",
            message: `Near-expiry premium exceeds ${policy.expiryClusterMaxPremiumPct}% cluster band.`,
        });
    }
    return issues;
}

function buildUnderlyingExposures(
    rows: readonly OptionLedgerRow[],
    totalPortfolioValue: number,
    policy: OptionsRiskPolicy,
): OptionUnderlyingExposure[] {
    const byUnderlying = new Map<string, OptionUnderlyingExposure>();
    for (const row of rows) {
        const current = byUnderlying.get(row.underlying) ?? {
            underlying: row.underlying,
            premiumAtRisk: 0,
            currentValue: 0,
            notionalEquivalent: 0,
            percentOfPortfolio: 0,
            status: "inside" as const,
        };
        current.premiumAtRisk += row.premiumAtRisk;
        current.currentValue += row.currentValue;
        current.notionalEquivalent += row.notionalEquivalent;
        byUnderlying.set(row.underlying, current);
    }

    return [...byUnderlying.values()]
        .map((row) => {
            const percent = percentOf(row.premiumAtRisk, totalPortfolioValue);
            return {
                ...row,
                premiumAtRisk: roundMoney(row.premiumAtRisk),
                currentValue: roundMoney(row.currentValue),
                notionalEquivalent: roundMoney(row.notionalEquivalent),
                percentOfPortfolio: percent,
                status: percent > policy.maxUnderlyingPremiumPct ? "breached" as const : "inside" as const,
            };
        })
        .sort((a, b) => b.premiumAtRisk - a.premiumAtRisk);
}

function buildActionPrompts(
    rows: readonly OptionLedgerRow[],
    underlyingExposures: readonly OptionUnderlyingExposure[],
    summaryIssues: readonly OptionPolicyIssue[],
): string[] {
    const prompts: string[] = [];
    const firstBreachedRow = rows.find((row) => row.status === "breached");
    if (firstBreachedRow) {
        prompts.push(`Reduce or re-underwrite ${firstBreachedRow.symbol}; it breaches options policy.`);
    }
    const firstMissingRow = rows.find((row) => row.status === "missing_data");
    if (firstMissingRow) {
        prompts.push(`Complete thesis, expiry truth, and exit-plan metadata for ${firstMissingRow.symbol}.`);
    }
    const underlyingBreach = underlyingExposures.find((row) => row.status === "breached");
    if (underlyingBreach) {
        prompts.push(`Trim ${underlyingBreach.underlying} option premium below the per-underlying cap.`);
    }
    const summaryIssue = summaryIssues[0];
    if (summaryIssue) {
        prompts.push(summaryIssue.message);
    }
    if (prompts.length === 0 && rows.length > 0) {
        prompts.push("Keep options inside premium-at-risk and expiry policy.");
    }
    if (rows.length === 0) {
        prompts.push("No option positions are currently recorded.");
    }
    return prompts;
}

function formatOptionSymbol(
    underlying: string,
    expiry: string,
    contractType: OptionContractType,
    strike: number,
): string {
    return `${underlying} ${expiry} ${strike}${contractType === "call" ? "C" : "P"}`;
}

function normalizePolicy(policy?: Partial<OptionsRiskPolicy>): OptionsRiskPolicy {
    return {
        ...DEFAULT_OPTIONS_RISK_POLICY,
        ...policy,
        watchPositionPremiumPct: safePercent(policy?.watchPositionPremiumPct ?? DEFAULT_OPTIONS_RISK_POLICY.watchPositionPremiumPct),
        maxPositionPremiumPct: safePercent(policy?.maxPositionPremiumPct ?? DEFAULT_OPTIONS_RISK_POLICY.maxPositionPremiumPct),
        maxUnderlyingPremiumPct: safePercent(policy?.maxUnderlyingPremiumPct ?? DEFAULT_OPTIONS_RISK_POLICY.maxUnderlyingPremiumPct),
        maxTotalPremiumPct: safePercent(policy?.maxTotalPremiumPct ?? DEFAULT_OPTIONS_RISK_POLICY.maxTotalPremiumPct),
        maxLossBudgetPct: safePercent(policy?.maxLossBudgetPct ?? DEFAULT_OPTIONS_RISK_POLICY.maxLossBudgetPct),
        expiryWarningDays: safeDays(policy?.expiryWarningDays ?? DEFAULT_OPTIONS_RISK_POLICY.expiryWarningDays),
        expiryClusterDays: safeDays(policy?.expiryClusterDays ?? DEFAULT_OPTIONS_RISK_POLICY.expiryClusterDays),
        expiryClusterMaxPremiumPct: safePercent(policy?.expiryClusterMaxPremiumPct ?? DEFAULT_OPTIONS_RISK_POLICY.expiryClusterMaxPremiumPct),
    };
}

function worstStatus(statuses: readonly OptionRiskStatus[]): OptionRiskStatus {
    const rank: Record<OptionRiskStatus, number> = {
        inside: 0,
        watch: 1,
        missing_data: 2,
        breached: 3,
    };
    return statuses.reduce<OptionRiskStatus>(
        (worst, status) => rank[status] > rank[worst] ? status : worst,
        "inside",
    );
}

function normalizeSymbol(value: string): string {
    return value.trim().toUpperCase();
}

const DEFAULT_CONTRACT_MULTIPLIER = 100;

function safeMultiplier(value: number | undefined): number {
    return Number.isFinite(value) && value && value > 0 ? value : DEFAULT_CONTRACT_MULTIPLIER;
}

function safeQuantity(value: number): number {
    return Number.isFinite(value) ? Math.abs(value) : 0;
}

function safeMoney(value: number): number {
    return roundMoney(Number.isFinite(value) ? Math.max(0, value) : 0);
}

function safePercent(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function safeDays(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

function percentOf(value: number, total: number): number {
    return total > 0 ? (value / total) * 100 : 0;
}

function normalizeDate(value?: Date | string): Date {
    if (value instanceof Date) return value;
    if (typeof value === "string" && value.trim()) return parseDateOnly(value);
    return new Date();
}

function parseDateOnly(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function startOfDay(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
