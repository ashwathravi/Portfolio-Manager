import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { activeDestination } from "@/lib/navigation";

import { addAccountsLink } from "./add-accounts";

// x30: the example-data notices and empty states sent everyone to Settings to
// connect an account, where without Plaid's keys the card only says bank
// linking isn't set up and points back at Accounts.
describe("addAccountsLink (x30)", () => {
    test("regression: without bank linking it leads to Accounts, to add one by hand", () => {
        assert.deepEqual(addAccountsLink(false), { href: "/portfolios/accounts", label: "Add an account" });
    });

    test("with bank linking it leads to Settings, to connect one", () => {
        assert.deepEqual(addAccountsLink(true), { href: "/settings#accounts", label: "Connect an account" });
    });

    test("either way it is a live page", () => {
        for (const bankLinking of [false, true]) {
            const { href } = addAccountsLink(bankLinking);
            assert.ok(activeDestination(href.split(/[?#]/)[0]), href);
        }
    });
});
