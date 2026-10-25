/**
 * The securities master (launch item i34): what a ticker is, from Massive's
 * ticker reference data, which the nightly price job stores in `securities`.
 *
 * - Sector, from the company's SIC industry code, mapped onto the app's
 *   sectors (`SECTOR_LABELS`). Free reference data has SIC codes, not GICS
 *   sectors, so this is an approximation at the edges (Amazon's code is
 *   catalog retail, so it's Consumer).
 * - Funds (ETFs and the like) have no SIC code: bond, commodity and crypto
 *   funds are told by their names, and the rest are "Funds".
 * - Asset class, from the security type (common stock, ETF, preferred,
 *   warrant…).
 */

import type { Sector } from "@/lib/holdings/sector";

/** One ticker's reference data, as the provider gives it. */
export interface TickerReference {
    symbol: string;
    name: string | null;
    /** Massive security type: CS, ETF, ADRC, PFD, WARRANT… */
    type: string | null;
    primaryExchange: string | null;
    active: boolean;
    currency: string | null;
    sicCode: string | null;
    sicDescription: string | null;
}

/** What the app stores and shows for a security. */
export interface SecurityProfile {
    symbol: string;
    name: string | null;
    type: string | null;
    sector: Sector | null;
    industry: string | null;
}

export const ASSET_CLASSES = ["Stock", "Fund", "Preferred", "Warrant or right", "Bond", "Other"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

const STOCK_TYPES = new Set(["CS", "ADRC", "ADRP", "ADRR", "ADRW", "GDR", "NYRS", "OS"]);
const FUND_TYPES = new Set(["ETF", "ETN", "ETV", "ETS", "FUND", "SP"]);

/** The asset class of a Massive security type; "Other" when unknown. */
export function assetClassFor(type: string | null | undefined): AssetClass {
    const t = type?.trim().toUpperCase() ?? "";
    if (STOCK_TYPES.has(t)) return "Stock";
    if (FUND_TYPES.has(t)) return "Fund";
    if (t === "PFD") return "Preferred";
    if (t === "WARRANT" || t === "RIGHT" || t === "UNIT") return "Warrant or right";
    if (t === "BOND" || t === "AGEN") return "Bond";
    return "Other";
}

/** [first code, last code, sector], most specific first: the first range that holds the code wins. */
const SIC_SECTORS: ReadonlyArray<readonly [number, number, Sector]> = [
    // Carve-outs inside wider ranges.
    [2830, 2836, "Healthcare"], // pharmaceuticals, biologicals
    [2840, 2844, "Consumer"], // soaps, cosmetics
    [3570, 3579, "Tech"], // computers, office equipment
    [3630, 3639, "Consumer"], // household appliances
    [3711, 3716, "Auto"], // motor vehicles, bodies, parts
    [3750, 3751, "Auto"], // motorcycles
    [3826, 3826, "Healthcare"], // laboratory analytical instruments
    [3840, 3851, "Healthcare"], // medical and dental instruments
    [4950, 4959, "Industrials"], // waste management
    [5122, 5122, "Healthcare"], // drug wholesale
    [5171, 5172, "Energy"], // petroleum wholesale
    [6500, 6553, "Real estate"],
    [6798, 6798, "Real estate"], // REITs
    [7310, 7319, "Communication"], // advertising
    [7370, 7379, "Tech"], // software, computer services
    [7800, 7899, "Communication"], // film, video
    [8000, 8099, "Healthcare"], // health services
    [8200, 8299, "Consumer"], // education
    [8731, 8731, "Healthcare"], // biological research
    // Divisions and major groups.
    [100, 999, "Consumer"], // agriculture
    [1000, 1099, "Materials"], // metal mining
    [1200, 1399, "Energy"], // coal, oil and gas
    [1400, 1499, "Materials"],
    [1500, 1799, "Industrials"], // construction
    [2000, 2399, "Consumer"], // food, tobacco, textiles, apparel
    [2400, 2499, "Materials"], // lumber
    [2500, 2599, "Consumer"], // furniture
    [2600, 2699, "Materials"], // paper
    [2700, 2799, "Communication"], // publishing
    [2800, 2899, "Materials"], // chemicals
    [2900, 2999, "Energy"], // refining
    [3000, 3099, "Materials"], // rubber, plastics
    [3100, 3199, "Consumer"], // leather
    [3200, 3399, "Materials"], // stone, glass, primary metals
    [3400, 3599, "Industrials"], // fabricated metal, machinery
    [3600, 3699, "Tech"], // electronics, semiconductors
    [3700, 3799, "Industrials"], // aircraft, ships, rail, defense
    [3800, 3899, "Tech"], // instruments
    [3900, 3999, "Consumer"], // toys, jewelry, sporting goods
    [4000, 4799, "Industrials"], // transportation
    [4800, 4899, "Communication"], // telecom, broadcasting, cable
    [4900, 4999, "Utilities"],
    [5000, 5199, "Industrials"], // wholesale
    [5200, 5999, "Consumer"], // retail
    [6000, 6799, "Finance"], // banks, brokers, insurance, blank checks
    [7000, 7299, "Consumer"], // hotels, personal services
    [7300, 7399, "Industrials"], // business services
    [7400, 7999, "Consumer"], // repair, amusement, recreation
    [8100, 8999, "Industrials"], // legal, engineering, management services
];

/** A SIC industry code's sector; null for no code, or one outside every range. */
export function sectorFromSic(sicCode: string | null | undefined): Sector | null {
    if (!sicCode || !/^\d{3,4}$/.test(sicCode.trim())) return null;
    const code = Number(sicCode.trim());
    for (const [from, to, sector] of SIC_SECTORS) {
        if (code >= from && code <= to) return sector;
    }
    return null;
}

/** A fund's sector from its name: bonds, commodities, crypto, or a fund like any other. */
export function fundSector(name: string | null | undefined): Sector {
    const n = name ?? "";
    if (/\b(bitcoin|ether(eum)?|crypto|blockchain)\b/i.test(n)) return "Crypto";
    if (/\b(bonds?|treasur(y|ies)|fixed income|aggregate|municipal|t-bill|corporate debt)\b/i.test(n)) return "Bonds";
    if (/\b(gold|silver|platinum|commodit(y|ies)|oil|natural gas|metals?)\b/i.test(n)) return "Commodities";
    return "Funds";
}

/** The profile stored for a ticker's reference data. */
export function profileFromReference(reference: TickerReference): SecurityProfile {
    const sector = assetClassFor(reference.type) === "Fund"
        ? fundSector(reference.name)
        : sectorFromSic(reference.sicCode);
    return {
        symbol: reference.symbol.trim().toUpperCase(),
        name: reference.name?.trim() || null,
        type: reference.type?.trim().toUpperCase() || null,
        sector,
        industry: reference.sicDescription?.trim() || null,
    };
}

/**
 * A holding's display name: the reference data's, else the name it was
 * imported with (unless that is only its ticker), else the ticker.
 */
export function holdingName(symbol: string, stored: string | null | undefined, profile?: Pick<SecurityProfile, "name"> | null): string {
    if (profile?.name) return profile.name;
    const own = stored?.trim();
    if (own && own.toUpperCase() !== symbol.trim().toUpperCase()) return own;
    return symbol;
}

/** Profiles for `symbols`, or none when the store can't be read: names and sectors are a nicety. */
export async function loadSecurityProfiles(
    symbols: Iterable<string>,
    read: (symbols: Iterable<string>) => Promise<Map<string, SecurityProfile>>,
): Promise<Map<string, SecurityProfile>> {
    try {
        return await read(symbols);
    } catch (error) {
        console.warn("Security profiles unavailable: showing stored names and fallback sectors.", error);
        return new Map();
    }
}
