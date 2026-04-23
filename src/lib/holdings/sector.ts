/**
 * Phase 4 (AR-74) ticker → sector fallback.
 *
 * We don't have a sector column on the holdings table yet (would need a
 * fundamentals API or a static data load). In the meantime, this module
 * gives us the five sector buckets the Holdings filter row expects
 * ("Tech", "Consumer", "Auto", "Finance") plus a couple of extras so we
 * don't end up with everything in "Other".
 *
 * Callers that know the sector should just pass it in directly — this is
 * only the fallback.
 */

export const SECTOR_LABELS = [
    "Tech",
    "Consumer",
    "Auto",
    "Finance",
    "Healthcare",
    "Energy",
    "Crypto",
    "Bonds",
    "Commodities",
    "Other",
] as const;

export type Sector = (typeof SECTOR_LABELS)[number];

const MAP: Record<string, Sector> = {
    // Tech
    AAPL: "Tech",
    MSFT: "Tech",
    NVDA: "Tech",
    GOOG: "Tech",
    GOOGL: "Tech",
    META: "Tech",
    AMZN: "Tech",
    AMD: "Tech",
    CRM: "Tech",
    ORCL: "Tech",
    ADBE: "Tech",
    INTC: "Tech",
    NFLX: "Tech",

    // Auto
    TSLA: "Auto",
    F: "Auto",
    GM: "Auto",
    RIVN: "Auto",
    LCID: "Auto",
    TM: "Auto",

    // Finance
    JPM: "Finance",
    GS: "Finance",
    BAC: "Finance",
    MS: "Finance",
    WFC: "Finance",
    V: "Finance",
    MA: "Finance",
    AXP: "Finance",
    BRK: "Finance",

    // Consumer
    WMT: "Consumer",
    KO: "Consumer",
    PEP: "Consumer",
    MCD: "Consumer",
    NKE: "Consumer",
    SBUX: "Consumer",
    HD: "Consumer",
    COST: "Consumer",
    PG: "Consumer",

    // Healthcare
    JNJ: "Healthcare",
    PFE: "Healthcare",
    UNH: "Healthcare",
    LLY: "Healthcare",
    MRK: "Healthcare",

    // Energy
    XOM: "Energy",
    CVX: "Energy",
    COP: "Energy",

    // Crypto + alt
    COIN: "Crypto",
    BTC: "Crypto",
    ETH: "Crypto",

    // Bonds
    BND: "Bonds",
    TLT: "Bonds",
    AGG: "Bonds",

    // Commodities
    GLD: "Commodities",
    SLV: "Commodities",
};

export function sectorFor(symbol: string | undefined | null): Sector {
    if (!symbol) return "Other";
    return MAP[symbol.toUpperCase()] ?? "Other";
}
