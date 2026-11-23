import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    rowWindow,
    scrollTopForRow,
    scrollTopKeepingRow,
    VIRTUAL_ROW_HEIGHT,
    VIRTUAL_VIEWPORT_HEIGHT,
    VIRTUALIZE_AFTER_ROWS,
} from "./virtual-rows";

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

describe("holdings / scrollTopKeepingRow", () => {
    it("leaves the card where it is while the row is drawn there", () => {
        // Regression: two large positions, then the small positions' row
        // (row 2) opening onto 80 more. The card had moved to row 2, taking
        // the column headings and both positions out of view.
        assert.equal(scrollTopKeepingRow(2, 83, 0), 0);
        // Scrolled near the end of a long table to the row, which closes.
        assert.equal(scrollTopKeepingRow(85, 86, 4_567), 4_567);
    });

    it("moves to the row when it isn't drawn where the card is", () => {
        // 40 positions above the row: from the top, rows 0 to 27 are drawn.
        assert.equal(scrollTopKeepingRow(40, 121, 0), 40 * 58);
        // Scrolled far below it.
        assert.equal(scrollTopKeepingRow(40, 500, 300 * 58), 40 * 58);
    });

    it("leaves a table that draws every row alone", () => {
        assert.equal(scrollTopKeepingRow(2, VIRTUALIZE_AFTER_ROWS, 0), null);
        assert.equal(scrollTopKeepingRow(2, 3, 2_000), null);
    });

    it("always leaves the row drawn, and the last row also where the browser pulls the card back to its end", () => {
        // A group's row that closes is the table's last, and the card, now
        // shorter, may be pulled back to its end (count × 58 − 640).
        const missed: string[] = [];
        for (let count = VIRTUALIZE_AFTER_ROWS + 1; count <= 160; count++) {
            const end = count * VIRTUAL_ROW_HEIGHT - VIRTUAL_VIEWPORT_HEIGHT;
            for (let index = 0; index < count; index++) {
                for (let current = 0; current <= count * VIRTUAL_ROW_HEIGHT; current += 29) {
                    const next = scrollTopKeepingRow(index, count, current);
                    if (next === null) {
                        missed.push(`no position for row ${index} of ${count}`);
                        continue;
                    }
                    for (const scrollTop of index === count - 1 ? [next, Math.min(next, end)] : [next]) {
                        const w = rowWindow(count, scrollTop);
                        if (index < w.start || index >= w.end) missed.push(`row ${index} of ${count} from ${current} at ${scrollTop}`);
                    }
                }
            }
        }
        assert.deepEqual(missed.slice(0, 5), []);
    });
});
