/**
 * The Holdings table's virtual window. Up to 80 rows it draws every row;
 * past that, only the rows around its scroll position (28 of them), each
 * counted 58px tall, with spacers standing in for the rest, and the card
 * scrolls inside a 640px viewport.
 *
 * A row the table scrolls to, such as the small positions' row after it
 * opens or closes, is always among the rows drawn, so its button stays
 * mounted and keeps focus: virtual-rows.test.ts checks every row of every
 * count from 81 to 1,200, including the scroll the browser clamps at the
 * end (count × 58 − 640).
 */

export const VIRTUALIZE_AFTER_ROWS = 80;
export const VIRTUAL_ROW_HEIGHT = 58;
export const VIRTUAL_VIEWPORT_HEIGHT = 640;
const VIRTUAL_OVERSCAN = 8;

export interface RowWindow {
    /** False up to 80 rows: every row is drawn and the card doesn't scroll. */
    virtualized: boolean;
    /** The rows drawn: from `start`, up to but not including `end`. */
    start: number;
    end: number;
    /** The height of the rows not drawn, above and below them. */
    topSpacer: number;
    bottomSpacer: number;
}

/** Which of `count` rows to draw with the card scrolled to `scrollTop`. */
export function rowWindow(count: number, scrollTop: number): RowWindow {
    if (count <= VIRTUALIZE_AFTER_ROWS) {
        return { virtualized: false, start: 0, end: count, topSpacer: 0, bottomSpacer: 0 };
    }
    const visibleCount = Math.ceil(VIRTUAL_VIEWPORT_HEIGHT / VIRTUAL_ROW_HEIGHT) + (VIRTUAL_OVERSCAN * 2);
    const maxStart = Math.max(0, count - visibleCount);
    const start = Math.min(
        Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN),
        maxStart,
    );
    const end = Math.min(count, start + visibleCount);
    return {
        virtualized: true,
        start,
        end,
        topSpacer: start * VIRTUAL_ROW_HEIGHT,
        bottomSpacer: Math.max(0, (count - end) * VIRTUAL_ROW_HEIGHT),
    };
}

/** The card's scroll position at row `index`, counting each row 58px: never below 0. */
export function scrollTopForRow(index: number): number {
    return Math.max(0, index) * VIRTUAL_ROW_HEIGHT;
}
