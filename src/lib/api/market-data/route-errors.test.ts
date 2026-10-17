import { afterEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";

import { marketDataErrorResponse } from "./route-errors";
import { MarketDataNotConfiguredError, QuoteUnavailableError } from "@/lib/providers/errors";
import { PolygonApiError, PolygonRateLimitError } from "@/lib/providers/polygon-massive-adapter";

describe("marketDataErrorResponse", () => {
    afterEach(() => mock.restoreAll());

    test("missing configuration is a quiet 503", async () => {
        const logged = mock.method(console, "error", () => {});

        const response = marketDataErrorResponse(
            new MarketDataNotConfiguredError("POLYGON_API_KEY"),
            "Unable to fetch quotes.",
            "MARKET_DATA_QUOTES_FAILED",
        );

        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
            error: "Market data is not configured.",
            code: "MARKET_DATA_NOT_CONFIGURED",
        });
        assert.equal(logged.mock.callCount(), 0);
    });

    test("a symbol with no stored price yet is a quiet 404", async () => {
        const logged = mock.method(console, "error", () => {});

        const response = marketDataErrorResponse(new QuoteUnavailableError("MSFT"), "Unable to fetch quote.", "MARKET_DATA_QUOTE_FAILED");

        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: "No price for MSFT yet.", code: "QUOTE_UNAVAILABLE" });
        assert.equal(logged.mock.callCount(), 0);
    });

    test("a provider rate limit is a 429 with Retry-After in whole seconds", async () => {
        const response = marketDataErrorResponse(
            new PolygonRateLimitError(12_500, "https://api.test/v2?apiKey=***"),
            "Unable to fetch quotes.",
            "MARKET_DATA_QUOTES_FAILED",
        );

        assert.equal(response.status, 429);
        assert.equal(response.headers.get("Retry-After"), "13");
        assert.equal((await response.json()).code, "RATE_LIMITED");
    });

    test("anything else is a logged 500 with the route's message and code", async () => {
        const logged = mock.method(console, "error", () => {});
        const failure = new PolygonApiError(404, "No closing price for symbol \"ZZZZ\"", "https://api.test/v2?apiKey=***");

        const response = marketDataErrorResponse(failure, "Unable to fetch quote.", "MARKET_DATA_QUOTE_FAILED");

        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { error: "Unable to fetch quote.", code: "MARKET_DATA_QUOTE_FAILED" });
        assert.equal(logged.mock.callCount(), 1);
        assert.equal(logged.mock.calls[0].arguments[1], failure);
    });
});
