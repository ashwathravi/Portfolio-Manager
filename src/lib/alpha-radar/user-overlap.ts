/**
 * Where a filer's 13F changes meet the signed-in user (launch item i61):
 * the companies they hold, watch or have an active thesis on. Changes and
 * reports are shared by every user, so this is worked out when a user reads
 * them, never stored. A 13F names a holding by issuer and CUSIP, not by
 * ticker, so a change matches a user's ticker by its ticker when it has one
 * and otherwise by company name (./issuer-name.ts), against the names the
 * user's records and SEC's ticker file give that ticker. Matching is by
 * company: a user holding GOOGL overlaps both of Alphabet's share classes.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { holdings, portfolios, symbolDirectory, theses, watchlistItems } from "@/db/schema";
import { isSeedThesis } from "@/lib/research/thesis";
import { isExampleWatchId } from "@/lib/research/watchlist";

import { alphaRadarRelevanceBoost } from "./diff";
import { normalizeIssuerName } from "./issuer-name";
import type { AlphaRadarMemoChange } from "./memo";

type Database = typeof db;

export type AlphaRadarOverlapKind = "portfolio" | "watchlist" | "thesis";

export interface AlphaRadarUserSecurity {
    ticker: string;
    /** The company's names, as the user's records and SEC's ticker file give them. */
    names: readonly string[];
}

export type AlphaRadarUserOverlap = Record<AlphaRadarOverlapKind, readonly AlphaRadarUserSecurity[]>;

export const NO_USER_OVERLAP: AlphaRadarUserOverlap = { portfolio: [], watchlist: [], thesis: [] };

const KINDS: readonly AlphaRadarOverlapKind[] = ["portfolio", "watchlist", "thesis"];

// As the ingest's diff words them (./diff.ts).
const REASONS: Record<AlphaRadarOverlapKind, string> = {
    portfolio: "Held in portfolio",
    watchlist: "On watchlist",
    thesis: "Linked to active thesis",
};

/**
 * The changes with the user's overlap in place of what was stored, scored
 * as the ingest would have scored them with it, highest score first (ties
 * keep their order).
 */
export function applyAlphaRadarUserOverlap<T extends AlphaRadarMemoChange>(
    changes: readonly T[],
    overlap: AlphaRadarUserOverlap,
): T[] {
    const matchers = {
        portfolio: buildMatcher(overlap.portfolio),
        watchlist: buildMatcher(overlap.watchlist),
        thesis: buildMatcher(overlap.thesis),
    };
    return changes
        .map((change, index) => {
            const key = normalizeIssuerName(change.issuerName);
            const ticker = change.ticker?.trim().toUpperCase();
            const matched = {
                portfolio: matchTickers(matchers.portfolio, ticker, key),
                watchlist: matchTickers(matchers.watchlist, ticker, key),
                thesis: matchTickers(matchers.thesis, ticker, key),
            };
            const userRelevance = {
                portfolio: matched.portfolio.length > 0,
                watchlist: matched.watchlist.length > 0,
                thesis: matched.thesis.length > 0,
                reasons: KINDS.filter((kind) => matched[kind].length > 0).map((kind) => REASONS[kind]),
                matchedTickers: [...new Set(KINDS.flatMap((kind) => matched[kind]))].sort(),
                matchedCusips: [],
            };
            const materialityScore = Math.min(100, change.materialityScore + alphaRadarRelevanceBoost(userRelevance));
            return { change: { ...change, userRelevance, materialityScore }, index };
        })
        .sort((a, b) => b.change.materialityScore - a.change.materialityScore || a.index - b.index)
        .map(({ change }) => change);
}

interface Matcher {
    tickers: ReadonlySet<string>;
    /** Normalized company name → the user's tickers with that name. */
    names: ReadonlyMap<string, readonly string[]>;
}

function buildMatcher(securities: readonly AlphaRadarUserSecurity[]): Matcher {
    const tickers = new Set<string>();
    const names = new Map<string, string[]>();
    for (const security of securities) {
        const ticker = security.ticker.trim().toUpperCase();
        if (!ticker) continue;
        tickers.add(ticker);
        for (const name of security.names) {
            const key = normalizeIssuerName(name);
            if (!key) continue;
            const list = names.get(key) ?? [];
            if (!list.includes(ticker)) list.push(ticker);
            names.set(key, list);
        }
    }
    return { tickers, names };
}

function matchTickers(matcher: Matcher, ticker: string | undefined, key: string): string[] {
    if (ticker && matcher.tickers.has(ticker)) return [ticker];
    return key ? [...matcher.names.get(key) ?? []] : [];
}

/**
 * What the user holds (a position that isn't zero, in any account), watches
 * and has an active thesis on, by ticker, with each company's names. The
 * examples are left out, edited or not, as are removed watchlist items.
 */
export async function loadAlphaRadarUserOverlap(
    userId: string,
    database: Pick<Database, "select"> = db,
): Promise<AlphaRadarUserOverlap> {
    const [held, watched, active] = await Promise.all([
        database
            .select({ ticker: holdings.symbol, name: holdings.name })
            .from(holdings)
            .innerJoin(portfolios, eq(holdings.portfolioId, portfolios.id))
            .where(and(eq(portfolios.userId, userId), sql`${holdings.quantity} <> 0`)),
        database
            .select({ id: watchlistItems.id, ticker: watchlistItems.ticker, name: watchlistItems.companyName })
            .from(watchlistItems)
            .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.dismissed, false))),
        database
            .select({ id: theses.id, ticker: theses.ticker, name: theses.companyName })
            .from(theses)
            .where(and(eq(theses.userId, userId), eq(theses.dismissed, false), eq(theses.status, "active"))),
    ]);
    const rows = {
        portfolio: held,
        watchlist: watched.filter((row) => !isExampleWatchId(row.id)),
        thesis: active.filter((row) => !isSeedThesis(row)),
    };

    const tickers = [...new Set(KINDS.flatMap((kind) => rows[kind].map((row) => row.ticker.trim().toUpperCase())))].filter(Boolean);
    const directory = tickers.length === 0 ? [] : await database
        .select({ symbol: symbolDirectory.symbol, name: symbolDirectory.name })
        .from(symbolDirectory)
        .where(inArray(symbolDirectory.symbol, tickers));
    const directoryName = new Map(directory.map((row) => [row.symbol, row.name]));

    const securities = (list: ReadonlyArray<{ ticker: string; name: string }>): AlphaRadarUserSecurity[] => {
        const names = new Map<string, Set<string>>();
        for (const row of list) {
            const ticker = row.ticker.trim().toUpperCase();
            if (!ticker) continue;
            const set = names.get(ticker) ?? new Set<string>();
            if (row.name.trim()) set.add(row.name.trim());
            const listed = directoryName.get(ticker);
            if (listed) set.add(listed);
            names.set(ticker, set);
        }
        return [...names]
            .map(([ticker, set]) => ({ ticker, names: [...set].sort() }))
            .sort((a, b) => a.ticker.localeCompare(b.ticker));
    };
    return {
        portfolio: securities(rows.portfolio),
        watchlist: securities(rows.watchlist),
        thesis: securities(rows.thesis),
    };
}
