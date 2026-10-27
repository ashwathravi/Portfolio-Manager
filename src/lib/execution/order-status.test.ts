import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ORDER_STATUSES } from "@/types/execution";

import { canChangeOrderStatus, isOpenOrderStatus, ORDER_STATUS_LABELS, type OrderStatusChange } from "./order-status";

describe("order plan status changes", () => {
    const allowed: [string, OrderStatusChange][] = [
        ["pending_approval", "ready"],
        ["pending_approval", "cancelled"],
        ["ready", "placed"],
        ["ready", "cancelled"],
        ["placed", "cancelled"],
    ];

    test("a plan waiting for approval can be approved or cancelled; a ready one placed or cancelled; a placed one cancelled", () => {
        for (const from of ORDER_STATUSES) {
            for (const to of ["ready", "placed", "cancelled"] as const) {
                const expected = allowed.some(([f, t]) => f === from && t === to);
                assert.equal(canChangeOrderStatus(from, to), expected, `${from} -> ${to}`);
            }
        }
    });

    test("a cancelled plan is final, and nothing goes back to waiting for approval or ready", () => {
        for (const to of ["ready", "placed", "cancelled"] as const) assert.equal(canChangeOrderStatus("cancelled", to), false);
        assert.equal(canChangeOrderStatus("placed", "ready"), false);
    });

    test("only plans waiting for approval or ready to place are open", () => {
        assert.deepEqual(ORDER_STATUSES.filter(isOpenOrderStatus), ["pending_approval", "ready"]);
    });

    test("every status has a label that doesn't claim a broker filled it", () => {
        for (const status of ORDER_STATUSES) assert.ok(ORDER_STATUS_LABELS[status]);
        assert.ok(!Object.values(ORDER_STATUS_LABELS).some((label) => /fill|work|reject/i.test(label)));
    });
});
