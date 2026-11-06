import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { resetApiSecurityForTests } from "@/lib/api/security";

import { GET as listChanges } from "./[filerId]/changes/route";

const FILER_ID = "00000000-0000-4000-8000-000000000001";

// The overlap itself is in src/lib/alpha-radar/user-overlap.test.ts, and
// what is read for whom in scripts/db/alpha-radar-overlap.test.ts.
describe("GET /api/alpha-radar/filers/[filerId]/changes", () => {
    afterEach(() => {
        resetApiSecurityForTests();
    });

    test("needs to know who is asking: fails closed when sign-in isn't configured", async () => {
        const response = await listChanges(
            new Request(`https://atlas.test/api/alpha-radar/filers/${FILER_ID}/changes`) as never,
            { params: Promise.resolve({ filerId: FILER_ID }) },
        );
        assert.equal(response.status, 503);
    });
});
