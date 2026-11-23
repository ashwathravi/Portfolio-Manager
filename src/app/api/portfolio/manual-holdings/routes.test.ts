import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { resetApiSecurityForTests } from "@/lib/api/security";

import { POST as addHolding } from "./route";
import { PUT as saveHolding } from "./[id]/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "0b9d3c1e-6a3c-4c7e-9f3a-2f4d8a1b2c3d";
const HOLDING_ID = "00000000-0000-4000-8000-000000000801";
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
// Never reached: every request below is answered before any query.
const UNREACHABLE_DATABASE_URL = "postgres://atlas_app:pw@db.example.invalid:6543/postgres";

const FUND = { name: "Target 2055 Trust", value: 12_345.67, valueAsOf: "2026-11-02" };

const request = (method: string, path: string, body: unknown) => new Request(`https://atlas.test${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
});
const add = (body: unknown) => addHolding(request("POST", "/api/portfolio/manual-holdings", body));
const save = (id: string, body: unknown) => saveHolding(request("PUT", `/api/portfolio/manual-holdings/${id}`, body), { params: Promise.resolve({ id }) });

// What is stored, and for whom, is in scripts/db/holdings-import.test.ts and
// scripts/db/record-limits.test.ts.
describe("holdings valued by hand routes", () => {
    afterEach(() => {
        delete process.env.AUTH_LOCAL_DEV_BYPASS;
        delete process.env.AUTH_LOCAL_DEV_USER_ID;
        if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
        resetApiSecurityForTests();
    });

    test("regression: a value dated in year 0000 is the form's 400 before any query, never the database's 500", async () => {
        // Accepted, the save failed in Postgres, which has no year 0000, and
        // the logged error carried the holding's name and value.
        process.env.AUTH_LOCAL_DEV_BYPASS = "1";
        process.env.AUTH_LOCAL_DEV_USER_ID = USER_ID;
        process.env.DATABASE_URL = UNREACHABLE_DATABASE_URL;
        for (const response of [
            await add({ portfolioId: ACCOUNT_ID, holding: { ...FUND, valueAsOf: "0000-12-31" } }),
            await save(HOLDING_ID, { portfolioId: ACCOUNT_ID, holding: { ...FUND, valueAsOf: "0000-01-01" } }),
        ]) {
            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { error: "Enter the date of the value (YYYY-MM-DD)", code: "INVALID_MANUAL_HOLDING" });
        }
    });
});
