import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { FinnhubAuthError, FinnhubQuoteClient, FinnhubRateLimitError, parseFinnhubQuote } from "./finnhub-quote-client";

function respond(status: number, body: unknown = {}) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return { calls, fetchImpl };
}

describe("parseFinnhubQuote", () => {
    test("reads the price, the previous close and the quote time", () => {
        assert.deepEqual(
            parseFinnhubQuote({ c: 231.5, d: 1.5, dp: 0.65, h: 232, l: 229, o: 230, pc: 230, t: 1_793_641_320 }),
            { price: 231.5, previousClose: 230, quotedAt: new Date(1_793_641_320_000) },
        );
    });

    test("an unknown symbol (all zeros) or a quote it can't label is no quote", () => {
        for (const body of [
            { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 },
            { c: 10, pc: 0, t: 1_793_641_320 },
            { c: 10, pc: 9, t: 0 },
            { c: "10", pc: 9, t: 1_793_641_320 },
            { c: Number.POSITIVE_INFINITY, pc: 9, t: 1_793_641_320 },
            null,
            [],
        ]) {
            assert.equal(parseFinnhubQuote(body), null, JSON.stringify(body));
        }
    });
});

describe("FinnhubQuoteClient", () => {
    test("is configured only with a key", () => {
        assert.equal(new FinnhubQuoteClient("").configured(), false);
        assert.equal(new FinnhubQuoteClient("   ").configured(), false);
        assert.equal(new FinnhubQuoteClient(" key ").configured(), true);
    });

    test("sends the key in a header, never in the URL", async () => {
        const { calls, fetchImpl } = respond(200, { c: 10, pc: 9, t: 1_793_641_320 });

        await new FinnhubQuoteClient(" secret-key ", fetchImpl).quote("BRK.B");

        assert.equal(calls[0].url, "https://finnhub.io/api/v1/quote?symbol=BRK.B");
        assert.ok(!calls[0].url.includes("secret-key"));
        assert.equal((calls[0].init?.headers as Record<string, string>)["X-Finnhub-Token"], "secret-key");
    });

    test("says which failures are a spent budget and a refused key", async () => {
        await assert.rejects(new FinnhubQuoteClient("k", respond(429).fetchImpl).quote("AAPL"), FinnhubRateLimitError);
        await assert.rejects(new FinnhubQuoteClient("k", respond(401).fetchImpl).quote("AAPL"), FinnhubAuthError);
        await assert.rejects(new FinnhubQuoteClient("k", respond(403).fetchImpl).quote("AAPL"), FinnhubAuthError);
        await assert.rejects(new FinnhubQuoteClient("k", respond(502).fetchImpl).quote("AAPL"), /HTTP 502/);
    });

    test("gives up on a call that takes too long", async () => {
        const hanging = ((_url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        })) as typeof fetch;

        await assert.rejects(new FinnhubQuoteClient("k", hanging, 20).quote("AAPL"), { name: "TimeoutError" });
    });
});
