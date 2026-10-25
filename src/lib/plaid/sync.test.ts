import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { linkedPortfolioDescription, linkedPortfolioName, plaidConfigFromEnv, transactionsStart, uniqueAccountName } from "./sync";

// The writes and the whole sync run against Postgres in scripts/db/plaid-sync.test.ts.
describe("Plaid sync", () => {
    const now = new Date("2026-10-25T22:30:00Z");

    test("transactions are read two years back the first time, then from a month before the last sync", () => {
        assert.equal(transactionsStart(null, now), "2024-10-25");
        assert.equal(transactionsStart(new Date("2026-10-20T22:30:00Z"), now), "2026-09-20");
        // Never further back than Plaid keeps.
        assert.equal(transactionsStart(new Date("2020-01-01T00:00:00Z"), now), "2024-10-25");
    });

    test("a linked account is named for its institution and account, within the name limit", () => {
        assert.equal(linkedPortfolioName("Fidelity", "Individual"), "Fidelity Individual");
        // No doubled name when the account already says it.
        assert.equal(linkedPortfolioName("Vanguard", "Vanguard Roth IRA"), "Vanguard Roth IRA");
        assert.equal(linkedPortfolioName(null, "  Plaid IRA "), "Plaid IRA");
        assert.equal(linkedPortfolioName("Bank", "   "), "Bank Account");
        assert.equal(linkedPortfolioName("A".repeat(60), "B".repeat(60)).length, 80);
    });

    test("regression: a new linked account gets a name none of the user's accounts has", () => {
        // Names are unique per user (launch item i41); two "Individual"
        // accounts at one broker are told apart by their last four digits.
        assert.equal(uniqueAccountName("Fidelity Individual", "1234", ["Roth IRA"]), "Fidelity Individual");
        assert.equal(uniqueAccountName("Fidelity Individual", "5678", [" fidelity individual "]), "Fidelity Individual ••5678");
        assert.equal(uniqueAccountName("Fidelity Individual", null, ["Fidelity Individual", "Fidelity Individual (2)"]), "Fidelity Individual (3)");
        assert.equal(uniqueAccountName("Fidelity Individual", "5678", ["Fidelity Individual", "Fidelity Individual ••5678"]), "Fidelity Individual (2)");
        const long = "A".repeat(80);
        assert.equal(uniqueAccountName(long, "1234", [long]), `${"A".repeat(73)} ••1234`);
    });

    test("its description says where it comes from", () => {
        assert.equal(linkedPortfolioDescription("Fidelity", "1234"), "Fidelity ••1234 · linked through Plaid");
        assert.equal(linkedPortfolioDescription(null, null), "linked through Plaid");
    });

    test("Plaid's keys come from the environment, and it isn't set up without both", () => {
        assert.deepEqual(plaidConfigFromEnv({ PLAID_CLIENT_ID: " client ", PLAID_SECRET: "secret", PLAID_ENV: "production" }), {
            credentials: { clientId: "client", secret: "secret" },
            environment: "production",
        });
        assert.equal(plaidConfigFromEnv({ PLAID_CLIENT_ID: "client" })?.environment, undefined);
        assert.equal(plaidConfigFromEnv({ PLAID_CLIENT_ID: "client", PLAID_SECRET: "" }), null);
        assert.equal(plaidConfigFromEnv({ PLAID_CLIENT_ID: "client", PLAID_SECRET: "secret" })?.environment, "sandbox");
    });
});
