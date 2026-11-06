import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryRateLimitStore } from "@/lib/api/rate-limit";

import {
    admitNewAccount,
    DEFAULT_SIGNUP_DAILY_LIMIT,
    signInDecision,
    signupDailyLimit,
    SIGNUP_LIMIT_ERROR,
} from "./new-accounts";

const HOUR_MS = 60 * 60 * 1000;

describe("new accounts under open sign-up (launch item i77)", () => {
    test("the day's limit is AUTH_SIGNUP_DAILY_LIMIT, or 50 when it isn't a whole number above zero", () => {
        assert.equal(signupDailyLimit({}), DEFAULT_SIGNUP_DAILY_LIMIT);
        assert.equal(DEFAULT_SIGNUP_DAILY_LIMIT, 50);
        assert.equal(signupDailyLimit({ AUTH_SIGNUP_DAILY_LIMIT: " 200 " }), 200);
        for (const value of ["", "0", "-5", "2.5", "lots"]) {
            assert.equal(signupDailyLimit({ AUTH_SIGNUP_DAILY_LIMIT: value }), DEFAULT_SIGNUP_DAILY_LIMIT, value);
        }
    });

    test("admits the day's limit of new accounts, then none until the next day", async () => {
        let now = 0;
        const store = createMemoryRateLimitStore(() => now);
        const env = { AUTH_SIGNUP_DAILY_LIMIT: "3" };

        for (let i = 0; i < 3; i++) assert.equal(await admitNewAccount(store, env), true);
        assert.equal(await admitNewAccount(store, env), false);
        now = 23 * HOUR_MS;
        assert.equal(await admitNewAccount(store, env), false);
        now = 24 * HOUR_MS;
        assert.equal(await admitNewAccount(store, env), true);
    });

    test("regression (i77): once the day's new accounts are taken, a new one goes to the login page's notice and an existing one still signs in", async () => {
        const counted: string[] = [];
        const deps = (existing: boolean, admitted: boolean) => ({
            isExistingAccount: async () => existing,
            admit: async () => {
                counted.push(existing ? "existing" : "new");
                return admitted;
            },
        });
        const open = { allowed: true, openSignup: true };

        assert.equal(await signInDecision(open, deps(false, false)), `/login?error=${SIGNUP_LIMIT_ERROR}`);
        assert.equal(await signInDecision(open, deps(true, false)), true);
        assert.equal(await signInDecision(open, deps(false, true)), true);
        // Only a new account spends one of the day's.
        assert.deepEqual(counted, ["new", "new"]);
    });

    test("the invite list decides alone without open sign-up, and a refused profile is refused before anything is counted", async () => {
        const untouched = {
            isExistingAccount: async () => assert.fail("looked up"),
            admit: async () => assert.fail("counted"),
        };

        assert.equal(await signInDecision({ allowed: true, openSignup: false }, untouched), true);
        assert.equal(await signInDecision({ allowed: false, openSignup: false }, untouched), false);
        assert.equal(await signInDecision({ allowed: false, openSignup: true }, untouched), false);
    });
});
