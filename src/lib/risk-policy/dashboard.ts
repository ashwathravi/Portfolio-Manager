import {
    DEFAULT_BUCKET_POLICIES,
    type PolicyBucketAllocationRow,
    type PolicyBucketId,
    type PolicyBucketPolicy,
    type PolicyBucketStatus,
    computeBucketAllocation,
} from "./buckets";
import {
    type CashDeploymentRule,
    type CashJob,
    type CashPolicySummary,
    computeCashPolicySummary,
} from "./cash";
import { computeChurnAnalysis } from "./churn";
import {
    computeEmployerStockDeRisking,
    type EmployerStockDeRiskingPlan,
    type EmployerStockDeRiskingSummary,
} from "./de-risking";
import {
    type OptionRiskLedgerSummary,
    type OptionRiskPosition,
    type OptionsRiskPolicy,
    computeOptionRiskLedger,
    optionCurrentValue,
} from "./options";
import {
    evaluateSellDiscipline,
    type SellDisciplineRule,
    type SellDisciplineTask,
    type SellDisciplineThesis,
} from "./sell-discipline";
import {
    runBuiltInStressScenarios,
    type StressScenarioResult,
} from "./stress";
import {
    DEFAULT_THEME_CAPS,
    type ThemeExposureRow,
    type ThemeId,
    type ThemeWeight,
    computeThemeExposure,
} from "./themes";

export const RISK_POLICY_DIMENSION_IDS = [
    "single_name_concentration",
    "top_3_concentration",
    "top_5_concentration",
    "employer_stock_concentration",
    "ai_infrastructure_exposure",
    "mega_cap_growth_exposure",
    "semiconductor_exposure",
    "speculative_options_exposure",
    "special_situation_exposure",
    "cash_purpose_coverage",
    "churn_activity",
    "missing_policy_metadata",
] as const;

export type RiskPolicyDimensionId = (typeof RISK_POLICY_DIMENSION_IDS)[number];
export type RiskPolicyDimensionStatus = PolicyBucketStatus;

export interface RiskPolicyDashboardHolding {
    id?: string;
    symbol?: string | null;
    name?: string | null;
    marketValue: number;
    quantity?: number;
    avgCost?: number;
    currentPrice?: number;
    isEmployerStock?: boolean;
    policyBucket?: PolicyBucketId | null;
    instrumentType?: string | null;
    themeWeights?: readonly ThemeWeight[] | null;
}

export interface RiskPolicyDashboardTrade {
    id?: string;
    date: string | Date;
    type: "buy" | "sell" | "dividend" | "deposit" | "withdrawal" | string;
    ticker?: string | null;
    symbol?: string | null;
    amount?: number | null;
}

export interface RiskPolicyDashboardOptions {
    singleNameMaxPct?: number;
    top3MaxPct?: number;
    top5MaxPct?: number;
    employerStockMaxPct?: number;
    churnWindowDays?: number;
    churnWatchRepeatSymbols?: number;
    churnBreachRepeatSymbols?: number;
}

export interface RiskPolicyDashboardInput {
    holdings: readonly RiskPolicyDashboardHolding[];
    cashTotal?: number;
    trades?: readonly RiskPolicyDashboardTrade[];
    asOf?: Date;
    bucketPolicies?: readonly PolicyBucketPolicy[];
    themeCaps?: Readonly<Partial<Record<ThemeId, number>>>;
    cashJobs?: readonly CashJob[];
    cashDeploymentRule?: CashDeploymentRule | null;
    employerStockPlan?: EmployerStockDeRiskingPlan | null;
    optionPositions?: readonly OptionRiskPosition[];
    optionsRiskPolicy?: Partial<OptionsRiskPolicy>;
    sellDisciplineRules?: readonly SellDisciplineRule[];
    theses?: readonly SellDisciplineThesis[];
    options?: RiskPolicyDashboardOptions;
}

export interface RiskPolicyDimension {
    id: RiskPolicyDimensionId;
    label: string;
    group: "concentration" | "theme" | "bucket" | "data" | "behavior";
    status: RiskPolicyDimensionStatus;
    currentPct?: number;
    currentValueUsd?: number;
    currentLabel?: string;
    targetLabel: string;
    explanation: string;
    nextAction: string;
    href: string;
    impactedSymbols: string[];
    overLimitPct: number;
    overLimitUsd: number;
}

export interface RiskPolicyNextAction {
    id: RiskPolicyDimensionId;
    label: string;
    detail: string;
    href: string;
    status: RiskPolicyDimensionStatus;
}

export interface RiskPolicyDashboardSummary {
    totalMarketValue: number;
    overallStatus: RiskPolicyDimensionStatus;
    statusCounts: Record<RiskPolicyDimensionStatus, number>;
    dimensions: RiskPolicyDimension[];
    nextActions: RiskPolicyNextAction[];
    employerStockPlan: EmployerStockDeRiskingSummary;
    stressTests: StressScenarioResult[];
    sellDisciplineTasks: SellDisciplineTask[];
}

const DEFAULT_OPTIONS: Required<RiskPolicyDashboardOptions> = {
    singleNameMaxPct: 25,
    top3MaxPct: 60,
    top5MaxPct: 75,
    employerStockMaxPct: 25,
    churnWindowDays: 90,
    churnWatchRepeatSymbols: 1,
    churnBreachRepeatSymbols: 3,
};

const STATUS_RANK: Record<RiskPolicyDimensionStatus, number> = {
    inside: 0,
    watch: 1,
    missing_data: 2,
    breached: 3,
};

export function computeRiskPolicyDashboard(
    input: RiskPolicyDashboardInput,
): RiskPolicyDashboardSummary {
    const options = { ...DEFAULT_OPTIONS, ...input.options };
    const holdings = normalizeHoldings(input.holdings);
    const cashTotal = safePositive(input.cashTotal ?? 0);
    const optionPositions = input.optionPositions ?? [];
    const optionHoldings = optionPositions
        .map((position) => ({
            id: position.id,
            symbol: position.underlying,
            name: formatOptionName(position),
            marketValue: optionCurrentValue(position),
            policyBucket: "speculative" as const,
            instrumentType: `${position.contractType} option`,
        }))
        .filter((holding) => holding.marketValue > 0);
    const cashHolding = cashTotal > 0
        ? [{
            id: "cash-reserve",
            symbol: "USD",
            name: "Cash reserve",
            marketValue: cashTotal,
            policyBucket: "cash_reserve" as const,
            themeWeights: [{
                theme: "bonds_treasuries_cash_equivalent" as const,
                weight: 1,
                source: "fallback" as const,
            }],
        }]
        : [];
    const policyHoldings = [...holdings, ...optionHoldings, ...cashHolding];
    const totalMarketValue = policyHoldings.reduce((sum, holding) => sum + holding.marketValue, 0);
    const sortedHoldings = [...holdings].sort((a, b) => b.marketValue - a.marketValue);
    const optionsLedger = computeOptionRiskLedger({
        positions: optionPositions,
        totalPortfolioValue: totalMarketValue,
        liquidNetWorth: totalMarketValue,
        policy: input.optionsRiskPolicy,
        asOf: input.asOf,
    });
    const bucketAllocation = computeBucketAllocation(
        policyHoldings,
        input.bucketPolicies ?? DEFAULT_BUCKET_POLICIES,
    );
    const themeExposure = computeThemeExposure(
        policyHoldings,
        input.themeCaps ?? DEFAULT_THEME_CAPS,
    );
    const cashPolicy = computeCashPolicySummary({
        totalCash: cashTotal,
        jobs: input.cashJobs ? [...input.cashJobs] : [],
        deploymentRule: input.cashDeploymentRule,
        asOf: input.asOf,
    });
    const sellDiscipline = evaluateSellDiscipline({
        rules: input.sellDisciplineRules ?? [],
        holdings,
        theses: input.theses,
        portfolioValue: totalMarketValue,
        asOf: input.asOf,
    });
    const employerStockPlan = computeEmployerStockDeRisking({
        holdings,
        portfolioValue: totalMarketValue,
        plan: input.employerStockPlan,
        asOf: input.asOf,
    });
    const stressTests = runBuiltInStressScenarios({
        holdings: policyHoldings,
        cashTotal: cashTotal,
    });

    const dimensions: RiskPolicyDimension[] = [
        buildConcentrationDimension({
            id: "single_name_concentration",
            label: "Single-name concentration",
            holdings: sortedHoldings.slice(0, 1),
            totalMarketValue,
            maxPct: options.singleNameMaxPct,
            explanation: "Largest individual position as a share of connected portfolio value.",
            nextAction: "Review the largest holding and set a trim threshold.",
            href: "/portfolios/holdings",
        }),
        buildConcentrationDimension({
            id: "top_3_concentration",
            label: "Top 3 concentration",
            holdings: sortedHoldings.slice(0, 3),
            totalMarketValue,
            maxPct: options.top3MaxPct,
            explanation: "Share of the portfolio controlled by the three largest names.",
            nextAction: "Review whether the top holdings still match the policy target.",
            href: "/portfolios/holdings",
        }),
        buildConcentrationDimension({
            id: "top_5_concentration",
            label: "Top 5 concentration",
            holdings: sortedHoldings.slice(0, 5),
            totalMarketValue,
            maxPct: options.top5MaxPct,
            explanation: "Share of the portfolio controlled by the five largest names.",
            nextAction: "Check whether new buys would add to already-dominant names.",
            href: "/portfolios/holdings",
        }),
        buildConcentrationDimension({
            id: "employer_stock_concentration",
            label: "GOOG / employer-linked stock",
            holdings: holdings.filter((holding) => isGoogleSymbol(holding.symbol)),
            totalMarketValue,
            maxPct: options.employerStockMaxPct,
            explanation: "GOOG and GOOGL are separated from generic concentration because portfolio and income risk can overlap.",
            nextAction: "Set an employer-stock target and review trim pacing.",
            href: "/portfolios/holdings",
        }),
        buildThemeDimension({
            id: "ai_infrastructure_exposure",
            row: requireThemeRow(themeExposure.rows, "ai_infrastructure"),
            targetFallback: DEFAULT_THEME_CAPS.ai_infrastructure,
            explanation: "Weighted exposure to AI compute, cloud capex, memory, and data-center infrastructure.",
            nextAction: "Review AI-exposed holdings before adding more risk.",
            href: "/portfolios/holdings?theme=ai_infrastructure",
        }),
        buildThemeDimension({
            id: "mega_cap_growth_exposure",
            row: requireThemeRow(themeExposure.rows, "mega_cap_growth"),
            targetFallback: DEFAULT_THEME_CAPS.mega_cap_growth,
            explanation: "Weighted exposure to large platform growth names with shared duration and liquidity sensitivity.",
            nextAction: "Compare mega-cap exposure against core index exposure.",
            href: "/portfolios/holdings?theme=mega_cap_growth",
        }),
        buildThemeDimension({
            id: "semiconductor_exposure",
            row: requireThemeRow(themeExposure.rows, "semiconductors"),
            targetFallback: DEFAULT_THEME_CAPS.semiconductors,
            explanation: "Weighted chip, foundry, memory, and semiconductor supply-chain exposure.",
            nextAction: "Check whether semis are still a satellite bet or have become the portfolio.",
            href: "/portfolios/holdings?theme=semiconductors",
        }),
        buildSpeculativeOptionsDimension({
            id: "speculative_options_exposure",
            row: requireBucketRow(bucketAllocation.rows, "speculative"),
            optionsLedger,
            targetFallback: 5,
            explanation: "Speculative/options bucket, including option-like instruments and high-beta risk-on positions.",
            nextAction: "Confirm max loss and written thesis before adding to this bucket.",
            href: "/execution",
        }),
        buildBucketDimension({
            id: "special_situation_exposure",
            row: requireBucketRow(bucketAllocation.rows, "special_situation"),
            targetFallback: 3,
            explanation: "Political, regulatory, legal, or event-driven special situations such as FNMA/FMCC.",
            nextAction: "Re-underwrite special situations separately from normal equity compounders.",
            href: "/research",
        }),
        buildCashPurposeDimension(cashPolicy, totalMarketValue),
        buildChurnDimension(input.trades ?? [], input.asOf, options),
        buildMissingMetadataDimension(
            bucketAllocation.unassignedMarketValue,
            bucketAllocation.unassignedCount,
            themeExposure.unknownMarketValue,
            themeExposure.unknownCount,
            totalMarketValue,
        ),
    ];

    const statusCounts = countStatuses(dimensions);
    const overallStatus = dimensions.reduce<RiskPolicyDimensionStatus>(
        (worst, dimension) =>
            STATUS_RANK[dimension.status] > STATUS_RANK[worst] ? dimension.status : worst,
        "inside",
    );

    return {
        totalMarketValue,
        overallStatus,
        statusCounts,
        dimensions,
        nextActions: buildNextActions(dimensions),
        employerStockPlan,
        stressTests,
        sellDisciplineTasks: sellDiscipline.tasks,
    };
}

function buildConcentrationDimension({
    id,
    label,
    holdings,
    totalMarketValue,
    maxPct,
    explanation,
    nextAction,
    href,
}: {
    id: RiskPolicyDimensionId;
    label: string;
    holdings: readonly NormalizedRiskHolding[];
    totalMarketValue: number;
    maxPct: number;
    explanation: string;
    nextAction: string;
    href: string;
}): RiskPolicyDimension {
    const currentValueUsd = holdings.reduce((sum, holding) => sum + holding.marketValue, 0);
    const currentPct = percentOf(currentValueUsd, totalMarketValue);
    const status = holdings.length === 0 || totalMarketValue <= 0
        ? "missing_data"
        : classifyMaxPct(currentPct, maxPct);
    const overLimitPct = Math.max(0, currentPct - maxPct);

    return {
        id,
        label,
        group: "concentration",
        status,
        currentPct,
        currentValueUsd,
        targetLabel: `<= ${maxPct}%`,
        explanation,
        nextAction: status === "inside" ? "Keep monitoring before adding risk." : nextAction,
        href,
        impactedSymbols: holdings.map((holding) => holding.symbol),
        overLimitPct,
        overLimitUsd: Math.max(0, currentValueUsd - (maxPct / 100) * totalMarketValue),
    };
}

function buildThemeDimension({
    id,
    row,
    targetFallback,
    explanation,
    nextAction,
    href,
}: {
    id: RiskPolicyDimensionId;
    row: ThemeExposureRow;
    targetFallback?: number;
    explanation: string;
    nextAction: string;
    href: string;
}): RiskPolicyDimension {
    const maxPct = row.maxPct ?? targetFallback;
    const overLimitPct = maxPct == null ? 0 : Math.max(0, row.percentOfPortfolio - maxPct);

    return {
        id,
        label: row.label,
        group: "theme",
        status: row.status,
        currentPct: row.percentOfPortfolio,
        currentValueUsd: row.marketValue,
        targetLabel: maxPct == null ? "Monitor" : `<= ${maxPct}%`,
        explanation,
        nextAction: row.status === "inside" ? "Keep monitoring theme overlap." : nextAction,
        href,
        impactedSymbols: row.contributors.slice(0, 4).map((contributor) => contributor.symbol),
        overLimitPct,
        overLimitUsd: maxPct == null
            ? 0
            : Math.max(0, row.marketValue - (maxPct / 100) * rowPercentBase(row)),
    };
}

function buildBucketDimension({
    id,
    row,
    targetFallback,
    explanation,
    nextAction,
    href,
}: {
    id: RiskPolicyDimensionId;
    row: PolicyBucketAllocationRow;
    targetFallback?: number;
    explanation: string;
    nextAction: string;
    href: string;
}): RiskPolicyDimension {
    const maxPct = row.maxPct ?? targetFallback;

    return {
        id,
        label: row.label,
        group: "bucket",
        status: row.status,
        currentPct: row.percentOfPortfolio,
        currentValueUsd: row.marketValue,
        targetLabel: maxPct == null ? "Monitor" : `<= ${maxPct}%`,
        explanation,
        nextAction: row.status === "inside" ? "Keep bucket within policy before new buys." : nextAction,
        href,
        impactedSymbols: row.contributors.slice(0, 4).map((contributor) => contributor.symbol),
        overLimitPct: row.overCapPct,
        overLimitUsd: row.overCapValue,
    };
}

function buildSpeculativeOptionsDimension({
    id,
    row,
    optionsLedger,
    targetFallback,
    explanation,
    nextAction,
    href,
}: {
    id: RiskPolicyDimensionId;
    row: PolicyBucketAllocationRow;
    optionsLedger: OptionRiskLedgerSummary;
    targetFallback?: number;
    explanation: string;
    nextAction: string;
    href: string;
}): RiskPolicyDimension {
    const base = buildBucketDimension({
        id,
        row,
        targetFallback,
        explanation: optionsLedger.rows.length > 0
            ? `${explanation} Options premium at risk is ${formatCurrency(optionsLedger.totalPremiumAtRisk)}.`
            : explanation,
        nextAction,
        href,
    });

    if (optionsLedger.rows.length === 0) {
        return base;
    }

    const status = STATUS_RANK[optionsLedger.status] > STATUS_RANK[base.status]
        ? optionsLedger.status
        : base.status;
    const breachedPremium = optionsLedger.rows
        .filter((row) => row.status === "breached")
        .reduce((sum, row) => sum + row.premiumAtRisk, 0);

    return {
        ...base,
        status,
        currentLabel: `${row.percentOfPortfolio.toFixed(1)}% bucket / ${optionsLedger.totalPremiumPctOfPortfolio.toFixed(1)}% premium`,
        nextAction: status === "inside"
            ? "Keep option premium and expiry plans inside policy."
            : optionsLedger.actionPrompts[0] ?? nextAction,
        impactedSymbols: [
            ...new Set([
                ...base.impactedSymbols,
                ...optionsLedger.rows.slice(0, 4).map((option) => option.underlying),
            ]),
        ],
        overLimitUsd: Math.max(base.overLimitUsd, breachedPremium),
    };
}

function buildCashPurposeDimension(
    cashPolicy: CashPolicySummary,
    totalMarketValue: number,
): RiskPolicyDimension {
    const currentPct = percentOf(cashPolicy.totalCash, totalMarketValue);
    const hasCash = cashPolicy.totalCash > 0;
    const nextAction = cashPolicy.actionPrompts[0]
        ?? (hasCash ? "Cash jobs are current." : "No cash balance is currently recorded.");
    const overLimitUsd = cashPolicy.status === "breached"
        ? cashPolicy.overAllocatedCash
        : cashPolicy.unassignedCash;

    return {
        id: "cash_purpose_coverage",
        label: "Cash purpose coverage",
        group: "data",
        status: cashPolicy.status,
        currentPct,
        currentValueUsd: cashPolicy.totalCash,
        currentLabel: hasCash ? `${Math.round(cashPolicy.assignedPct)}% assigned` : "No cash balance",
        targetLabel: "0 unassigned / schedule current",
        explanation: `Cash should be labeled as emergency reserve, tax/family need, scheduled deployment, or dry powder. Reserved: ${formatCurrency(cashPolicy.reservedCash)}. Excess: ${formatCurrency(cashPolicy.excessCash)}.`,
        nextAction,
        href: "/settings",
        impactedSymbols: hasCash ? ["USD"] : [],
        overLimitPct: 0,
        overLimitUsd,
    };
}

function buildChurnDimension(
    trades: readonly RiskPolicyDashboardTrade[],
    asOf: Date | undefined,
    options: Required<RiskPolicyDashboardOptions>,
): RiskPolicyDimension {
    const churn = computeChurnAnalysis(trades, {
        asOf,
        windowDays: options.churnWindowDays,
        watchRepeatSymbols: options.churnWatchRepeatSymbols,
        breachRepeatSymbols: options.churnBreachRepeatSymbols,
    });
    const status = churn.status;

    return {
        id: "churn_activity",
        label: "Repeated trading activity",
        group: "behavior",
        status,
        currentValueUsd: churn.repeatTurnoverUsd,
        currentLabel: churn.totalTrades > 0
            ? `${churn.repeatSymbolCount} repeated ${churn.repeatSymbolCount === 1 ? "name" : "names"} / ${options.churnWindowDays}d`
            : "No trade history connected",
        targetLabel: `< ${options.churnBreachRepeatSymbols} repeated names / ${options.churnWindowDays}d`,
        explanation: "Repeated buys and sells in the same names create decision fatigue, tax friction, and thesis drift.",
        nextAction: status === "inside"
            ? "Keep trade notes attached to active ideas."
            : churn.actionPrompts[0] ?? "Review repeated names before placing the next trade.",
        href: "/#weekly-review",
        impactedSymbols: churn.repeatSymbols,
        overLimitPct: 0,
        overLimitUsd: 0,
    };
}

function buildMissingMetadataDimension(
    unassignedMarketValue: number,
    unassignedCount: number,
    unknownThemeMarketValue: number,
    unknownThemeCount: number,
    totalMarketValue: number,
): RiskPolicyDimension {
    const currentValueUsd = Math.max(unassignedMarketValue, unknownThemeMarketValue);
    const currentCount = Math.max(unassignedCount, unknownThemeCount);
    const currentPct = percentOf(currentValueUsd, totalMarketValue);

    return {
        id: "missing_policy_metadata",
        label: "Missing policy metadata",
        group: "data",
        status: currentCount > 0 ? "missing_data" : "inside",
        currentPct,
        currentValueUsd,
        currentLabel: `${currentCount} ${currentCount === 1 ? "holding" : "holdings"}`,
        targetLabel: "0 unassigned holdings",
        explanation: "Unclassified holdings and unknown themes are treated as policy work, not as safe diversification.",
        nextAction: currentCount > 0 ? "Classify missing bucket and theme metadata." : "All visible holdings have policy metadata.",
        href: "/portfolios/holdings",
        impactedSymbols: [],
        overLimitPct: currentPct,
        overLimitUsd: currentValueUsd,
    };
}

function buildNextActions(
    dimensions: readonly RiskPolicyDimension[],
): RiskPolicyNextAction[] {
    return dimensions
        .filter((dimension) => dimension.status !== "inside")
        .sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status])
        .slice(0, 5)
        .map((dimension) => ({
            id: dimension.id,
            label: dimension.nextAction,
            detail: dimension.label,
            href: dimension.href,
            status: dimension.status,
        }));
}

function countStatuses(
    dimensions: readonly RiskPolicyDimension[],
): Record<RiskPolicyDimensionStatus, number> {
    return dimensions.reduce<Record<RiskPolicyDimensionStatus, number>>(
        (counts, dimension) => {
            counts[dimension.status] += 1;
            return counts;
        },
        { inside: 0, watch: 0, breached: 0, missing_data: 0 },
    );
}

function classifyMaxPct(currentPct: number, maxPct: number): RiskPolicyDimensionStatus {
    if (currentPct > maxPct) return "breached";
    if (maxPct > 0 && currentPct >= maxPct * 0.9) return "watch";
    return "inside";
}

function requireBucketRow(
    rows: readonly PolicyBucketAllocationRow[],
    bucket: PolicyBucketId,
): PolicyBucketAllocationRow {
    const row = rows.find((candidate) => candidate.bucket === bucket);
    if (!row) throw new Error(`Missing policy bucket row: ${bucket}`);
    return row;
}

function requireThemeRow(
    rows: readonly ThemeExposureRow[],
    theme: ThemeId,
): ThemeExposureRow {
    const row = rows.find((candidate) => candidate.theme === theme);
    if (!row) throw new Error(`Missing theme exposure row: ${theme}`);
    return row;
}

function rowPercentBase(row: ThemeExposureRow): number {
    if (row.percentOfPortfolio <= 0) return row.marketValue;
    return row.marketValue / (row.percentOfPortfolio / 100);
}

interface NormalizedRiskHolding {
    id?: string;
    symbol: string;
    name?: string;
    marketValue: number;
    quantity?: number;
    avgCost?: number;
    currentPrice?: number;
    isEmployerStock?: boolean;
    policyBucket?: PolicyBucketId | null;
    instrumentType?: string | null;
    themeWeights?: readonly ThemeWeight[] | null;
}

function normalizeHoldings(
    holdings: readonly RiskPolicyDashboardHolding[],
): NormalizedRiskHolding[] {
    return holdings
        .map((holding) => ({
            id: holding.id,
            symbol: normalizeSymbol(holding.symbol),
            name: holding.name ?? undefined,
            marketValue: safePositive(holding.marketValue),
            quantity: safePositive(holding.quantity ?? 0),
            avgCost: safePositive(holding.avgCost ?? 0),
            currentPrice: safePositive(holding.currentPrice ?? 0),
            isEmployerStock: holding.isEmployerStock ?? isGoogleSymbol(holding.symbol),
            policyBucket: holding.policyBucket,
            instrumentType: holding.instrumentType,
            themeWeights: holding.themeWeights,
        }))
        .filter((holding) => holding.marketValue > 0);
}

function normalizeSymbol(symbol: string | null | undefined): string {
    return symbol?.trim().toUpperCase() ?? "";
}

function isGoogleSymbol(symbol: string | null | undefined): boolean {
    const normalized = normalizeSymbol(symbol);
    return normalized === "GOOG" || normalized === "GOOGL";
}

function formatOptionName(position: OptionRiskPosition): string {
    return `${normalizeSymbol(position.underlying)} ${position.expiry} ${position.strike}${position.contractType === "call" ? "C" : "P"}`;
}

function percentOf(value: number, total: number): number {
    return total > 0 ? (safePositive(value) / total) * 100 : 0;
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(value);
}

function safePositive(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}
