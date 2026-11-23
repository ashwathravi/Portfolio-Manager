import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { resetApiSecurityForTests } from "@/lib/api/security";

import { POST as importPositions } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "0b9d3c1e-6a3c-4c7e-9f3a-2f4d8a1b2c3d";
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
// Never reached: every request below is answered before the day's quota or any query.
const UNREACHABLE_DATABASE_URL = "postgres://atlas_app:pw@db.example.invalid:6543/postgres";

const FUND = { name: "Target 2055 Trust", quantity: 250.5, value: 12_345.67 };

const post = (body: unknown) => importPositions(new Request("https://atlas.test/api/portfolio/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
}));

// What an import writes, and for whom, is in scripts/db/holdings-import.test.ts.
describe("POST /api/portfolio/import", () => {
    afterEach(() => {
        delete process.env.AUTH_LOCAL_DEV_BYPASS;
        delete process.env.AUTH_LOCAL_DEV_USER_ID;
        if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
        resetApiSecurityForTests();
    });

    test("holdings valued by hand that don't validate are a 400 naming the problem, before the quota or any query", async () => {
        process.env.AUTH_LOCAL_DEV_BYPASS = "1";
        process.env.AUTH_LOCAL_DEV_USER_ID = USER_ID;
        process.env.DATABASE_URL = UNREACHABLE_DATABASE_URL;
        const cases: [unknown, string][] = [
            [{ portfolioId: ACCOUNT_ID, rows: [], manual: [{ ...FUND, value: -1 }] }, "Value can't be negative"],
            [{ portfolioId: ACCOUNT_ID, rows: [], manual: [FUND], valuesAsOf: "2999-01-01" }, "The values can't be from a future date"],
            [{ portfolioId: ACCOUNT_ID, rows: [], manual: [FUND], valuesAsOf: "0000-12-31" }, "Enter the date of the values (YYYY-MM-DD)"],
            [{ accounts: [{ portfolioId: ACCOUNT_ID, rows: [], manual: [FUND, { ...FUND, name: "target 2055 trust" }] }] }, "Each holding valued by hand can appear only once"],
        ];
        for (const [body, error] of cases) {
            const response = await post(body);
            assert.equal(response.status, 400, error);
            assert.deepEqual(await response.json(), { error, code: "INVALID_IMPORT" });
        }
    });
});
