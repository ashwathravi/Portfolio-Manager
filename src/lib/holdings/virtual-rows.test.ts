import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { rowWindow, scrollTopForRow, VIRTUAL_ROW_HEIGHT, VIRTUAL_VIEWPORT_HEIGHT, VIRTUALIZE_AFTER_ROWS } from "./virtual-rows";

describe("holdings / rowWindow", () => {
    it("draws every row up to 80, with no spacers", () => {
        for (const count of [0, 1, 79, VIRTUALIZE_AFTER_ROWS]) {
            for (const scrollTop of [0, 2_000]) {
                assert.deepEqual(rowWindow(count, scrollTop), { virtualized: false, start: 0, end: count, topSpacer: 0, bottomSpacer: 0 });
            }
        }
    });

    it("over 80, draws 28 rows around the scroll position, and the spacers stand in for the rest", () => {
        assert.deepEqual(rowWindow(81, 0), { virtualized: true, start: 0, end: 28, topSpacer: 0, bottomSpacer: 53 * 58 });
        // Row 100 at the top of the viewport: drawn from 8 rows above it.
        assert.deepEqual(rowWindow(1_000, 100 * 58), { virtualized: true, start: 92, end: 120, topSpacer: 92 * 58, bottomSpacer: 880 * 58 });
        // Scrolled to the end: the last 28.
        assert.deepEqual(rowWindow(200, 200 * 58), { virtualized: true, start: 172, end: 200, topSpacer: 172 * 58, bottomSpacer: 0 });
        for (const count of [81, 200, 1_000]) {
            for (let scrollTop = 0; scrollTop <= count * VIRTUAL_ROW_HEIGHT; scrollTop += 37) {
                const w = rowWindow(count, scrollTop);
                assert.equal(w.end - w.start, 28, `${count} at ${scrollTop}`);
                assert.equal(w.topSpacer + (w.end - w.start) * VIRTUAL_ROW_HEIGHT + w.bottomSpacer, count * VIRTUAL_ROW_HEIGHT);
            }
        }
    });

    it("always draws the row it scrolls to, also where the browser clamps the scroll at the end", () => {
        // What the small positions' row relies on to keep its button, and focus,
        // as it opens or closes: every row of every count to 1,200.
        const missed: string[] = [];
        for (let count = VIRTUALIZE_AFTER_ROWS + 1; count <= 1_200; count++) {
            const end = count * VIRTUAL_ROW_HEIGHT - VIRTUAL_VIEWPORT_HEIGHT;
            for (let index = 0; index < count; index++) {
                for (const scrollTop of [scrollTopForRow(index), Math.min(scrollTopForRow(index), end)]) {
                    const w = rowWindow(count, scrollTop);
                    if (index < w.start || index >= w.end) missed.push(`row ${index} of ${count} at ${scrollTop}`);
                }
            }
        }
        assert.deepEqual(missed.slice(0, 5), []);
    });
});

describe("holdings / scrollTopForRow", () => {
    it("is the row's index times its height, never below 0", () => {
        assert.equal(scrollTopForRow(0), 0);
        assert.equal(scrollTopForRow(2), 116);
        assert.equal(scrollTopForRow(81), 81 * 58);
        assert.equal(scrollTopForRow(-3), 0);
    });
});
