import {
    type PolicyBucketId,
    type PolicyClassifiableHolding,
    resolvePolicyBucketAssignment,
} from "./buckets";

export const THEME_IDS = [
    "ai_infrastructure",
    "semiconductors",
    "mega_cap_growth",
    "cloud_platforms",
    "consumer_tech",
    "crypto_risk_on_liquidity",
    "special_situation_regulatory",
    "employer_linked_wealth",
    "broad_core_index",
    "bonds_treasuries_cash_equivalent",
    "unknown",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export interface ThemeMeta {
    id: ThemeId;
    label: string;
    description: string;
}

export interface ThemeWeight {
    theme: ThemeId;
    weight: number;
    source?: "explicit" | "fallback" | "unknown";
}

export interface ThemeExposureHolding extends PolicyClassifiableHolding {
    themeWeights?: readonly ThemeWeight[] | null;
}

export interface ThemeContributor {
    id?: string;
    symbol: string;
    name?: string;
    marketValue: number;
    weightedValue: number;
    percentOfPortfolio: number;
    policyBucket: PolicyBucketId;
    source: ThemeWeight["source"];
}

export interface ThemeBucketBreakdown {
    bucket: PolicyBucketId;
    marketValue: number;
    percentOfTheme: number;
}

export interface ThemeExposureRow {
    theme: ThemeId;
    label: string;
    marketValue: number;
    percentOfPortfolio: number;
    maxPct?: number;
    status: "inside" | "watch" | "breached" | "missing_data";
    contributors: ThemeContributor[];
    bucketBreakdown: ThemeBucketBreakdown[];
}

export interface ThemeExposure {
    totalMarketValue: number;
    rows: ThemeExposureRow[];
    unknownMarketValue: number;
    unknownCount: number;
}

export const THEME_META: Record<ThemeId, ThemeMeta> = {
    ai_infrastructure: {
        id: "ai_infrastructure",
        label: "AI infrastructure",
        description: "AI compute, accelerators, memory, foundry, cloud capex, and data-center demand.",
    },
    semiconductors: {
        id: "semiconductors",
        label: "Semiconductors",
        description: "Chip designers, foundries, memory, equipment, and semiconductor supply-chain exposure.",
    },
    mega_cap_growth: {
        id: "mega_cap_growth",
        label: "Mega-cap growth",
        description: "Large-cap growth and platform companies with shared duration/liquidity sensitivity.",
    },
    cloud_platforms: {
        id: "cloud_platforms",
        label: "Cloud/platforms",
        description: "Cloud infrastructure, software platforms, advertising platforms, and enterprise ecosystems.",
    },
    consumer_tech: {
        id: "consumer_tech",
        label: "Consumer tech",
        description: "Consumer hardware, marketplaces, subscriptions, autos, and direct-to-consumer technology.",
    },
    crypto_risk_on_liquidity: {
        id: "crypto_risk_on_liquidity",
        label: "Crypto/risk-on liquidity",
        description: "Crypto, exchanges, and high-beta liquidity-sensitive exposure.",
    },
    special_situation_regulatory: {
        id: "special_situation_regulatory",
        label: "Special situation/regulatory",
        description: "Political, regulatory, legal, conservatorship, or other idiosyncratic event exposure.",
    },
    employer_linked_wealth: {
        id: "employer_linked_wealth",
        label: "Employer-linked wealth",
        description: "Company-specific exposure that can overlap with income, vesting, or career risk.",
    },
    broad_core_index: {
        id: "broad_core_index",
        label: "Broad core index",
        description: "Broad market index exposure that diversifies away from single-name selection.",
    },
    bonds_treasuries_cash_equivalent: {
        id: "bonds_treasuries_cash_equivalent",
        label: "Bonds/treasuries/cash equivalent",
        description: "Stabilizers, Treasury funds, money market funds, cash equivalents, and bond exposure.",
    },
    unknown: {
        id: "unknown",
        label: "Unknown theme",
        description: "Missing theme metadata. This should be surfaced rather than omitted.",
    },
};

export const DEFAULT_THEME_CAPS: Readonly<Partial<Record<ThemeId, number>>> = {
    ai_infrastructure: 35,
    semiconductors: 25,
    mega_cap_growth: 55,
    cloud_platforms: 40,
    crypto_risk_on_liquidity: 5,
    special_situation_regulatory: 5,
    employer_linked_wealth: 25,
    unknown: 0,
};

const FALLBACK_THEME_WEIGHTS_BY_SYMBOL: Record<string, readonly ThemeWeight[]> = {
    AAPL: [
        { theme: "mega_cap_growth", weight: 0.45, source: "fallback" },
        { theme: "consumer_tech", weight: 0.4, source: "fallback" },
        { theme: "ai_infrastructure", weight: 0.15, source: "fallback" },
    ],
    MSFT: [
        { theme: "cloud_platforms", weight: 0.35, source: "fallback" },
        { theme: "mega_cap_growth", weight: 0.35, source: "fallback" },
        { theme: "ai_infrastructure", weight: 0.3, source: "fallback" },
    ],
    GOOG: [
        { theme: "mega_cap_growth", weight: 0.35, source: "fallback" },
        { theme: "cloud_platforms", weight: 0.25, source: "fallback" },
        { theme: "ai_infrastructure", weight: 0.2, source: "fallback" },
        { theme: "employer_linked_wealth", weight: 0.2, source: "fallback" },
    ],
    GOOGL: [
        { theme: "mega_cap_growth", weight: 0.35, source: "fallback" },
        { theme: "cloud_platforms", weight: 0.25, source: "fallback" },
        { theme: "ai_infrastructure", weight: 0.2, source: "fallback" },
        { theme: "employer_linked_wealth", weight: 0.2, source: "fallback" },
    ],
    NVDA: [
        { theme: "ai_infrastructure", weight: 0.45, source: "fallback" },
        { theme: "semiconductors", weight: 0.45, source: "fallback" },
        { theme: "mega_cap_growth", weight: 0.1, source: "fallback" },
    ],
    TSM: [
        { theme: "semiconductors", weight: 0.6, source: "fallback" },
        { theme: "ai_infrastructure", weight: 0.3, source: "fallback" },
        { theme: "mega_cap_growth", weight: 0.1, source: "fallback" },
    ],
    MU: [
        { theme: "semiconductors", weight: 0.55, source: "fallback" },
        { theme: "ai_infrastructure", weight: 0.35, source: "fallback" },
        { theme: "mega_cap_growth", weight: 0.1, source: "fallback" },
    ],
    META: [
        { theme: "mega_cap_growth", weight: 0.4, source: "fallback" },
        { theme: "ai_infrastructure", weight: 0.25, source: "fallback" },
        { theme: "consumer_tech", weight: 0.2, source: "fallback" },
        { theme: "cloud_platforms", weight: 0.15, source: "fallback" },
    ],
    AMZN: [
        { theme: "cloud_platforms", weight: 0.35, source: "fallback" },
        { theme: "consumer_tech", weight: 0.35, source: "fallback" },
        { theme: "mega_cap_growth", weight: 0.3, source: "fallback" },
    ],
    ORCL: [
        { theme: "cloud_platforms", weight: 0.45, source: "fallback" },
        { theme: "ai_infrastructure", weight: 0.35, source: "fallback" },
        { theme: "mega_cap_growth", weight: 0.2, source: "fallback" },
    ],
    TSLA: [
        { theme: "consumer_tech", weight: 0.55, source: "fallback" },
        { theme: "mega_cap_growth", weight: 0.3, source: "fallback" },
        { theme: "crypto_risk_on_liquidity", weight: 0.15, source: "fallback" },
    ],
    COIN: [{ theme: "crypto_risk_on_liquidity", weight: 1, source: "fallback" }],
    BTC: [{ theme: "crypto_risk_on_liquidity", weight: 1, source: "fallback" }],
    ETH: [{ theme: "crypto_risk_on_liquidity", weight: 1, source: "fallback" }],
    FNMA: [{ theme: "special_situation_regulatory", weight: 1, source: "fallback" }],
    FMCC: [{ theme: "special_situation_regulatory", weight: 1, source: "fallback" }],
    FNMAS: [{ theme: "special_situation_regulatory", weight: 1, source: "fallback" }],
    FMCCT: [{ theme: "special_situation_regulatory", weight: 1, source: "fallback" }],
    ARKK: [
        { theme: "ai_infrastructure", weight: 0.35, source: "fallback" },
        { theme: "mega_cap_growth", weight: 0.35, source: "fallback" },
        { theme: "consumer_tech", weight: 0.3, source: "fallback" },
    ],
    ARKVX: [
        { theme: "ai_infrastructure", weight: 0.35, source: "fallback" },
        { theme: "mega_cap_growth", weight: 0.35, source: "fallback" },
        { theme: "consumer_tech", weight: 0.3, source: "fallback" },
    ],
    QQQ: [
        { theme: "mega_cap_growth", weight: 0.55, source: "fallback" },
        { theme: "ai_infrastructure", weight: 0.25, source: "fallback" },
        { theme: "consumer_tech", weight: 0.2, source: "fallback" },
    ],
    VTI: [{ theme: "broad_core_index", weight: 1, source: "fallback" }],
    VOO: [{ theme: "broad_core_index", weight: 1, source: "fallback" }],
    SPY: [{ theme: "broad_core_index", weight: 1, source: "fallback" }],
    IVV: [{ theme: "broad_core_index", weight: 1, source: "fallback" }],
    ITOT: [{ theme: "broad_core_index", weight: 1, source: "fallback" }],
    VXUS: [{ theme: "broad_core_index", weight: 1, source: "fallback" }],
    VEA: [{ theme: "broad_core_index", weight: 1, source: "fallback" }],
    VWO: [{ theme: "broad_core_index", weight: 1, source: "fallback" }],
    BND: [{ theme: "bonds_treasuries_cash_equivalent", weight: 1, source: "fallback" }],
    AGG: [{ theme: "bonds_treasuries_cash_equivalent", weight: 1, source: "fallback" }],
    TLT: [{ theme: "bonds_treasuries_cash_equivalent", weight: 1, source: "fallback" }],
    BIL: [{ theme: "bonds_treasuries_cash_equivalent", weight: 1, source: "fallback" }],
    SGOV: [{ theme: "bonds_treasuries_cash_equivalent", weight: 1, source: "fallback" }],
    SHV: [{ theme: "bonds_treasuries_cash_equivalent", weight: 1, source: "fallback" }],
    USD: [{ theme: "bonds_treasuries_cash_equivalent", weight: 1, source: "fallback" }],
    CASH: [{ theme: "bonds_treasuries_cash_equivalent", weight: 1, source: "fallback" }],
    SPAXX: [{ theme: "bonds_treasuries_cash_equivalent", weight: 1, source: "fallback" }],
    VMFXX: [{ theme: "bonds_treasuries_cash_equivalent", weight: 1, source: "fallback" }],
    SWVXX: [{ theme: "bonds_treasuries_cash_equivalent", weight: 1, source: "fallback" }],
};

export function isThemeId(value: unknown): value is ThemeId {
    return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

export function themeLabel(theme: ThemeId): string {
    return THEME_META[theme].label;
}

export function themeWeightsForSymbol(
    symbol: string | null | undefined,
    explicitWeights?: readonly ThemeWeight[] | null,
): readonly ThemeWeight[] {
    const explicit = normalizeThemeWeights(explicitWeights, "explicit");
    if (explicit.length > 0) return explicit;

    const key = symbol?.trim().toUpperCase();
    if (key && FALLBACK_THEME_WEIGHTS_BY_SYMBOL[key]) {
        return normalizeThemeWeights(FALLBACK_THEME_WEIGHTS_BY_SYMBOL[key], "fallback");
    }

    return [{ theme: "unknown", weight: 1, source: "unknown" }];
}

export function computeThemeExposure(
    holdings: readonly ThemeExposureHolding[],
    caps: Readonly<Partial<Record<ThemeId, number>>> = DEFAULT_THEME_CAPS,
): ThemeExposure {
    const totalMarketValue = holdings.reduce((sum, holding) => sum + safeMarketValue(holding.marketValue), 0);
    const rowsByTheme = new Map<ThemeId, ThemeExposureRow>();

    for (const theme of THEME_IDS) {
        rowsByTheme.set(theme, {
            theme,
            label: themeLabel(theme),
            marketValue: 0,
            percentOfPortfolio: 0,
            maxPct: caps[theme],
            status: "inside",
            contributors: [],
            bucketBreakdown: [],
        });
    }

    for (const holding of holdings) {
        const holdingMarketValue = safeMarketValue(holding.marketValue);
        const policyBucket = resolvePolicyBucketAssignment(holding).bucket;
        const weights = themeWeightsForSymbol(holding.symbol, holding.themeWeights);

        for (const weight of weights) {
            const weightedValue = holdingMarketValue * weight.weight;
            const row = rowsByTheme.get(weight.theme)!;
            row.marketValue += weightedValue;
            row.contributors.push({
                id: holding.id,
                symbol: normalizeSymbol(holding.symbol) || "UNKNOWN",
                name: holding.name ?? undefined,
                marketValue: holdingMarketValue,
                weightedValue,
                percentOfPortfolio: 0,
                policyBucket,
                source: weight.source ?? "fallback",
            });
        }
    }

    const rows = THEME_IDS.map((theme) => {
        const row = rowsByTheme.get(theme)!;
        row.percentOfPortfolio = totalMarketValue > 0 ? (row.marketValue / totalMarketValue) * 100 : 0;
        row.status = classifyThemeStatus(row.theme, row.percentOfPortfolio, row.maxPct, row.marketValue);
        row.contributors = row.contributors
            .map((contributor) => ({
                ...contributor,
                percentOfPortfolio: totalMarketValue > 0
                    ? (contributor.weightedValue / totalMarketValue) * 100
                    : 0,
            }))
            .sort((a, b) => b.weightedValue - a.weightedValue);
        row.bucketBreakdown = buildThemeBucketBreakdown(row);
        return row;
    });

    const unknown = rowsByTheme.get("unknown")!;

    return {
        totalMarketValue,
        rows,
        unknownMarketValue: unknown.marketValue,
        unknownCount: unknown.contributors.length,
    };
}

function normalizeThemeWeights(
    weights: readonly ThemeWeight[] | null | undefined,
    source: ThemeWeight["source"],
): ThemeWeight[] {
    const valid = (weights ?? [])
        .filter((weight) => isThemeId(weight.theme) && Number.isFinite(weight.weight) && weight.weight > 0)
        .map((weight) => ({
            theme: weight.theme,
            weight: weight.weight,
            source: weight.source ?? source,
        }));

    const sum = valid.reduce((total, weight) => total + weight.weight, 0);
    if (sum <= 0) return [];

    return valid.map((weight) => ({
        ...weight,
        weight: weight.weight / sum,
    }));
}

function classifyThemeStatus(
    theme: ThemeId,
    percentOfPortfolio: number,
    maxPct: number | undefined,
    marketValue: number,
): ThemeExposureRow["status"] {
    if (theme === "unknown" && marketValue > 0) return "missing_data";
    if (maxPct == null || marketValue <= 0) return "inside";
    if (percentOfPortfolio > maxPct) return "breached";
    if (maxPct > 0 && percentOfPortfolio >= maxPct * 0.9) return "watch";
    return "inside";
}

function buildThemeBucketBreakdown(row: ThemeExposureRow): ThemeBucketBreakdown[] {
    const byBucket = new Map<PolicyBucketId, number>();
    for (const contributor of row.contributors) {
        byBucket.set(
            contributor.policyBucket,
            (byBucket.get(contributor.policyBucket) ?? 0) + contributor.weightedValue,
        );
    }

    return [...byBucket.entries()]
        .map(([bucket, marketValue]) => ({
            bucket,
            marketValue,
            percentOfTheme: row.marketValue > 0 ? (marketValue / row.marketValue) * 100 : 0,
        }))
        .sort((a, b) => b.marketValue - a.marketValue);
}

function normalizeSymbol(symbol: string | null | undefined): string {
    return symbol?.trim().toUpperCase() ?? "";
}

function safeMarketValue(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}
