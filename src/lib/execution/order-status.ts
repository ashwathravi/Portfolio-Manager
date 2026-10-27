/**
 * How an order plan's status may change (launch item i53). Atlas never
 * routes an order, so these are the user's own steps: approve a plan that
 * was over their threshold, mark a ready plan placed once they've placed
 * it at their broker, or cancel it (a placed one too: cancelled at the
 * broker before it filled). A cancelled plan stays cancelled.
 */

import type { OrderStatus } from "@/types/execution";

export type OrderStatusChange = Exclude<OrderStatus, "pending_approval">;

/** For each status a plan can be moved to, the statuses it can come from. */
export const ORDER_STATUS_SOURCES: Readonly<Record<OrderStatusChange, readonly OrderStatus[]>> = {
    ready: ["pending_approval"],
    placed: ["ready"],
    cancelled: ["pending_approval", "ready", "placed"],
};

export function canChangeOrderStatus(from: OrderStatus, to: OrderStatusChange): boolean {
    return ORDER_STATUS_SOURCES[to].includes(from);
}

/** Still to act on: waiting for approval, or ready to place. */
export function isOpenOrderStatus(status: OrderStatus): boolean {
    return status === "pending_approval" || status === "ready";
}

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
    pending_approval: "Needs approval",
    ready: "Ready to place",
    placed: "Placed",
    cancelled: "Cancelled",
};
