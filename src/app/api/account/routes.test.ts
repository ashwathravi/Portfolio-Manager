import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { resetApiSecurityForTests } from "@/lib/api/security";

import { DELETE as deleteAccount } from "./route";
import { GET as exportAccount } from "./export/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

describe("account routes", () => {
    afterEach(() => {
        delete process.env.AUTH_LOCAL_DEV_BYPASS;
        delete process.env.AUTH_LOCAL_DEV_USER_ID;
        if (ORIGINAL_DATABASE_URL === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
        resetApiSecurityForTests();
    });

    const signedIn = () => {
        process.env.AUTH_LOCAL_DEV_BYPASS = "1";
        process.env.AUTH_LOCAL_DEV_USER_ID = USER_ID;
    };
    const deletion = (body: unknown) => new Request("https://atlas.test/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    test("fail closed when sign-in isn't configured", async () => {
        assert.equal((await deleteAccount(deletion({ confirm: "DELETE" }))).status, 503);
        assert.equal((await exportAccount(new Request("https://atlas.test/api/account/export"))).status, 503);
    });

    test("say there's nothing on the server to delete or export without a database", async () => {
        signedIn();
        delete process.env.DATABASE_URL;
        const deleted = await deleteAccount(deletion({ confirm: "DELETE" }));
        assert.equal(deleted.status, 503);
        assert.equal((await deleted.json()).code, "ACCOUNT_DATA_UNAVAILABLE");
        const exported = await exportAccount(new Request("https://atlas.test/api/account/export"));
        assert.equal(exported.status, 503);
        assert.equal((await exported.json()).code, "ACCOUNT_DATA_UNAVAILABLE");
    });

    test("deletion needs the typed confirmation, before anything else is done", async () => {
        signedIn();
        process.env.DATABASE_URL = "postgres://atlas_app:pw@db.example.invalid:6543/postgres";
        for (const body of [{}, { confirm: "delete" }, { confirm: "DELETE", userId: "someone-else" }]) {
            const response = await deleteAccount(deletion(body));
            assert.equal(response.status, 400, JSON.stringify(body));
            assert.deepEqual(await response.json(), { error: "Type DELETE to confirm", code: "INVALID_ACCOUNT_DELETION" });
        }
    });
});
