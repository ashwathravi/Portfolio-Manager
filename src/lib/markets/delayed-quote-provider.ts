/**
 * Delayed intraday quotes over the stored closes (launch item i33).
 *
 * Quotes start as the price store's closes (StoredQuoteProvider). From the
 * opening bell until the nightly ingest has stored today's close, a tracked
 * US stock's close is replaced by a Finnhub quote from today's session,
 * kept in Postgres and fetched again about every 80 seconds
 * (`intraday-quotes.ts`). Every quote says which it is (`kind`), and a
 * delayed one carries the time it was quoted, so pages label prices as
 * "delayed" or "close" and never as live.
 *
 * Anything that goes wrong leaves the close in place: no key, the budget
 * spent, Finnhub down or refusing the key, a symbol it doesn't know, a quote
 * from before today's open, or a previous close that disagrees with the
 * stored one (a split the ingest hasn't applied yet would otherwise value a
 * position at half its price).
 */

import { usableDatabaseUrl } from "@/db/connection-options";
import { QuoteUnavailableError } from "@/lib/providers/errors";
import {
    FinnhubAuthError,
    FinnhubQuoteClient,
    FinnhubRateLimitError,
    type IntradayQuote,
} from "@/lib/providers/finnhub-quote-client";
import type { Fundamentals, MarketDataProvider, OHLC, Quote, SymbolResult } from "@/types/market-data";

import {
    claimIntradayQuotes,
    FETCH_CONCURRENCY,
    FINNHUB_CALL_BUDGET,
    needsRefresh,
    readIntradayRows,
    saveIntradayResults,
    type CallBudget,
    type IntradayResult,
    type IntradayRow,
} from "./intraday-quotes";
import { getEasternParts, previousTradingDay, sessionSoFar, type RegularSession } from "./market-hours";
import { normalizeSymbols } from "./price-store";

/** A US stock or ETF ticker as Finnhub knows it; crypto pairs (BTC-USD) and the like aren't asked for. */
const US_STOCK_TICKER = /^[A-Z]{1,5}(?:\.[A-Z]{1,2})?$/;
/** How far a quote's previous close may be from the stored one before it is distrusted. */
export const PREVIOUS_CLOSE_TOLERANCE = 0.02;
/** A quote time this far ahead of the server's clock is still believed. */
const CLOCK_SKEW_MS = 60_000;
export const RATE_LIMIT_PAUSE_MS = 60_000;
export const AUTH_PAUSE_MS = 10 * 60_000;

/** Where intraday quotes come from; FinnhubQuoteClient in production. */
export interface IntradaySource {
    readonly source: string;
    configured(): boolean;
    /** The symbol's quote, or null when the provider has none. */
    quote(symbol: string): Promise<IntradayQuote | null>;
}

/** The shared quote rows (`intraday-quotes.ts`); injectable for tests. */
export interface IntradayStore {
    configured(): boolean;
    read(symbols: readonly string[]): Promise<IntradayRow[]>;
    claim(
        symbols: readonly string[],
        options: { now: Date; session: RegularSession; budget: CallBudget; source: string },
    ): Promise<{ rows: IntradayRow[]; claimed: string[] }>;
    save(results: readonly IntradayResult[], options: { claimedAt: Date; fetchedAt: Date; source: string }): Promise<void>;
}

const DATABASE_INTRADAY_STORE: IntradayStore = {
    configured: () => Boolean(usableDatabaseUrl(process.env.DATABASE_URL)),
    read: (symbols) => readIntradayRows(symbols),
    claim: (symbols, options) => claimIntradayQuotes(symbols, options),
    save: (results, options) => saveIntradayResults(results, options),
};

/** The Eastern date a quote's price is from. */
function quoteDate(quote: Pick<Quote, "timestamp">): string | null {
    const at = new Date(quote.timestamp);
    return Number.isNaN(at.getTime()) ? null : getEasternParts(at).date;
}

/**
 * A delayed quote from a stored row, or undefined when there is none worth
 * showing: no price, a price from before today's open, or a previous close
 * that disagrees with the stored close of the session before today's.
 */
export function quoteFromIntraday(
    row: IntradayRow,
    session: RegularSession,
    now: Date,
    close?: Quote,
): Quote | undefined {
    const { price, previousClose, quotedAt } = row;
    if (price === null || previousClose === null || quotedAt === null) return undefined;
    if (!(price > 0) || !(previousClose > 0)) return undefined;
    if (quotedAt < session.openAt || quotedAt.getTime() > now.getTime() + CLOCK_SKEW_MS) return undefined;
    if (
        close
        && quoteDate(close) === previousTradingDay(session.date)
        && Math.abs(previousClose / close.price - 1) > PREVIOUS_CLOSE_TOLERANCE
    ) {
        return undefined;
    }
    const change = price - previousClose;
    return {
        symbol: row.symbol,
        price,
        change,
        changePercent: (change / previousClose) * 100,
        timestamp: quotedAt.toISOString(),
        kind: "delayed",
        isRealtime: false,
    };
}

export class DelayedQuoteProvider implements MarketDataProvider {
    /** After a 429 or a refused key, no calls from this instance before this time. */
    private pausedUntil = 0;

    constructor(
        private readonly closes: MarketDataProvider,
        private readonly source: IntradaySource = new FinnhubQuoteClient(),
        private readonly store: IntradayStore = DATABASE_INTRADAY_STORE,
        private readonly now: () => number = () => Date.now(),
        private readonly budget: CallBudget = FINNHUB_CALL_BUDGET,
    ) {}

    async getBatchQuotes(symbols: string[]): Promise<Quote[]> {
        const closes = await this.closes.getBatchQuotes(symbols);
        if (!this.source.configured() || !this.store.configured()) return closes;
        const now = new Date(this.now());
        const session = sessionSoFar(now);
        if (!session) return closes;

        const wanted = normalizeSymbols(symbols);
        const closeBySymbol = new Map(closes.map((quote) => [quote.symbol.toUpperCase(), quote]));
        // Once the ingest has stored today's close, that is the price.
        const candidates = wanted.filter((symbol) => {
            const close = closeBySymbol.get(symbol);
            return US_STOCK_TICKER.test(symbol) && (!close || quoteDate(close) !== session.date);
        });
        if (candidates.length === 0) return closes;

        let rows: IntradayRow[];
        try {
            rows = await this.currentRows(candidates, now, session);
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.warn(`Delayed quotes unavailable, showing closes: ${reason}`);
            return closes;
        }

        const delayed = new Map<string, Quote>();
        for (const row of rows) {
            const quote = quoteFromIntraday(row, session, now, closeBySymbol.get(row.symbol));
            if (quote) delayed.set(row.symbol, quote);
        }
        if (delayed.size === 0) return closes;
        return wanted.flatMap((symbol) => delayed.get(symbol) ?? closeBySymbol.get(symbol) ?? []);
    }

    async getQuote(symbol: string): Promise<Quote> {
        const [quote] = await this.getBatchQuotes([symbol]);
        if (!quote) throw new QuoteUnavailableError(symbol.trim().toUpperCase());
        return quote;
    }

    getHistoricalPrices(symbol: string, range: string): Promise<OHLC[]> {
        return this.closes.getHistoricalPrices(symbol, range);
    }

    getFundamentals(symbol: string): Promise<Fundamentals> {
        return this.closes.getFundamentals(symbol);
    }

    searchSymbol(query: string): Promise<SymbolResult[]> {
        return this.closes.searchSymbol(query);
    }

    /**
     * The stored rows of the tracked symbols among `symbols`, after fetching
     * the ones that are due and that this instance won the claim to.
     */
    private async currentRows(symbols: string[], now: Date, session: RegularSession): Promise<IntradayRow[]> {
        const rows = await this.store.read(symbols);
        if (now.getTime() < this.pausedUntil || !rows.some((row) => needsRefresh(row, now, session))) return rows;

        const { rows: locked, claimed } = await this.store.claim(rows.map((row) => row.symbol), {
            now,
            session,
            budget: this.budget,
            source: this.source.source,
        });
        if (claimed.length === 0) return locked;

        const results = await this.fetchAll(claimed);
        if (results.length > 0) {
            await this.store.save(results, { claimedAt: now, fetchedAt: new Date(this.now()), source: this.source.source });
        }
        const fetched = new Map(results.map((result) => [result.symbol, result.quote]));
        return locked.map((row) => {
            if (!fetched.has(row.symbol)) return row;
            const quote = fetched.get(row.symbol) ?? null;
            return {
                ...row,
                price: quote?.price ?? null,
                previousClose: quote?.previousClose ?? null,
                quotedAt: quote?.quotedAt ?? null,
                claimedAt: now,
                fetchedAt: now,
            };
        });
    }

    /** Fetches a few symbols at a time; a 429 or a refused key stops the rest. */
    private async fetchAll(symbols: string[]): Promise<IntradayResult[]> {
        const results: IntradayResult[] = [];
        let failed = 0;
        let next = 0;
        let stopped = false;
        const worker = async () => {
            while (!stopped && next < symbols.length) {
                const symbol = symbols[next++];
                try {
                    results.push({ symbol, quote: await this.source.quote(symbol) });
                } catch (err) {
                    if (err instanceof FinnhubRateLimitError || err instanceof FinnhubAuthError) {
                        if (!stopped) this.pause(err);
                        stopped = true;
                    } else {
                        failed++;
                    }
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, symbols.length) }, worker));
        if (failed > 0) console.warn(`Could not fetch delayed quotes for ${failed} symbol(s); showing their closes.`);
        return results;
    }

    private pause(err: FinnhubRateLimitError | FinnhubAuthError): void {
        const auth = err instanceof FinnhubAuthError;
        this.pausedUntil = this.now() + (auth ? AUTH_PAUSE_MS : RATE_LIMIT_PAUSE_MS);
        console.warn(`${err.message} Showing closes for ${auth ? "ten minutes" : "a minute"}.`);
    }
}
