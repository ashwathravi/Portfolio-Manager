import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isManualSymbol, manualSymbol } from "./manual-symbol";

describe("manualSymbol", () => {
    test("a holding valued by hand has a key no ticker has", () => {
        const key = manualSymbol("5f0c2b1e-8d4a-4e6b-9c3d-1a2b3c4d5e6f");
        assert.equal(key, "manual:5f0c2b1e-8d4a-4e6b-9c3d-1a2b3c4d5e6f");
        assert.ok(isManualSymbol(key));
        for (const ticker of ["AAPL", "BRK.B", "BTC-USD", "MANUAL"]) assert.ok(!isManualSymbol(ticker));
    });
});
