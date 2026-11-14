import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { bankLinkingAvailable, plaidLinking } from "./availability";

const KEYS = ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_TOKEN_STORAGE", "DATABASE_URL"] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const LOCAL_DATABASE = "postgres://atlas:atlas-local-only@127.0.0.1:54329/atlas_wealth";

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
    for (const key of KEYS) {
        if (values[key] === undefined) delete process.env[key];
        else process.env[key] = values[key];
    }
}

// x30: "Connect an account" on Today, Holdings and Accounts led to Settings,
// which without Plaid's keys says bank linking isn't set up and points back
// at Accounts. The pages offer the link only when Settings offers Connect.
describe("bankLinkingAvailable (x30)", () => {
    afterEach(() => {
        for (const key of KEYS) {
            if (ORIGINAL[key] === undefined) delete process.env[key];
            else process.env[key] = ORIGINAL[key];
        }
    });

    test("regression: without Plaid's keys there is nothing to connect with, database or not", () => {
        setEnv({ DATABASE_URL: LOCAL_DATABASE });
        assert.equal(bankLinkingAvailable(), false);
        setEnv({ DATABASE_URL: LOCAL_DATABASE, PLAID_CLIENT_ID: "client", PLAID_SECRET: "  " });
        assert.equal(bankLinkingAvailable(), false);
        setEnv({});
        assert.equal(bankLinkingAvailable(), false);
    });

    test("with the keys but no database, Settings says it isn't set up, so no", () => {
        setEnv({ PLAID_CLIENT_ID: "client", PLAID_SECRET: "secret" });
        // Link itself could open, but the card that would show the
        // connection is the one saying bank linking isn't set up.
        assert.equal(plaidLinking().ok, true);
        assert.equal(bankLinkingAvailable(), false);
    });

    test("with the keys and a database, Settings offers Connect, so yes", () => {
        setEnv({ PLAID_CLIENT_ID: "client", PLAID_SECRET: "secret", DATABASE_URL: LOCAL_DATABASE, PLAID_TOKEN_STORAGE: "postgres" });
        assert.equal(bankLinkingAvailable(), true);
        // Connections kept outside the database can't sync, but Settings
        // still offers Connect (PLAID_CONNECTIONS_NOT_STORED isn't "not set up").
        setEnv({ PLAID_CLIENT_ID: "client", PLAID_SECRET: "secret", DATABASE_URL: LOCAL_DATABASE });
        assert.equal(bankLinkingAvailable(), true);
    });
});
