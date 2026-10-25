/**
 * Sectors, and the ticker → sector fallback.
 *
 * A held symbol's sector comes from the securities master (launch item
 * i34): its industry code in the ticker reference data, mapped by
 * security-profile.ts. This map covers well-known tickers only until the
 * nightly job has fetched a symbol's reference data; callers that have a
 * sector pass it in, and this is the fallback.
 */

export const SECTOR_LABELS = [
    "Tech",
    "Communication",
    "Consumer",
    "Auto",
    "Finance",
    "Healthcare",
    "Industrials",
    "Energy",
    "Materials",
    "Real estate",
    "Utilities",
    "Funds",
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

export function isSector(value: unknown): value is Sector {
    return typeof value === "string" && (SECTOR_LABELS as readonly string[]).includes(value);
}

export function sectorFor(symbol: string | undefined | null): Sector {
    if (!symbol) return "Other";
    return MAP[symbol.toUpperCase()] ?? "Other";
}
