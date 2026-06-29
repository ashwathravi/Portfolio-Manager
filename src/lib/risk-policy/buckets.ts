export const POLICY_BUCKETS = [
    "core",
    "active",
    "speculative",
    "special_situation",
    "cash_reserve",
    "unassigned",
] as const;

export type PolicyBucketId = (typeof POLICY_BUCKETS)[number];

export type PolicyBucketStatus = "inside" | "watch" | "breached" | "missing_data";

export interface PolicyBucketMeta {
    id: PolicyBucketId;
    label: string;
    shortLabel: string;
    description: string;
}

export interface PolicyBucketPolicy {
    bucket: PolicyBucketId;
    targetPct?: number;
    minPct?: number;
    maxPct?: number;
}

export interface PolicyClassifiableHolding {
    id?: string;
    symbol?: string | null;
    name?: string | null;
    marketValue: number;
    policyBucket?: PolicyBucketId | null;
    instrumentType?: string | null;
}

export interface PolicyBucketAssignment {
    bucket: PolicyBucketId;
    source: "explicit" | "fallback" | "instrument" | "missing";
}

export interface PolicyBucketContributor {
    id?: string;
    symbol: string;
    name?: string;
    marketValue: number;
    percentOfPortfolio: number;
    assignmentSource: PolicyBucketAssignment["source"];
}

export interface PolicyBucketAllocationRow {
    bucket: PolicyBucketId;
    label: string;
    marketValue: number;
    percentOfPortfolio: number;
    targetPct?: number;
    minPct?: number;
    maxPct?: number;
    status: PolicyBucketStatus;
    overCapPct: number;
    overCapValue: number;
    contributors: PolicyBucketContributor[];
}

export interface PolicyBucketAllocation {
    totalMarketValue: number;
    rows: PolicyBucketAllocationRow[];
    unassignedMarketValue: number;
    unassignedCount: number;
    actionPrompts: string[];
}

export const POLICY_BUCKET_META: Record<PolicyBucketId, PolicyBucketMeta> = {
    core: {
        id: "core",
        label: "Core",
        shortLabel: "Core",
        description: "Long-term compounders, broad indexes, and stabilizers that anchor the plan.",
    },
    active: {
        id: "active",
        label: "Active idea / satellite",
        shortLabel: "Active",
        description: "High-conviction single-name or thematic positions with explicit theses.",
    },
    speculative: {
        id: "speculative",
        label: "Speculative/options",
        shortLabel: "Speculative",
        description: "Options, leverage, crypto, and positions sized as money-at-risk.",
    },
    special_situation: {
        id: "special_situation",
        label: "Special situation",
        shortLabel: "Special",
        description: "Political, regulatory, legal, or idiosyncratic event-driven bets.",
    },
    cash_reserve: {
        id: "cash_reserve",
        label: "Cash reserve",
        shortLabel: "Cash",
        description: "Cash, cash equivalents, and near-term liquidity buckets.",
    },
    unassigned: {
        id: "unassigned",
        label: "Unassigned",
        shortLabel: "Unassigned",
        description: "Holdings without policy metadata. This is an action item, not a safe bucket.",
    },
};

export const DEFAULT_BUCKET_POLICIES: readonly PolicyBucketPolicy[] = [
    { bucket: "core", targetPct: 70, minPct: 55, maxPct: 90 },
    { bucket: "active", targetPct: 15, maxPct: 20 },
    { bucket: "speculative", targetPct: 3, maxPct: 5 },
    { bucket: "special_situation", targetPct: 2, maxPct: 3 },
    { bucket: "cash_reserve", targetPct: 10, maxPct: 20 },
    { bucket: "unassigned", targetPct: 0, maxPct: 0 },
];

const FALLBACK_BUCKET_BY_SYMBOL: Record<string, PolicyBucketId> = {
    // Broad core exposure.
    VTI: "core",
    VOO: "core",
    SPY: "core",
    IVV: "core",
    ITOT: "core",
    VXUS: "core",
    VEA: "core",
    VWO: "core",
    BND: "core",
    AGG: "core",
    TLT: "core",
    FGKFX: "core",

    // Active ideas / satellite positions from the current risk read.
    AAPL: "active",
    MSFT: "active",
    GOOG: "active",
    GOOGL: "active",
    META: "active",
    AMZN: "active",
    NVDA: "active",
    TSM: "active",
    MU: "active",
    ORCL: "active",
    QQQ: "active",
    ARKK: "active",
    ARKVX: "active",

    // Speculative or leveraged-risk proxies.
    COIN: "speculative",
    BTC: "speculative",
    ETH: "speculative",
    TSLA: "speculative",
    RIVN: "speculative",
    LCID: "speculative",

    // Special-situation/political-regulatory exposure.
    FNMA: "special_situation",
    FMCC: "special_situation",
    FNMAS: "special_situation",
    FMCCT: "special_situation",

    // Cash and cash-equivalent symbols.
    USD: "cash_reserve",
    CASH: "cash_reserve",
    SPAXX: "cash_reserve",
    VMFXX: "cash_reserve",
    SWVXX: "cash_reserve",
    SGOV: "cash_reserve",
    SHV: "cash_reserve",
    BIL: "cash_reserve",
};

const OPTION_INSTRUMENT_RE = /\b(option|call|put|leaps?|warrant)\b/i;
const CASH_INSTRUMENT_RE = /\b(cash|money market|treasury bill|t-bill)\b/i;

export function isPolicyBucketId(value: unknown): value is PolicyBucketId {
    return typeof value === "string" && (POLICY_BUCKETS as readonly string[]).includes(value);
}

export function policyBucketLabel(bucket: PolicyBucketId): string {
    return POLICY_BUCKET_META[bucket].label;
}

export function resolvePolicyBucketAssignment(
    holding: Pick<PolicyClassifiableHolding, "symbol" | "policyBucket" | "instrumentType">,
): PolicyBucketAssignment {
    if (isPolicyBucketId(holding.policyBucket) && holding.policyBucket !== "unassigned") {
        return { bucket: holding.policyBucket, source: "explicit" };
    }

    const instrumentType = holding.instrumentType?.trim();
    if (instrumentType && OPTION_INSTRUMENT_RE.test(instrumentType)) {
        return { bucket: "speculative", source: "instrument" };
    }
    if (instrumentType && CASH_INSTRUMENT_RE.test(instrumentType)) {
        return { bucket: "cash_reserve", source: "instrument" };
    }

    const symbol = normalizeSymbol(holding.symbol);
    if (symbol && FALLBACK_BUCKET_BY_SYMBOL[symbol]) {
        return { bucket: FALLBACK_BUCKET_BY_SYMBOL[symbol], source: "fallback" };
    }

    return { bucket: "unassigned", source: "missing" };
}

export function computeBucketAllocation(
    holdings: readonly PolicyClassifiableHolding[],
    policies: readonly PolicyBucketPolicy[] = DEFAULT_BUCKET_POLICIES,
): PolicyBucketAllocation {
    const totalMarketValue = holdings.reduce((sum, holding) => sum + safeMarketValue(holding.marketValue), 0);
    const policyByBucket = new Map(policies.map((policy) => [policy.bucket, policy]));
    const rowsByBucket = new Map<PolicyBucketId, PolicyBucketAllocationRow>();

    for (const bucket of POLICY_BUCKETS) {
        const policy = policyByBucket.get(bucket);
        rowsByBucket.set(bucket, {
            bucket,
            label: policyBucketLabel(bucket),
            marketValue: 0,
            percentOfPortfolio: 0,
            targetPct: policy?.targetPct,
            minPct: policy?.minPct,
            maxPct: policy?.maxPct,
            status: "inside",
            overCapPct: 0,
            overCapValue: 0,
            contributors: [],
        });
    }

    for (const holding of holdings) {
        const marketValue = safeMarketValue(holding.marketValue);
        const assignment = resolvePolicyBucketAssignment(holding);
        const row = rowsByBucket.get(assignment.bucket)!;
        row.marketValue += marketValue;
        row.contributors.push({
            id: holding.id,
            symbol: normalizeSymbol(holding.symbol) || "UNKNOWN",
            name: holding.name ?? undefined,
            marketValue,
            percentOfPortfolio: 0,
            assignmentSource: assignment.source,
        });
    }

    const rows = POLICY_BUCKETS.map((bucket) => {
        const row = rowsByBucket.get(bucket)!;
        row.percentOfPortfolio = totalMarketValue > 0 ? (row.marketValue / totalMarketValue) * 100 : 0;
        row.status = classifyBucketStatus(row, totalMarketValue);
        row.contributors = row.contributors
            .map((contributor) => ({
                ...contributor,
                percentOfPortfolio: totalMarketValue > 0
                    ? (contributor.marketValue / totalMarketValue) * 100
                    : 0,
            }))
            .sort((a, b) => b.marketValue - a.marketValue);
        return row;
    });

    const unassigned = rowsByBucket.get("unassigned")!;

    return {
        totalMarketValue,
        rows,
        unassignedMarketValue: unassigned.marketValue,
        unassignedCount: unassigned.contributors.length,
        actionPrompts: buildBucketActionPrompts(rows),
    };
}

function classifyBucketStatus(
    row: Pick<PolicyBucketAllocationRow, "bucket" | "marketValue" | "percentOfPortfolio" | "minPct" | "maxPct">,
    totalMarketValue: number,
): PolicyBucketStatus {
    if (row.bucket === "unassigned" && row.marketValue > 0) return "missing_data";
    if (row.marketValue <= 0 || totalMarketValue <= 0) return "inside";

    if (row.maxPct != null && row.percentOfPortfolio > row.maxPct) {
        const overCapPct = row.percentOfPortfolio - row.maxPct;
        const mutable = row as PolicyBucketAllocationRow;
        mutable.overCapPct = overCapPct;
        mutable.overCapValue = Math.max(0, row.marketValue - (row.maxPct / 100) * totalMarketValue);
        return "breached";
    }

    if (row.minPct != null && row.percentOfPortfolio < row.minPct) {
        return "watch";
    }

    if (row.maxPct != null && row.maxPct > 0 && row.percentOfPortfolio >= row.maxPct * 0.9) {
        return "watch";
    }

    return "inside";
}

function buildBucketActionPrompts(rows: readonly PolicyBucketAllocationRow[]): string[] {
    const prompts: string[] = [];
    for (const row of rows) {
        if (row.status === "missing_data") {
            prompts.push(`Assign ${row.contributors.length} unassigned ${row.contributors.length === 1 ? "holding" : "holdings"} to a policy bucket.`);
        } else if (row.status === "breached" && row.maxPct != null) {
            prompts.push(`${row.label} is ${row.overCapPct.toFixed(1)} percentage points over its ${row.maxPct}% cap.`);
        }
    }
    return prompts;
}

function normalizeSymbol(symbol: string | null | undefined): string {
    return symbol?.trim().toUpperCase() ?? "";
}

function safeMarketValue(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}
