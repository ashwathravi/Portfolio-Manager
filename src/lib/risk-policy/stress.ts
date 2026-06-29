import {
    type PolicyBucketId,
    resolvePolicyBucketAssignment,
} from "./buckets";
import {
    DEFAULT_THEME_CAPS,
    type ThemeId,
    computeThemeExposure,
    themeWeightsForSymbol,
} from "./themes";
import { sectorFor, type Sector } from "@/lib/holdings/sector";

export type StressTargetKind = "ticker" | "theme" | "bucket" | "sector" | "portfolio";

export interface StressScenarioTarget {
    kind: StressTargetKind;
    value?: string;
    shockPct: number;
    label?: string;
}

export interface StressScenario {
    id: string;
    label: string;
    description: string;
    targets: StressScenarioTarget[];
    assumption: string;
    mitigationHref?: string;
}

export interface StressHolding {
    id?: string;
    symbol?: string | null;
    name?: string | null;
    marketValue: number;
    policyBucket?: PolicyBucketId | null;
    themeWeights?: ReturnType<typeof themeWeightsForSymbol> | null;
    sector?: Sector | string | null;
}

export interface StressContributor {
    symbol: string;
    name?: string;
    startingValueUsd: number;
    impactUsd: number;
    impactPctOfPortfolio: number;
    effectiveShockPct: number;
    matchedTargets: string[];
}

export interface StressPolicyBreach {
    label: string;
    value: string;
    href: string;
}

export interface StressScenarioResult {
    scenarioId: string;
    label: string;
    description: string;
    assumption: string;
    totalPortfolioValueUsd: number;
    totalImpactUsd: number;
    portfolioImpactPct: number;
    projectedPortfolioValueUsd: number;
    contributors: StressContributor[];
    policyBreaches: StressPolicyBreach[];
    missingDataNotes: string[];
    mitigationHref?: string;
}

export interface StressScenarioInput {
    holdings: readonly StressHolding[];
    cashTotal?: number;
    scenario: StressScenario;
}

export const BUILT_IN_STRESS_SCENARIOS: readonly StressScenario[] = [
    {
        id: "goog_40_down",
        label: "GOOG -40%",
        description: "Single-employer concentration drawdown.",
        targets: [
            { kind: "ticker", value: "GOOG", shockPct: -40, label: "GOOG" },
            { kind: "ticker", value: "GOOGL", shockPct: -40, label: "GOOGL" },
        ],
        assumption: "GOOG/GOOGL are shocked down 40%; other holdings are unchanged.",
        mitigationHref: "/settings",
    },
    {
        id: "employer_job_risk",
        label: "Employer stock + job-risk placeholder",
        description: "GOOG drawdown plus income-risk flag.",
        targets: [
            { kind: "ticker", value: "GOOG", shockPct: -35, label: "GOOG" },
            { kind: "ticker", value: "GOOGL", shockPct: -35, label: "GOOGL" },
        ],
        assumption: "Applies a 35% employer-stock shock and labels job/income risk qualitatively; salary impact is not modeled.",
        mitigationHref: "/settings",
    },
    {
        id: "ai_basket_30_down",
        label: "AI basket -30%",
        description: "Weighted AI infrastructure drawdown.",
        targets: [{ kind: "theme", value: "ai_infrastructure", shockPct: -30 }],
        assumption: "Each holding is shocked by its weighted AI infrastructure exposure.",
        mitigationHref: "/portfolios/holdings?theme=ai_infrastructure",
    },
    {
        id: "semis_35_down",
        label: "Semiconductors -35%",
        description: "Chip, foundry, memory, and semiconductor supply-chain drawdown.",
        targets: [{ kind: "theme", value: "semiconductors", shockPct: -35 }],
        assumption: "Each holding is shocked by its weighted semiconductor exposure.",
        mitigationHref: "/portfolios/holdings?theme=semiconductors",
    },
    {
        id: "mega_cap_underperform_20",
        label: "Mega-cap tech -20%",
        description: "Mega-cap growth underperforms the broad market by 20%.",
        targets: [{ kind: "theme", value: "mega_cap_growth", shockPct: -20 }],
        assumption: "Only the mega-cap growth factor sleeve is shocked down 20%.",
        mitigationHref: "/portfolios/holdings?theme=mega_cap_growth",
    },
    {
        id: "crypto_liquidity_50_down",
        label: "Crypto/risk-on -50%",
        description: "Liquidity-sensitive crypto and high-beta risk-on exposure.",
        targets: [{ kind: "theme", value: "crypto_risk_on_liquidity", shockPct: -50 }],
        assumption: "Crypto/risk-on liquidity exposure is shocked down 50%.",
        mitigationHref: "/portfolios/holdings?theme=crypto_risk_on_liquidity",
    },
    {
        id: "broad_market_20_tech_beta",
        label: "Broad market -20% + tech beta",
        description: "Broad drawdown with added AI, semi, and mega-cap beta.",
        targets: [
            { kind: "portfolio", shockPct: -20, label: "Whole portfolio" },
            { kind: "theme", value: "ai_infrastructure", shockPct: -8 },
            { kind: "theme", value: "semiconductors", shockPct: -10 },
            { kind: "theme", value: "mega_cap_growth", shockPct: -6 },
        ],
        assumption: "All non-cash holdings get a -20% broad-market shock, with extra weighted tech-factor shocks.",
        mitigationHref: "/portfolios/holdings",
    },
    {
        id: "cash_deploy_now_vs_monthly",
        label: "Cash deployed now vs monthly",
        description: "Timing-risk haircut for deploying cash all at once.",
        targets: [{ kind: "bucket", value: "cash_reserve", shockPct: -10 }],
        assumption: "Cash reserves receive a deterministic 10% timing-risk haircut to compare lump-sum vs scheduled deployment.",
        mitigationHref: "/settings",
    },
];

export function findStressScenario(id: string | undefined): StressScenario {
    return BUILT_IN_STRESS_SCENARIOS.find((scenario) => scenario.id === id)
        ?? BUILT_IN_STRESS_SCENARIOS[0];
}

export function runBuiltInStressScenarios(
    input: Omit<StressScenarioInput, "scenario">,
): StressScenarioResult[] {
    return BUILT_IN_STRESS_SCENARIOS.map((scenario) =>
        runStressScenario({ ...input, scenario }),
    );
}

export function runStressScenario(input: StressScenarioInput): StressScenarioResult {
    const holdings = normalizeHoldings(input.holdings, input.cashTotal);
    const totalPortfolioValueUsd = roundMoney(
        holdings.reduce((sum, holding) => sum + holding.marketValue, 0),
    );
    const contributorDrafts = holdings.map((holding) =>
        stressHolding(holding, input.scenario, totalPortfolioValueUsd),
    );
    const contributors = contributorDrafts
        .filter((contributor) => contributor.impactUsd !== 0)
        .sort((a, b) => Math.abs(b.impactUsd) - Math.abs(a.impactUsd));
    const totalImpactUsd = roundMoney(contributors.reduce((sum, contributor) => sum + contributor.impactUsd, 0));
    const projectedPortfolioValueUsd = roundMoney(totalPortfolioValueUsd + totalImpactUsd);
    const missingDataNotes = buildMissingDataNotes(input.scenario, holdings, contributors);

    return {
        scenarioId: input.scenario.id,
        label: input.scenario.label,
        description: input.scenario.description,
        assumption: input.scenario.assumption,
        totalPortfolioValueUsd,
        totalImpactUsd,
        portfolioImpactPct: totalPortfolioValueUsd > 0 ? (totalImpactUsd / totalPortfolioValueUsd) * 100 : 0,
        projectedPortfolioValueUsd,
        contributors,
        policyBreaches: buildPostScenarioBreaches(holdings, contributorDrafts, projectedPortfolioValueUsd),
        missingDataNotes,
        mitigationHref: input.scenario.mitigationHref,
    };
}

export function buildCustomStressScenario({
    id = "custom",
    label = "Custom scenario",
    kind,
    value,
    shockPct,
}: {
    id?: string;
    label?: string;
    kind: StressTargetKind;
    value?: string;
    shockPct: number;
}): StressScenario {
    return {
        id,
        label,
        description: `${kind} shock at ${shockPct}%`,
        targets: [{ kind, value, shockPct }],
        assumption: `Custom deterministic ${kind} shock at ${shockPct}%.`,
        mitigationHref: "/portfolios/holdings",
    };
}

interface NormalizedStressHolding extends StressHolding {
    symbol: string;
    marketValue: number;
    policyBucket: PolicyBucketId;
    sector: Sector | string;
}

function normalizeHoldings(
    holdings: readonly StressHolding[],
    cashTotal: number | undefined,
): NormalizedStressHolding[] {
    const normalized = holdings
        .map((holding) => {
            const symbol = normalizeSymbol(holding.symbol);
            const marketValue = safeMoney(holding.marketValue);
            if (!symbol || marketValue <= 0) return null;
            return {
                ...holding,
                symbol,
                marketValue,
                policyBucket: resolvePolicyBucketAssignment(holding).bucket,
                sector: holding.sector ?? sectorFor(symbol),
            };
        })
        .filter((holding): holding is NormalizedStressHolding => holding != null);

    const cash = safeMoney(cashTotal);
    if (cash > 0 && !normalized.some((holding) => holding.symbol === "USD")) {
        normalized.push({
            id: "cash-reserve",
            symbol: "USD",
            name: "Cash reserve",
            marketValue: cash,
            policyBucket: "cash_reserve",
            sector: "Bonds",
        });
    }

    return normalized;
}

function stressHolding(
    holding: NormalizedStressHolding,
    scenario: StressScenario,
    totalPortfolioValueUsd: number,
): StressContributor {
    let effectiveShockPct = 0;
    const matchedTargets: string[] = [];

    for (const target of scenario.targets) {
        const contribution = targetShockForHolding(holding, target);
        if (contribution === 0) continue;
        effectiveShockPct += contribution;
        matchedTargets.push(target.label ?? target.value ?? target.kind);
    }

    effectiveShockPct = Math.max(-100, Math.min(100, effectiveShockPct));
    const impactUsd = roundMoney(holding.marketValue * (effectiveShockPct / 100));

    return {
        symbol: holding.symbol,
        name: holding.name ?? undefined,
        startingValueUsd: holding.marketValue,
        impactUsd,
        impactPctOfPortfolio: totalPortfolioValueUsd > 0 ? (impactUsd / totalPortfolioValueUsd) * 100 : 0,
        effectiveShockPct,
        matchedTargets,
    };
}

function targetShockForHolding(
    holding: NormalizedStressHolding,
    target: StressScenarioTarget,
): number {
    if (target.kind === "portfolio") {
        return holding.policyBucket === "cash_reserve" ? 0 : target.shockPct;
    }
    if (target.kind === "ticker") {
        return normalizeSymbol(target.value) === holding.symbol ? target.shockPct : 0;
    }
    if (target.kind === "bucket") {
        return target.value === holding.policyBucket ? target.shockPct : 0;
    }
    if (target.kind === "sector") {
        return normalizeSymbol(target.value) === normalizeSymbol(String(holding.sector)) ? target.shockPct : 0;
    }
    if (target.kind === "theme") {
        const targetTheme = target.value as ThemeId | undefined;
        const weight = themeWeightsForSymbol(holding.symbol, holding.themeWeights)
            .find((candidate) => candidate.theme === targetTheme)?.weight ?? 0;
        return target.shockPct * weight;
    }
    return 0;
}

function buildPostScenarioBreaches(
    holdings: readonly NormalizedStressHolding[],
    contributorDrafts: readonly StressContributor[],
    projectedPortfolioValueUsd: number,
): StressPolicyBreach[] {
    if (projectedPortfolioValueUsd <= 0) return [];
    const impactBySymbol = new Map(contributorDrafts.map((contributor) => [contributor.symbol, contributor.impactUsd]));
    const stressedHoldings = holdings.map((holding) => ({
        ...holding,
        marketValue: Math.max(0, holding.marketValue + (impactBySymbol.get(holding.symbol) ?? 0)),
    }));
    const breaches: StressPolicyBreach[] = [];
    const top = [...stressedHoldings].sort((a, b) => b.marketValue - a.marketValue)[0];
    if (top) {
        const pct = (top.marketValue / projectedPortfolioValueUsd) * 100;
        if (pct > 25) {
            breaches.push({
                label: "Single-name concentration",
                value: `${top.symbol} ${pct.toFixed(1)}% post-scenario`,
                href: "/portfolios/holdings",
            });
        }
    }

    const themeExposure = computeThemeExposure(stressedHoldings, DEFAULT_THEME_CAPS);
    for (const row of themeExposure.rows.filter((candidate) => candidate.status === "breached").slice(0, 3)) {
        breaches.push({
            label: row.label,
            value: `${row.percentOfPortfolio.toFixed(1)}% post-scenario`,
            href: `/portfolios/holdings?theme=${row.theme}`,
        });
    }

    return breaches;
}

function buildMissingDataNotes(
    scenario: StressScenario,
    holdings: readonly NormalizedStressHolding[],
    contributors: readonly StressContributor[],
): string[] {
    const notes: string[] = [];
    for (const target of scenario.targets) {
        if (target.kind !== "theme" && target.kind !== "bucket" && target.kind !== "ticker") continue;
        const hasMatch = contributors.some((contributor) =>
            contributor.matchedTargets.includes(target.label ?? target.value ?? target.kind),
        );
        if (!hasMatch) {
            notes.push(`No holdings matched ${target.kind} target ${target.value ?? target.label ?? "unknown"}.`);
        }
    }

    const unknownThemeValue = holdings
        .filter((holding) =>
            themeWeightsForSymbol(holding.symbol, holding.themeWeights)
                .some((weight) => weight.theme === "unknown"),
        )
        .reduce((sum, holding) => sum + holding.marketValue, 0);
    if (unknownThemeValue > 0) {
        notes.push(`${formatCurrency(unknownThemeValue)} has unknown theme metadata and may be excluded from theme shocks.`);
    }

    return notes;
}

function normalizeSymbol(symbol: string | null | undefined): string {
    return symbol?.trim().toUpperCase() ?? "";
}

function safeMoney(value: number | undefined): number {
    return roundMoney(Number.isFinite(value) ? Math.max(0, value ?? 0) : 0);
}

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(value);
}
