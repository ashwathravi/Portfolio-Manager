/**
 * Finnhub quotes for US stocks on the free plan (launch item i33).
 *
 *   GET https://finnhub.io/api/v1/quote?symbol=AAPL
 *   → { c: current, d: change, dp: change %, h, l, o, pc: previous close, t: unix seconds }
 *
 * One symbol per call. The key goes in the `X-Finnhub-Token` header rather
 * than the URL, so it never reaches a log line. Callers keep within the
 * plan's 60 calls a minute (`intraday-quotes.ts`); a 429 here means
 * something else used the key, and the caller backs off.
 *
 *   FINNHUB_API_KEY — without it, `configured()` is false and nothing is called.
 */

export const FINNHUB_QUOTE_URL = "https://finnhub.io/api/v1/quote";
const TIMEOUT_MS = 2_000;

export interface IntradayQuote {
    price: number;
    previousClose: number;
    quotedAt: Date;
}

/** Finnhub answered 429: the key's calls for this minute are spent. */
export class FinnhubRateLimitError extends Error {
    constructor() {
        super("Finnhub rate limit reached.");
        this.name = "FinnhubRateLimitError";
    }
}

/** Finnhub refused the key (401 or 403): wrong, revoked, or not allowed this data. */
export class FinnhubAuthError extends Error {
    constructor(readonly status: number) {
        super(`Finnhub refused the API key (HTTP ${status}).`);
        this.name = "FinnhubAuthError";
    }
}

/**
 * A quote from Finnhub's answer, or null when it has none: an unknown symbol
 * comes back as zeros, and a price without a previous close or a time can't
 * be labelled honestly.
 */
export function parseFinnhubQuote(body: unknown): IntradayQuote | null {
    const { c, pc, t } = (body ?? {}) as { c?: unknown; pc?: unknown; t?: unknown };
    if (typeof c !== "number" || typeof pc !== "number" || typeof t !== "number") return null;
    if (!(c > 0) || !(pc > 0) || !(t > 0) || !Number.isFinite(c + pc + t)) return null;
    return { price: c, previousClose: pc, quotedAt: new Date(t * 1000) };
}

export class FinnhubQuoteClient {
    readonly source = "finnhub";
    private readonly apiKey: string;

    constructor(
        apiKey: string = process.env.FINNHUB_API_KEY ?? "",
        private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
        private readonly timeoutMs: number = TIMEOUT_MS,
    ) {
        this.apiKey = apiKey.trim();
    }

    configured(): boolean {
        return this.apiKey.length > 0;
    }

    /** The symbol's quote, or null when Finnhub has none; throws on HTTP and network errors. */
    async quote(symbol: string): Promise<IntradayQuote | null> {
        const response = await this.fetchImpl(`${FINNHUB_QUOTE_URL}?symbol=${encodeURIComponent(symbol)}`, {
            headers: { "X-Finnhub-Token": this.apiKey, Accept: "application/json" },
            cache: "no-store",
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (response.status === 429) throw new FinnhubRateLimitError();
        if (response.status === 401 || response.status === 403) throw new FinnhubAuthError(response.status);
        if (!response.ok) throw new Error(`Finnhub quote for ${symbol} failed (HTTP ${response.status}).`);
        return parseFinnhubQuote(await response.json());
    }
}
