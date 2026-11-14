import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryRateLimitStore, setRateLimitStoreForTests } from "@/lib/api/rate-limit";
import { resetApiSecurityForTests } from "@/lib/api/security";

import { POST as importHoldings } from "./portfolio/import/route";
import { POST as importTransactions } from "./transactions/import/route";

// Launch item i77: CSV imports, holdings and transactions alike, share one
// daily quota per user, spent only by an import that could go ahead.

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PORTFOLIO_ID = "00000000-0000-4000-8000-000000000101";

const post = (path: string, body: unknown) => new Request(`https://atlas.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});

const holdings = { portfolioId: PORTFOLIO_ID, rows: [{ symbol: "AAPL", name: "Apple", quantity: 10, avgCost: 150 }] };
const transactions = { portfolioId: PORTFOLIO_ID, rows: [{ type: "DEPOSIT", date: "2026-10-01", amount: 1000 }] };

describe("CSV imports' daily quota (launch item i77)", () => {
    afterEach(() => {
        delete process.env.AUTH_LOCAL_DEV_BYPASS;
        delete process.env.AUTH_LOCAL_DEV_USER_ID;
        resetApiSecurityForTests();
    });

    const signedIn = () => {
        process.env.AUTH_LOCAL_DEV_BYPASS = "1";
        process.env.AUTH_LOCAL_DEV_USER_ID = USER_ID;
    };

    /** Refuses the user's imports, and records which quota keys were asked for. */
    const importsSpent = () => {
        const memory = createMemoryRateLimitStore();
        const asked: string[] = [];
        setRateLimitStoreForTests({
            kind: "memory",
            consume: (key, rule) => {
                if (!key.startsWith("quota:")) return memory.consume(key, rule);
                asked.push(key);
                return Promise.resolve({ allowed: false, retryAfterSeconds: 2 * 60 * 60 });
            },
        });
        return asked;
    };

    test("regression (i77): past the day's imports, holdings and transactions are both refused before the database is touched", async () => {
        signedIn();
        const asked = importsSpent();

        for (const response of [
            await importHoldings(post("/api/portfolio/import", holdings)),
            await importTransactions(post("/api/transactions/import", transactions)),
        ]) {
            assert.equal(response.status, 429);
            assert.equal(response.headers.get("Retry-After"), String(2 * 60 * 60));
            assert.deepEqual(await response.json(), {
                error: "You can import up to 20 CSV files a day. Try again in about 2 hours.",
                code: "DAILY_QUOTA_REACHED",
            });
        }
        // One quota, the same for both.
        assert.deepEqual(asked, [`quota:imports:${USER_ID}`, `quota:imports:${USER_ID}`]);
    });

    test("an import that isn't valid is refused without spending one", async () => {
        signedIn();
        const asked = importsSpent();

        assert.equal((await importHoldings(post("/api/portfolio/import", { ...holdings, rows: [] }))).status, 400);
        assert.equal((await importTransactions(post("/api/transactions/import", { ...transactions, portfolioId: "x" }))).status, 400);
        assert.deepEqual(asked, []);
    });
});
